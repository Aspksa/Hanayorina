import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { databaseConfigured, prepareDatabase } from '../database/postgres';
import { addKey, configure, publicSettings, removeKey, selectKey, testConnection } from '../settings/keys';
import { page } from './page';

const host = '127.0.0.1';
const port = Number(process.env.HANAYORINA_PORT || 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Некорректный порт сервера');
const csrf = randomBytes(32).toString('hex');
function json(res: ServerResponse, status: number, value: unknown) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); }
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0; const chunks: Buffer[] = [];
  for await (const chunk of req) { const b = Buffer.from(chunk); size += b.length; if (size > 16384) throw new Error('Слишком большой запрос.'); chunks.push(b); }
  try { const v: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!v || typeof v !== 'object' || Array.isArray(v)) throw Error(); return v as Record<string, unknown>; } catch { throw new Error('Некорректный запрос.'); }
}
async function handle(req: IncomingMessage, res: ServerResponse) {
  const expectedHost = `127.0.0.1:${port}`;
  if (req.headers.host !== expectedHost) return json(res, 403, { error: 'Недопустимый адрес.' });
  if (req.url === '/health' && req.method === 'GET' && process.env.HANAYORINA_HEALTH_TOKEN) return json(res, 200, { token: process.env.HANAYORINA_HEALTH_TOKEN });
  if (req.url === '/' && (req.method === 'GET' || req.method === 'HEAD')) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'" }); return res.end(req.method === 'HEAD' ? undefined : page(csrf)); }
  if (req.url === '/api/settings' && req.method === 'GET') return json(res, 200, publicSettings());
  if (req.method !== 'POST' || !req.url?.startsWith('/api/')) return json(res, 404, { error: 'Не найдено.' });
  if (req.headers.origin !== `http://${expectedHost}` || req.headers['x-hanayorina-token'] !== csrf || !req.headers['content-type']?.toLowerCase().startsWith('application/json')) return json(res, 403, { error: 'Запрос отклонён.' });
  const data = await body(req);
  if (req.url === '/api/settings') configure(data.endpoint, data.autoSwitch);
  else if (req.url === '/api/keys/add') addKey(data.name, data.secret);
  else if (req.url === '/api/keys/delete') removeKey(data.id);
  else if (req.url === '/api/keys/select') selectKey(data.id);
  else if (req.url === '/api/test') return json(res, 200, await testConnection());
  else return json(res, 404, { error: 'Не найдено.' });
  return json(res, 200, { ok: true });
}
const server = createServer((req, res) => { void handle(req, res).catch((error: unknown) => { if (!res.headersSent) json(res, 400, { error: error instanceof Error ? error.message : 'Ошибка запроса.' }); else res.end(); }); });
server.on('error', (error: NodeJS.ErrnoException) => { console.error(error.code === 'EADDRINUSE' ? `Порт ${port} занят. Закройте другую программу и повторите запуск.` : error.message); process.exitCode = 1; });
async function start(): Promise<void> {
  if (databaseConfigured()) { await prepareDatabase(); console.log('PostgreSQL подключён; структура базы готова.'); }
  else console.log('PostgreSQL не настроен. См. config/.env.example и docs/setup.md.');
  server.listen(port, host, () => console.log(`Hanayorina: http://${host}:${port}`));
}
start().catch((error: unknown) => { console.error(`Ошибка подключения PostgreSQL или создания таблиц: ${error instanceof Error ? error.message : 'Неизвестная ошибка'}`); console.error('Проверьте PostgreSQL и локальные настройки .env, затем повторите запуск.'); process.exitCode = 1; });
