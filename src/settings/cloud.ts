import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { testConnection } from './keys';

const directory = join(process.cwd(), 'data');
const file = join(directory, 'cloud-backup.json');
const endpoint = 'https://foundation-models.api.cloud.ru/v1/models';
type Backup = { enabled: boolean; secret: string };
function load(): Backup {
  try {
    const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (!value || typeof value !== 'object' || typeof (value as Backup).enabled !== 'boolean' || typeof (value as Backup).secret !== 'string') throw new Error();
    return value as Backup;
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
export function cloudSettings() { const value = load(); return { enabled: value.enabled, hasKey: Boolean(value.secret) }; }
export function configureCloud(enabled: unknown, secret: unknown, remove: unknown): void {
  if (typeof enabled !== 'boolean' || typeof secret !== 'string' || typeof remove !== 'boolean' || secret.length > 4096 || /[\r\n]/.test(secret)) throw new Error('Проверьте настройки Cloud.ru.');
  const data = load();
  if (remove) data.secret = ''; else if (secret.trim()) data.secret = secret.trim();
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
