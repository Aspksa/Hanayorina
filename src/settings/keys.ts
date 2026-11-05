import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Key = { id: string; name: string; secret: string };
type Settings = { endpoint: string; autoSwitch: boolean; activeId: string | null; keys: Key[] };
const directory = join(process.cwd(), 'data');
const file = join(directory, 'model-keys.json');
const empty = (): Settings => ({ endpoint: '', autoSwitch: true, activeId: null, keys: [] });
export function load(): Settings {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object') throw new Error('bad');
    const data = parsed as Settings;
    if (typeof data.endpoint !== 'string' || typeof data.autoSwitch !== 'boolean' || !Array.isArray(data.keys) || !data.keys.every(k => k && typeof k.id === 'string' && typeof k.name === 'string' && typeof k.secret === 'string')) throw new Error('bad');
    if (data.activeId !== null && typeof data.activeId !== 'string') throw new Error('bad');
    return data;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return empty();
    throw new Error('Не удалось прочитать настройки ключей. Файл сохранён без изменений.');
  }
}
function save(settings: Settings): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const tmp = join(directory, `.model-keys-${randomUUID()}.tmp`);
  try { writeFileSync(tmp, JSON.stringify(settings, null, 2), { encoding: 'utf8', mode: 0o600, flag: 'wx' }); renameSync(tmp, file); }
  catch { try { require('node:fs').unlinkSync(tmp); } catch {} throw new Error('Не удалось сохранить настройки ключей.'); }
}
export function publicSettings() { const data = load(); return { endpoint: data.endpoint, autoSwitch: data.autoSwitch, activeId: data.activeId, keys: data.keys.map(({ id, name }) => ({ id, name })) }; }
export function configure(endpoint: unknown, autoSwitch: unknown): void {
  if (typeof endpoint !== 'string' || endpoint.length > 2048 || typeof autoSwitch !== 'boolean') throw new Error('Проверьте адрес и настройку переключения.');
  const value = endpoint.trim();
  if (value) {
    let url: URL;
    try { url = new URL(value); } catch { throw new Error('Некорректный адрес API.'); }
    if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) throw new Error('Укажите HTTPS-адрес API без пароля, параметров и якоря.');
  }
  const data = load(); data.endpoint = value.replace(/\/+$/, ''); data.autoSwitch = autoSwitch; save(data);
}
export function addKey(name: unknown, secret: unknown): void {
  if (typeof name !== 'string' || typeof secret !== 'string' || !name.trim() || name.trim().length > 80 || !secret.trim() || secret.trim().length > 4096 || /[\r\n]/.test(secret)) throw new Error('Укажите название и корректный ключ.');
  const data = load(); if (data.keys.length >= 50) throw new Error('Можно добавить не больше 50 ключей.');
  const key = { id: randomUUID(), name: name.trim(), secret: secret.trim() }; data.keys.push(key); if (!data.activeId) data.activeId = key.id; save(data);
}
export function removeKey(id: unknown): void { if (typeof id !== 'string') throw new Error('Ключ не найден.'); const data = load(); data.keys = data.keys.filter(k => k.id !== id); if (data.activeId === id) data.activeId = data.keys[0]?.id || null; save(data); }
export function selectKey(id: unknown): void { const data = load(); if (typeof id !== 'string' || !data.keys.some(k => k.id === id)) throw new Error('Ключ не найден.'); data.activeId = id; save(data); }

// Retry only responses that can plausibly be specific to a credential.
export async function testConnection(): Promise<{ name: string; switched: boolean }> {
  const data = load(); if (!data.endpoint) throw new Error('Сначала укажите адрес API.');
  const ordered = [...data.keys]; const index = ordered.findIndex(k => k.id === data.activeId); if (index > 0) ordered.unshift(...ordered.splice(index, 1));
  if (!ordered.length) throw new Error('Сначала добавьте ключ.');
  const target = data.endpoint.endsWith('/models') ? data.endpoint : `${data.endpoint}/models`;
  const keys = data.autoSwitch ? ordered : ordered.slice(0, 1);
  for (const key of keys) {
    let response: Response;
    try { response = await fetch(target, { headers: { Authorization: `Bearer ${key.secret}` }, redirect: 'manual', signal: AbortSignal.timeout(10000) }); }
    catch { throw new Error('Не удалось связаться с сервером API. Проверьте адрес и интернет.'); }
    const status = response.status; await response.body?.cancel();
    if (response.ok) {
      const latest = load(); if (!latest.keys.some(k => k.id === key.id) || latest.endpoint !== data.endpoint) throw new Error('Настройки изменились во время проверки; повторите её.');
      const switched = latest.activeId !== key.id; latest.activeId = key.id; save(latest); return { name: key.name, switched };
    }
    if (![401, 403, 429].includes(status)) throw new Error(`Сервер вернул HTTP ${status}. Проверьте адрес и совместимость API.`);
  }
  throw new Error('Проверка не прошла: ключи отклонены или достигнут лимит.');
}
