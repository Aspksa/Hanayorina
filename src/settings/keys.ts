import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Key = { id: string; name: string; secret: string };
type Settings = { endpoint: string; autoSwitch: boolean; activeId: string | null; keys: Key[]; model?: string };
const directory = join(process.cwd(), 'data');
const file = join(directory, 'model-keys.json');
const empty = (): Settings => ({ endpoint: '', autoSwitch: true, activeId: null, keys: [] });
export function load(): Settings {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object') throw new Error('bad');
    const data = parsed as Settings;
    if (typeof data.endpoint !== 'string' || typeof data.autoSwitch !== 'boolean' || !Array.isArray(data.keys) || !data.keys.every(k => k && typeof k.id === 'string' && typeof k.name === 'string' && typeof k.secret === 'string')) throw new Error('bad');
    if (data.model !== undefined && typeof data.model !== 'string') throw new Error('bad');
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
export function publicSettings() { const data = load(); return { endpoint: data.endpoint, autoSwitch: data.autoSwitch, activeId: data.activeId, model: data.model || '', keys: data.keys.map(({ id, name }) => ({ id, name })) }; }
export function configure(endpoint: unknown, autoSwitch: unknown): void {
  if (typeof endpoint !== 'string' || endpoint.length > 2048 || typeof autoSwitch !== 'boolean') throw new Error('Проверьте адрес и настройку переключения.');
  const value = endpoint.trim();
  if (value) {
    let url: URL;
    try { url = new URL(value); } catch { throw new Error('Некорректный адрес API.'); }
    if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) throw new Error('Укажите HTTPS-адрес API без пароля, параметров и якоря.');
  }
  const data = load(); const next = value.replace(/\/+$/, ''); if (data.endpoint !== next) { data.model = ''; primaryModels = null; } data.endpoint = next; data.autoSwitch = autoSwitch; save(data);
}
export function addKey(name: unknown, secret: unknown): void {
  if (typeof name !== 'string' || typeof secret !== 'string' || !name.trim() || name.trim().length > 80 || !secret.trim() || secret.trim().length > 4096 || /[\r\n]/.test(secret)) throw new Error('Укажите название и корректный ключ.');
  const data = load(); if (data.keys.length >= 50) throw new Error('Можно добавить не больше 50 ключей.');
  const key = { id: randomUUID(), name: name.trim(), secret: secret.trim() }; data.keys.push(key); if (!data.activeId) data.activeId = key.id; save(data);
}
export function removeKey(id: unknown): void { if (typeof id !== 'string') throw new Error('Ключ не найден.'); const data = load(); data.keys = data.keys.filter(k => k.id !== id); if (data.activeId === id) data.activeId = data.keys[0]?.id || null; save(data); }
export function selectKey(id: unknown): void { const data = load(); if (typeof id !== 'string' || !data.keys.some(k => k.id === id)) throw new Error('Ключ не найден.'); data.activeId = id; save(data); }

// A single GET retry is safe here; future generation requests need their own retry policy.
function retryAfterMs(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  if (/^\d+$/.test(value.trim())) return Number(value.trim()) * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}
async function checkKey(target: string, key: Key): Promise<number> {
  for (let attempt = 0; attempt < 2; attempt++) {
    let response: Response;
    try { response = await fetch(target, { headers: { Authorization: `Bearer ${key.secret}` }, redirect: 'manual', signal: AbortSignal.timeout(10000) }); }
    catch { throw new Error('Не удалось связаться с сервером API. Проверьте адрес и интернет.'); }
    const status = response.status;
    const delay = status === 429 ? retryAfterMs(response.headers.get('retry-after')) : null;
    await response.body?.cancel();
    if (status === 429) {
      if (attempt === 0 && delay !== null && delay <= 3000) {
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      const info = delay !== null ? ` Повторите не раньше чем через ${Math.ceil(delay / 1000)} сек.` : ' Повторите позже.';
      throw new Error(`Слишком много запросов (429).${info} Ключ остаётся активным.`);
    }
    if ([502, 503, 504].includes(status)) {
      if (attempt === 0) { await new Promise(resolve => setTimeout(resolve, 1000)); continue; }
      throw new Error(`Сервис модели временно недоступен или не ответил (HTTP ${status}). Попробуйте позже; ключ остаётся активным.`);
    }
    if (status === 524) throw new Error('Соединение прервалось (524). Проверьте резервный адрес у поставщика; ключ остаётся активным.');
    return status;
  }
  throw new Error('Проверка не завершена.');
}
export async function testConnection(): Promise<{ name: string; switched: boolean }> {
  const data = load(); if (!data.endpoint) throw new Error('Сначала укажите адрес API.');
  const ordered = [...data.keys]; const index = ordered.findIndex(k => k.id === data.activeId); if (index > 0) ordered.unshift(...ordered.splice(index, 1));
  if (!ordered.length) throw new Error('Сначала добавьте ключ.');
  const target = data.endpoint.endsWith('/models') ? data.endpoint : `${data.endpoint}/models`;
  const keys = data.autoSwitch ? ordered : ordered.slice(0, 1);
  for (const key of keys) {
    const status = await checkKey(target, key);
    if (status >= 200 && status < 300) {
      const latest = load(); if (!latest.keys.some(k => k.id === key.id) || latest.endpoint !== data.endpoint) throw new Error('Настройки изменились во время проверки; повторите её.');
      const switched = latest.activeId !== key.id; latest.activeId = key.id; save(latest); return { name: key.name, switched };
    }
    if (![401, 402].includes(status)) throw new Error(`Сервер вернул HTTP ${status}. Проверьте адрес и совместимость API.`);
  }
  throw new Error('Проверка не прошла: ключи отклонены или лимит исчерпан (401/402).');
}

let primaryModels: { endpoint: string; ids: string[] } | null = null;
export async function listPrimaryModels(): Promise<string[]> {
  primaryModels = null;
  const data = load(); if (!data.endpoint || !data.keys.length) throw new Error('Укажите адрес и добавьте ключ AI STAR.');
  const ordered = [...data.keys]; const i = ordered.findIndex(k => k.id === data.activeId); if (i > 0) ordered.unshift(...ordered.splice(i, 1));
  const target = data.endpoint.endsWith('/models') ? data.endpoint : `${data.endpoint}/models`;
  for (const key of data.autoSwitch ? ordered : ordered.slice(0, 1)) {
    let response: Response;
    try { response = await fetch(target, { headers: { Authorization: `Bearer ${key.secret}` }, redirect: 'manual', signal: AbortSignal.timeout(10000) }); } catch { throw new Error('Не удалось загрузить модели AI STAR.'); }
    if ([401, 402].includes(response.status)) { await response.body?.cancel(); continue; }
    if (!response.ok) { const status = response.status; await response.body?.cancel(); throw new Error(`AI STAR вернул HTTP ${status}.`); }
    let payload: unknown;
    try {
      const chunks: Uint8Array[] = []; let bytes = 0; if (!response.body) throw Error();
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) { bytes += chunk.length; if (bytes > 2_000_000) throw Error(); chunks.push(chunk); }
      payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch { throw new Error('Не удалось прочитать список моделей AI STAR.'); }
    if (!payload || typeof payload !== 'object' || !Array.isArray((payload as {data?: unknown}).data)) throw new Error('Неподдерживаемый формат списка моделей.');
    const ids = [...new Set((payload as {data: unknown[]}).data.map(x => x && typeof x === 'object' ? (x as {id?:unknown}).id : undefined).filter((x): x is string => typeof x === 'string' && x.length <= 200 && /^[a-z0-9._/-]+$/i.test(x)))].sort((a,b) => a.localeCompare(b));
    if (load().endpoint !== data.endpoint) throw new Error('Адрес изменился. Обновите список.');
    primaryModels = { endpoint: data.endpoint, ids }; return ids;
  }
  throw new Error('Ключи AI STAR отклонены или баланс исчерпан.');
}
export function selectPrimaryModel(model: unknown): void {
  const data = load(); if (typeof model !== 'string' || !primaryModels || primaryModels.endpoint !== data.endpoint || !primaryModels.ids.includes(model)) throw new Error('Загрузите список и выберите модель.'); data.model = model; save(data);
}
