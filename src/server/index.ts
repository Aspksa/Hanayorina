import { personalHistory } from '../history/history';
import { getPreferences, savePreferences } from '../persona/preferences';
import { aiMemorySettings, setAiMemory } from '../memory/ai';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { databaseConfigured, prepareDatabase } from '../database/postgres';
import { addKey, configure, publicSettings, removeKey, selectKey, listPrimaryModels, selectPrimaryModel } from '../settings/keys';
import { page } from './page';
import { chatPage } from './chat-page';
import { graphPage } from './graph-page';
import { assistantPage } from './assistant-page';
import { assistantStatus } from '../assistant/status';
import { knowledgeGraph, reviewMemory, reviseMemory, deleteMemory } from '../graph/graph';
import { startMemoryWorker } from '../memory/worker';
import { initChat, databasePool, conversations, messages, send } from '../chat/chat';
import { cloudSettings, configureCloud, listCloudModels, selectCloudModel, testCloud, testWithBackup } from '../settings/cloud';

const host = '127.0.0.1';
const port = Number(process.env.HANAYORINA_PORT || 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Некорректный порт сервера');
const csrf = randomBytes(32).toString('hex');
function json(res: ServerResponse, status: number, value: unknown) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); }
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0; const chunks: Buffer[] = [];
  for await (const chunk of req) { const b = Buffer.from(chunk); size += b.length; if (size > 131072) throw new Error('Слишком большой запрос.'); chunks.push(b); }
  try { const v: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!v || typeof v !== 'object' || Array.isArray(v)) throw Error(); return v as Record<string, unknown>; } catch { throw new Error('Некорректный запрос.'); }
}
async function handle(req: IncomingMessage, res: ServerResponse) {
  const expectedHost = `127.0.0.1:${port}`;
  if (req.headers.host !== expectedHost) return json(res, 403, { error: 'Недопустимый адрес.' });
  if (req.url === '/health' && req.method === 'GET' && process.env.HANAYORINA_HEALTH_TOKEN) return json(res, 200, { token: process.env.HANAYORINA_HEALTH_TOKEN });
  if (req.url === '/assets/hanayorina.webp' && (req.method === 'GET' || req.method === 'HEAD')) {
    try { const image = readFileSync(join(process.cwd(), 'public', 'hanayorina.webp')); res.writeHead(200, { 'Content-Type':'image/webp', 'Content-Length':image.length, 'Cache-Control':'public, max-age=3600', 'X-Content-Type-Options':'nosniff' }); return res.end(req.method === 'HEAD' ? undefined : image); }
    catch { return json(res, 404, { error:'Аватар не найден.' }); }
  }
  if ((req.url === '/' || req.url?.startsWith('/?') || req.url === '/settings' || req.url === '/graph' || req.url === '/hanayorina') && (req.method === 'GET' || req.method === 'HEAD')) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'" }); return res.end(req.method === 'HEAD' ? undefined : req.url === '/settings' ? page(csrf) : req.url === '/graph' ? graphPage(csrf) : req.url === '/hanayorina' ? assistantPage(csrf) : chatPage(csrf)); }
  if (req.url === '/api/personality' && req.method === 'GET') return json(res, 200, getPreferences());
  if (req.url === '/api/memory/ai' && req.method === 'GET') return json(res, 200, aiMemorySettings());
  if (req.url === '/api/cloud' && req.method === 'GET') return json(res, 200, cloudSettings());
  if (req.url === '/api/settings' && req.method === 'GET') return json(res, 200, publicSettings());
  if (req.method !== 'POST' || !req.url?.startsWith('/api/')) return json(res, 404, { error: 'Не найдено.' });
  if (req.headers.origin !== `http://${expectedHost}` || req.headers['x-hanayorina-token'] !== csrf || !req.headers['content-type']?.toLowerCase().startsWith('application/json')) return json(res, 403, { error: 'Запрос отклонён.' });
  const data = await body(req);
  if (req.url === '/api/personality') { savePreferences(data); return json(res, 200, {ok:true}); }
  if (req.url === '/api/memory/ai') {
    if (typeof data.enabled !== 'boolean') throw new Error('Некорректные настройки памяти.');
    if (!data.enabled) setAiMemory(false);
    await databasePool().query("UPDATE memory_ai_jobs SET status='skipped',updated_at=now() WHERE status='pending'");
    if (data.enabled) setAiMemory(true);
    return json(res, 200, {ok:true});
  }
  if (req.url === '/api/history') return json(res, 200, await personalHistory(databasePool()));
  if (req.url === '/api/assistant/status') return json(res, 200, await assistantStatus());
  if (req.url === '/api/memory/revise') { await reviseMemory(data.id, data.text); return json(res, 200, {ok:true}); }
  if (req.url === '/api/memory/delete') { await deleteMemory(data.id); return json(res, 200, {ok:true}); }
  if (req.url === '/api/memory/review') { await reviewMemory(data.id, data.decision); return json(res, 200, { ok: true }); }
  if (req.url === '/api/graph') return json(res, 200, await knowledgeGraph());
  if (req.url === '/api/chats') return json(res, 200, { chats: await conversations() });
  if (req.url === '/api/messages') return json(res, 200, await messages(data.id, data.before, data.at));
  if (req.url === '/api/chat') {
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    const controller = new AbortController(); res.on('close', () => { if (!res.writableEnded) controller.abort(); });
    const emit = (event: unknown) => { if (!res.destroyed) res.write(JSON.stringify(event) + '\n'); };
    try { await send(data.id, data.message, emit, controller.signal, data.requestId); } catch (error) { emit({ type: 'error', message: error instanceof Error ? error.message : 'Ошибка чата.' }); }
    return res.end();
  }
  if (req.url === '/api/primary/models') return json(res, 200, { models: await listPrimaryModels() });
  if (req.url === '/api/primary/model') { selectPrimaryModel(data.model); return json(res, 200, { ok: true }); }
  if (req.url === '/api/settings') configure(data.endpoint, data.autoSwitch);
  else if (req.url === '/api/keys/add') addKey(data.name, data.secret);
  else if (req.url === '/api/keys/delete') removeKey(data.id);
  else if (req.url === '/api/keys/select') selectKey(data.id);
  else if (req.url === '/api/cloud') configureCloud(data.enabled, data.secret, data.remove);
  else if (req.url === '/api/cloud/models') return json(res, 200, { models: await listCloudModels() });
  else if (req.url === '/api/cloud/model') selectCloudModel(data.model);
  else if (req.url === '/api/cloud/test') { await testCloud(); return json(res, 200, { ok: true }); }
  else if (req.url === '/api/test') return json(res, 200, await testWithBackup());
  else return json(res, 404, { error: 'Не найдено.' });
  return json(res, 200, { ok: true });
}
const server = createServer((req, res) => { void handle(req, res).catch((error: unknown) => { if (!res.headersSent) json(res, 400, { error: error instanceof Error ? error.message : 'Ошибка запроса.' }); else res.end(); }); });
server.on('error', (error: NodeJS.ErrnoException) => { console.error(error.code === 'EADDRINUSE' ? `Порт ${port} занят. Закройте другую программу и повторите запуск.` : error.message); process.exitCode = 1; });
async function start(): Promise<void> {
  if (databaseConfigured()) { await prepareDatabase(); await initChat(); startMemoryWorker(databasePool()); console.log('PostgreSQL подключён; структура базы готова.'); }
  else console.log('PostgreSQL не настроен. См. config/.env.example и docs/setup.md.');
  server.listen(port, host, () => console.log(`Hanayorina: http://${host}:${port}`));
}
start().catch((error: unknown) => { console.error(`Ошибка подключения PostgreSQL или создания таблиц: ${error instanceof Error ? error.message : 'Неизвестная ошибка'}`); console.error('Проверьте PostgreSQL и локальные настройки .env, затем повторите запуск.'); process.exitCode = 1; });
