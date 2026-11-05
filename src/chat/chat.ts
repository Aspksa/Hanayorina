import { Pool, PoolClient } from 'pg';
import { load as loadKeys, selectKey } from '../settings/keys';
import { cloudForRequest } from '../settings/cloud';

type Message = { role: 'user' | 'assistant'; content: string };
type Event = { type: string; [key: string]: unknown };
let pool: Pool | null = null;
export function initChat(): void { pool = new Pool({ max: 4, connectionTimeoutMillis: 5000 }); }
function db(): Pool { if (!pool) throw new Error('Для сохранения чатов настройте и запустите PostgreSQL. См. docs/setup.md.'); return pool; }
function id(value: unknown): string { if (typeof value !== 'string' || !/^[1-9][0-9]{0,17}$/.test(value)) throw new Error('Неверный идентификатор чата.'); return value; }
export async function conversations() { return (await db().query('SELECT id::text, title, updated_at FROM conversations ORDER BY updated_at DESC, id DESC LIMIT 200')).rows; }
export async function messages(value: unknown) { const chat = id(value); const found = await db().query('SELECT id FROM conversations WHERE id=$1', [chat]); if (!found.rowCount) throw new Error('Чат не найден.'); return (await db().query('SELECT id::text, role, content, created_at FROM (SELECT id, role, content, created_at FROM messages WHERE conversation_id=$1 ORDER BY id DESC LIMIT 1000) AS recent ORDER BY id', [chat])).rows; }

async function requestProvider(url: string, secret: string, model: string, history: Message[], signal: AbortSignal): Promise<Response> {
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` }, body: JSON.stringify({ model, messages: history, stream: true }), redirect: 'manual', signal });
}
async function upstream(history: Message[], signal: AbortSignal): Promise<{ response: Response; provider: string; model: string }> {
  const primary = loadKeys();
  const ordered = [...primary.keys]; const active = ordered.findIndex(k => k.id === primary.activeId); if (active > 0) ordered.unshift(...ordered.splice(active, 1));
  let rejected = !primary.endpoint || !primary.model || !ordered.length;
  if (!rejected) {
    const endpoint = primary.endpoint.replace(/\/models\/?$/, '') + '/chat/completions';
    for (const key of primary.autoSwitch ? ordered : ordered.slice(0, 1)) {
      let response: Response;
      try { response = await requestProvider(endpoint, key.secret, primary.model!, history, signal); }
      catch { throw new Error('Не удалось получить ответ AI STAR. Повтор автоматически не отправлен: запрос мог быть принят сервисом.'); }
      if (response.ok && response.body) { if (primary.activeId !== key.id) selectKey(key.id); return { response, provider: 'AI STAR', model: primary.model! }; }
      const status = response.status; await response.body?.cancel();
      if ([401, 402].includes(status)) { rejected = true; continue; }
      if (status === 429) { rejected = true; break; }
      throw new Error(`AI STAR вернул HTTP ${status}. Автоматический повтор не выполнен.`);
    }
  }
  const backup = cloudForRequest();
  if (!rejected || !backup.enabled || !backup.secret || !backup.model) throw new Error('AI STAR недоступен или не настроен. Проверьте ключи, модель и настройки резерва Cloud.ru.');
  let response: Response;
  try { response = await requestProvider('https://foundation-models.api.cloud.ru/v1/chat/completions', backup.secret, backup.model, history, signal); }
  catch { throw new Error('Cloud.ru не ответил. Повтор автоматически не отправлен: запрос мог быть принят сервисом.'); }
  if (!response.ok || !response.body) { const status = response.status; await response.body?.cancel(); throw new Error(`Cloud.ru вернул HTTP ${status}. Проверьте ключ, баланс и выбранную модель.`); }
  return { response, provider: 'Cloud.ru', model: backup.model };
}
async function consume(response: Response, emit: (e: Event) => void): Promise<string> {
  if (!response.body) throw new Error('Пустой ответ сервиса.');
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let pending = '', text = '', done = false;
  try {
    while (true) {
      const part = await reader.read(); pending += decoder.decode(part.value, { stream: !part.done });
      if (pending.length > 2_000_000) throw new Error('Слишком большой ответ сервиса.');
      pending = pending.replace(/\r\n/g, '\n');
      let boundary: number;
      while ((boundary = pending.indexOf('\n\n')) !== -1) {
        const block = pending.slice(0, boundary); pending = pending.slice(boundary + 2);
        const content = block.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
        if (!content) continue;
        if (content === '[DONE]') { done = true; break; }
        let item: { choices?: Array<{ delta?: { content?: unknown }; finish_reason?: unknown }> };
        try { item = JSON.parse(content); } catch { throw new Error('Получен некорректный поток ответа.'); }
        const delta = item.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta) { text += delta; if (text.length > 1_000_000) throw new Error('Ответ превышает допустимый размер.'); emit({ type: 'delta', text: delta }); }
      }
      if (done || part.done) break;
    }
    if (!done) throw new Error('Поток ответа прервался до завершения.');
    return text;
  } catch (error) {
    if (text) throw new PartialResponse(error instanceof Error ? error.message : 'Ответ прервался.', text);
    throw error;
  } finally { try { await reader.cancel(); } catch {} }
}
class PartialResponse extends Error { constructor(message: string, readonly text: string) { super(message); } }
export async function send(value: unknown, input: unknown, emit: (e: Event) => void, signal: AbortSignal): Promise<void> {
  if (typeof input !== 'string' || !input.trim() || input.length > 20000) throw new Error('Сообщение должно содержать от 1 до 20000 символов.');
  const primary = loadKeys(); const cloud = cloudForRequest();
  if ((!primary.endpoint || !primary.model || !primary.keys.length) && (!cloud.enabled || !cloud.secret || !cloud.model)) throw new Error('Настройте адрес, ключ и модель AI STAR или резерв Cloud.ru.');
  const connection: PoolClient = await db().connect(); let chat = value == null ? null : id(value); let locked = false;
  try {
    if (chat) {
      const result = await connection.query('SELECT pg_try_advisory_lock($1::bigint) AS locked', [chat]);
      locked = result.rows[0].locked; if (!locked) throw new Error('В этом чате уже формируется ответ.');
      const existing = await connection.query('SELECT id FROM conversations WHERE id=$1', [chat]); if (!existing.rowCount) throw new Error('Чат не найден.');
    } else {
      const created = await connection.query('INSERT INTO conversations(title) VALUES ($1) RETURNING id::text', [input.trim().slice(0, 80)]); chat = created.rows[0].id;
      const result = await connection.query('SELECT pg_try_advisory_lock($1::bigint) AS locked', [chat]); locked = result.rows[0].locked; if (!locked) throw new Error('В этом чате уже формируется ответ.');
    }
    await connection.query('INSERT INTO messages(conversation_id, role, content) VALUES ($1,$2,$3)', [chat, 'user', input.trim()]);
    await connection.query('UPDATE conversations SET updated_at=now() WHERE id=$1', [chat]);
    emit({ type: 'chat', id: chat });
    const rows = await connection.query("SELECT role, content FROM (SELECT id, role, content FROM messages WHERE conversation_id=$1 AND role IN ('user','assistant') ORDER BY id DESC LIMIT 20) AS recent ORDER BY id", [chat]);
    const result = await upstream(rows.rows as Message[], AbortSignal.any([signal, AbortSignal.timeout(120000)])); emit({ type: 'provider', provider: result.provider, model: result.model });
    try {
      const answer = await consume(result.response, emit);
      if (!answer) throw new Error('Модель вернула пустой ответ.');
      await connection.query('INSERT INTO messages(conversation_id, role, content) VALUES ($1,$2,$3)', [chat, 'assistant', answer]);
      await connection.query('UPDATE conversations SET updated_at=now() WHERE id=$1', [chat]); emit({ type: 'done' });
    } catch (error) {
      if (error instanceof PartialResponse && error.text) await connection.query('INSERT INTO messages(conversation_id, role, content) VALUES ($1,$2,$3)', [chat, 'assistant', `${error.text}\n\n[Ответ прерван]`]);
      throw error;
    }
  } finally {
    if (locked && chat) { try { await connection.query('SELECT pg_advisory_unlock($1::bigint)', [chat]); } catch {} }
    connection.release();
  }
}
