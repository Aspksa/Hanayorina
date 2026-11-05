import { Pool } from 'pg';
import { createHash } from 'node:crypto';
import { load } from '../settings/keys';
import { topics } from './extract';

type Memory = { id: string; content: string; status: string };
let lastEmbeddingAttempt = 0;
let embeddingsSuspended = false;
let embeddingPausedUntil = 0;
function pauseEmbedding(): null { embeddingPausedUntil = Date.now() + 300000; return null; }
const vectorModel = () => (process.env.MEMORY_EMBEDDING_MODEL || '').trim().slice(0, 200);
async function embedding(text: string): Promise<{ vector: number[]; model: string } | null> {
  const model = vectorModel(); if (!model || !/^[a-z0-9._/-]+$/i.test(model) || Date.now() < embeddingPausedUntil) return null;
  const config = load(); const key = config.keys.find(k => k.id === config.activeId) || config.keys[0];
  if (!key || !config.endpoint) return null;
  try {
    const url = config.endpoint.replace(/\/models\/?$/, '') + '/embeddings';
    const response = await fetch(url, { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${key.secret}` }, body:JSON.stringify({ model, input:text.slice(0, 2000) }), redirect:'manual', signal:AbortSignal.timeout(6000) });
    if (!response.ok) { await response.body?.cancel(); return pauseEmbedding(); }
    if (!response.body) return pauseEmbedding();
    const chunks: Uint8Array[] = []; let size = 0;
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) { size += chunk.length; if (size > 200000) return pauseEmbedding(); chunks.push(chunk); }
    const data: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const vector = (data as { data?: Array<{embedding?: unknown}> })?.data?.[0]?.embedding;
    if (!Array.isArray(vector) || vector.length < 2 || vector.length > 4096 || !vector.every((n:unknown) => typeof n === 'number' && Number.isFinite(n)) || vector.every((n:number) => n === 0)) return pauseEmbedding();
    const tag = createHash('sha256').update(config.endpoint + '\0' + model).digest('hex');
    return {vector, model: tag};
  } catch { return pauseEmbedding(); }
}
async function vectorTableExists(pool: Pool): Promise<boolean> { const result=await pool.query("SELECT to_regclass('memory_embeddings') IS NOT NULL AS present"); return Boolean(result.rows[0]?.present); }
export async function embedNextMemory(pool: Pool): Promise<void> {
  if (!vectorModel() || embeddingsSuspended || Date.now() - lastEmbeddingAttempt < 300000 || !await vectorTableExists(pool)) return;
  const model = createHash('sha256').update(load().endpoint + '\0' + vectorModel()).digest('hex');
  const row = await pool.query(`SELECT m.id::text,m.content FROM memories m JOIN memory_metadata t ON t.memory_id=m.id
    WHERE t.status IN ('reported','confirmed') AND NOT EXISTS (SELECT 1 FROM memory_embeddings e WHERE e.memory_id=m.id AND e.model=$1)
    ORDER BY m.id LIMIT 1`, [model]);
  if (!row.rowCount) return;
  const client = await pool.connect(); let locked = false;
  try {
    const lock = await client.query('SELECT pg_try_advisory_lock(hashtextextended($1, 48714)) AS locked', [model + ':' + row.rows[0].id]); locked = lock.rows[0].locked; if (!locked) return;
    const already = await client.query('SELECT 1 FROM memory_embeddings WHERE memory_id=$1 AND model=$2', [row.rows[0].id,model]); if (already.rowCount) return;
    lastEmbeddingAttempt = Date.now();
    const result=await embedding(row.rows[0].content); if (!result || result.model !== model) { embeddingsSuspended = true; return; }
    await client.query('INSERT INTO memory_embeddings(memory_id,model,dimensions,embedding) VALUES ($1,$2,$3,$4::vector) ON CONFLICT(memory_id,model) DO NOTHING', [row.rows[0].id,result.model,result.vector.length,`[${result.vector.join(',')}]`]);
  } finally { if (locked) { try { await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 48714))', [model + ':' + row.rows[0].id]); } catch {} } client.release(); }
}
export async function relevantMemories(pool: Pool, text: string): Promise<Memory[]> {
  const terms = topics(text).slice(0, 6); let semantic: Memory[] = [];
  try {
    if (vectorModel() && await vectorTableExists(pool)) {
      const model = createHash('sha256').update(load().endpoint + '\0' + vectorModel()).digest('hex');
      const available = await pool.query('SELECT 1 FROM memory_embeddings WHERE model=$1 LIMIT 1', [model]);
      const result = available.rowCount ? await embedding(text) : null;
      if (result) {
        const matched=await pool.query(`SELECT m.id::text, left(m.content,500) AS content, t.status FROM memory_embeddings e
          JOIN memories m ON m.id=e.memory_id JOIN memory_metadata t ON t.memory_id=m.id
          WHERE e.model=$1 AND e.dimensions=$2 AND t.status IN ('reported','confirmed') AND (e.embedding <=> $3::vector) < 0.5
          ORDER BY e.embedding <=> $3::vector LIMIT 5`, [result.model,result.vector.length,`[${result.vector.join(',')}]`]);
        semantic = matched.rows;
      }
    }
  } catch { /* Семантический поиск недоступен, оставляем локальный поиск по словам. */ }
  // Confirmed corrections are small, user-approved guidance even when the next question uses different words.
  const corrections = await pool.query("SELECT m.id::text, left(m.content,500) AS content, t.status FROM memories m JOIN memory_metadata t ON t.memory_id=m.id WHERE t.kind='correction' AND t.status='confirmed' ORDER BY m.updated_at DESC, m.id DESC LIMIT 2");
  if (!terms.length) return [...corrections.rows, ...semantic].filter((item, i, all) => all.findIndex(other => other.id === item.id) === i).slice(0, 5);
  const lexical = await pool.query(`SELECT m.id::text, left(m.content,500) AS content, t.status
    FROM memories m JOIN memory_metadata t ON t.memory_id=m.id
    WHERE t.status IN ('reported','confirmed') AND EXISTS (SELECT 1 FROM unnest($1::text[]) AS q(term) WHERE m.content ILIKE '%' || q.term || '%')
    ORDER BY m.updated_at DESC, m.id DESC LIMIT 5`, [terms]);
  const result = new Map<string,Memory>(); for (const item of [...corrections.rows,...semantic,...lexical.rows]) result.set(item.id,item);
  return [...result.values()].slice(0,5);
}
