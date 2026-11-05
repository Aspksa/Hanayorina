import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { testConnection } from './keys';

const directory = join(process.cwd(), 'data');
const file = join(directory, 'cloud-backup.json');
const endpoint = 'https://foundation-models.api.cloud.ru/v1/models';
type Backup = { enabled: boolean; secret: string; model?: string };
let cachedModels: { secret: string; ids: string[] } | null = null;
function load(): Backup {
  try {
    const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (!value || typeof value !== 'object' || typeof (value as Backup).enabled !== 'boolean' || typeof (value as Backup).secret !== 'string') throw new Error();
    const data = value as Backup;
    if (data.model !== undefined && typeof data.model !== 'string') throw new Error();
    return data;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { enabled: false, secret: '' };
    throw new Error('Не удалось прочитать настройки Cloud.ru. Файл сохранён без изменений.');
  }
}
function save(value: Backup): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temp = join(directory, `.cloud-${randomUUID()}.tmp`);
  try { writeFileSync(temp, JSON.stringify(value, null, 2), { encoding: 'utf8', flag: 'wx', mode: 0o600 }); renameSync(temp, file); }
  catch { try { unlinkSync(temp); } catch {} throw new Error('Не удалось сохранить настройки Cloud.ru.'); }
}
export function cloudSettings() { const value = load(); return { enabled: value.enabled, hasKey: Boolean(value.secret), model: value.model || '' }; }
export function configureCloud(enabled: unknown, secret: unknown, remove: unknown): void {
  if (typeof enabled !== 'boolean' || typeof secret !== 'string' || typeof remove !== 'boolean' || secret.length > 4096 || /[\r\n]/.test(secret)) throw new Error('Проверьте настройки Cloud.ru.');
  const data = load();
  const previous = data.secret;
  if (remove) data.secret = ''; else if (secret.trim()) data.secret = secret.trim();
  if (data.secret !== previous) { cachedModels = null; data.model = ''; }
  if (enabled && !data.secret) throw new Error('Добавьте ключ Cloud.ru перед включением резерва.');
  data.enabled = enabled; save(data);
}
async function checkCloud(secret: string): Promise<void> {
  let response: Response;
  try { response = await fetch(endpoint, { headers: { Authorization: `Bearer ${secret}` }, redirect: 'manual', signal: AbortSignal.timeout(10000) }); }
  catch { throw new Error('Cloud.ru недоступен. Проверьте интернет.'); }
  const status = response.status; await response.body?.cancel();
  if (status < 200 || status >= 300) throw new Error(`Cloud.ru вернул HTTP ${status}. Проверьте ключ и доступ.`);
}

export async function listCloudModels(): Promise<string[]> {
  cachedModels = null;
  const data = load();
  if (!data.secret) throw new Error('Сначала добавьте ключ Cloud.ru.');
  let response: Response;
  try { response = await fetch(endpoint, { headers: { Authorization: `Bearer ${data.secret}` }, redirect: 'manual', signal: AbortSignal.timeout(10000) }); }
  catch { throw new Error('Cloud.ru недоступен. Проверьте интернет.'); }
  if (!response.ok) { const status = response.status; await response.body?.cancel(); throw new Error(`Cloud.ru вернул HTTP ${status}. Проверьте ключ и доступ.`); }
  let payload: unknown;
  try {
    const chunks: Uint8Array[] = []; let total = 0;
    if (!response.body) throw new Error();
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) { total += chunk.length; if (total > 2_000_000) throw new Error(); chunks.push(chunk); }
    payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch { throw new Error('Не удалось прочитать список моделей Cloud.ru.'); }
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { data?: unknown }).data)) throw new Error('Cloud.ru вернул список моделей в неизвестном формате.');
  const ids = [...new Set(((payload as { data: unknown[] }).data).map(item => item && typeof item === 'object' ? (item as { id?: unknown }).id : undefined).filter((id): id is string => typeof id === 'string' && id.length <= 200 && /^[a-z0-9._/-]+$/i.test(id) && /(?:^|[/_-])deepseek(?:[/_-]|$)/i.test(id)))].sort((a, b) => a.localeCompare(b));
  if (load().secret !== data.secret) throw new Error('Ключ Cloud.ru изменился во время загрузки. Повторите запрос.');
  cachedModels = { secret: data.secret, ids };
  return ids;
}
export function selectCloudModel(model: unknown): void {
  const data = load();
  if (typeof model !== 'string' || !cachedModels || cachedModels.secret !== data.secret || !cachedModels.ids.includes(model)) throw new Error('Обновите список и выберите доступную модель DeepSeek.');
  data.model = model; save(data);
}

export async function testCloud(): Promise<void> { const data = load(); if (!data.secret) throw new Error('Сначала добавьте ключ Cloud.ru.'); await checkCloud(data.secret); }
export async function testWithBackup(): Promise<{ provider: string; name: string; switched: boolean }> {
  try { const result = await testConnection(); return { provider: 'primary', ...result }; }
  catch (primaryError) {
    const backup = load();
    if (!backup.enabled || !backup.secret) throw primaryError;
    try { await checkCloud(backup.secret); return { provider: 'cloud', name: 'Cloud.ru', switched: true }; }
    catch { throw new Error('Основной сервис и Cloud.ru не прошли проверку. Проверьте подключение и ключи обоих сервисов.'); }
  }
}
