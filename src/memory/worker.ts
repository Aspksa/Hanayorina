import { Pool, PoolClient } from 'pg';
import { containsSensitive, extractExplicit, topics } from './extract';
import { aiMemorySettings, runAiBatch } from './ai';
import { embedNextMemory } from './search';

async function processOne(client: PoolClient): Promise<boolean> {
  await client.query('BEGIN');
  let messageId: string | null = null;
  try {
    const job = await client.query(`SELECT j.message_id::text,j.conversation_id::text,m.content
      FROM memory_jobs j JOIN messages m ON m.id=j.message_id
      WHERE j.status='pending' AND m.role='user' AND m.status='completed'
      ORDER BY j.created_at, j.message_id LIMIT 1 FOR UPDATE OF j SKIP LOCKED`);
    if (!job.rowCount) { await client.query('COMMIT'); return false; }
    const row = job.rows[0], fact = extractExplicit(row.content); messageId = row.message_id;
    if (fact) {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 48712))', [fact.normalized]);
      const existing = await client.query('SELECT memory_id::text FROM memory_metadata WHERE normalized=$1', [fact.normalized]);
      let memoryId: string;
      if (existing.rowCount) memoryId = existing.rows[0].memory_id;
      else {
        if (fact.subject) await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 48713))', [fact.subject]);
        const conflicts = fact.subject ? await client.query("SELECT memory_id::text FROM memory_metadata WHERE subject=$1 AND status IN ('reported','confirmed','needs_review')", [fact.subject]) : { rows: [], rowCount: 0 };
        const status = conflicts.rowCount ? 'needs_review' : 'reported';
        const inserted = await client.query('INSERT INTO memories(content,source) VALUES ($1,$2) RETURNING id::text', [fact.content, 'Сообщение пользователя']);
        memoryId = inserted.rows[0].id;
        await client.query('INSERT INTO memory_metadata(memory_id,normalized,subject,status) VALUES ($1,$2,$3,$4)', [memoryId,fact.normalized,fact.subject,status]);
        if (conflicts.rowCount) {
          await client.query("UPDATE memory_metadata SET status='needs_review' WHERE subject=$1 AND memory_id<>$2 AND status IN ('reported','confirmed')", [fact.subject,memoryId]);
          for (const conflict of conflicts.rows) await client.query("INSERT INTO knowledge_links(from_memory_id,to_memory_id,relation) VALUES ($1,$2,'возможное противоречие') ON CONFLICT DO NOTHING", [conflict.memory_id,memoryId]);
        }
        const words = topics(fact.content);
        if (words.length) {
          const candidates = await client.query("SELECT m.id::text,m.content FROM memories m JOIN memory_metadata t ON t.memory_id=m.id WHERE m.id<>$1 AND t.status IN ('reported','confirmed') ORDER BY m.id DESC LIMIT 100", [memoryId]);
          let linked = 0;
          for (const candidate of candidates.rows) {
            const shared = topics(candidate.content).some(word => words.includes(word));
            if (shared) { await client.query("INSERT INTO knowledge_links(from_memory_id,to_memory_id,relation) VALUES ($1,$2,'общая тема (автоматически)') ON CONFLICT DO NOTHING", [memoryId,candidate.id]); if (++linked >= 5) break; }
          }
        }
      }
      await client.query('INSERT INTO memory_evidence(memory_id,message_id,conversation_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [memoryId,row.message_id,row.conversation_id]);
    }
    if (!fact && aiMemorySettings().enabled && !row.content.trim().startsWith('/') && row.content.trim().length >= 20 && !containsSensitive(row.content)) await client.query('INSERT INTO memory_ai_jobs(message_id,conversation_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [row.message_id,row.conversation_id]);
    await client.query("UPDATE memory_jobs SET status='done',updated_at=now() WHERE message_id=$1", [row.message_id]);
    await client.query('COMMIT'); return true;
  } catch (error) { try { await client.query('ROLLBACK'); if (messageId) await client.query("UPDATE memory_jobs SET attempts=attempts+1, status=CASE WHEN attempts+1>=3 THEN 'failed' ELSE 'pending' END, updated_at=now() WHERE message_id=$1 AND status='pending'", [messageId]); } catch {} throw error; }
}
let running = false;
export async function runMemoryBatch(pool: Pool, limit = 5): Promise<void> {
  if (running) return; running = true;
  try { const client = await pool.connect(); try { for (let i=0;i<limit;i++) if (!await processOne(client)) break; } finally { client.release(); } }
  finally { running = false; }
}
export function startMemoryWorker(pool: Pool): void {
  const tick = () => { void runMemoryBatch(pool).then(() => embedNextMemory(pool)).then(() => runAiBatch(pool)).catch(() => console.error('Фоновая обработка памяти временно недоступна.')); };
  setTimeout(tick, 3000).unref(); setInterval(tick, 15000).unref();
}
