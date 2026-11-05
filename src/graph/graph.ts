import { extractExplicit } from '../memory/extract';
import { databasePool } from '../chat/chat';

// Bound the graph to keep rendering and response sizes predictable on modest hardware.
export async function knowledgeGraph() {
  const pool = databasePool();
  const memory = await pool.query(`
    SELECT m.id::text, left(m.content, 2000) AS content, left(m.source, 500) AS source,
           COALESCE(t.status, 'legacy') AS status, e.conversation_id::text AS conversation_id,
           e.message_id::text AS message_id, m.created_at, m.updated_at
    FROM memories m LEFT JOIN memory_metadata t ON t.memory_id=m.id
    LEFT JOIN LATERAL (SELECT conversation_id, message_id FROM memory_evidence WHERE memory_id=m.id ORDER BY created_at DESC, message_id DESC LIMIT 1) e ON true
    ORDER BY m.updated_at DESC, m.id DESC LIMIT 121
  `);
  const nodes = memory.rows.slice(0, 120);
  if (!nodes.length) return { nodes: [], links: [], truncated: false };
  const ids: string[] = nodes.map(node => node.id);
  const relationships = await pool.query(`
    SELECT knowledge_links.id::text, from_memory_id::text AS source,
           to_memory_id::text AS target, left(relation, 200) AS relation
    FROM knowledge_links
    WHERE from_memory_id = ANY($1::bigint[]) AND to_memory_id = ANY($1::bigint[])
    ORDER BY knowledge_links.id DESC LIMIT 351
  `, [ids]);
  return { nodes, links: relationships.rows.slice(0, 350), truncated: memory.rows.length > 120 || relationships.rows.length > 350 };
}

export async function reviewMemory(id: unknown, decision: unknown): Promise<void> {
  if (typeof id !== 'string' || !/^[1-9][0-9]{0,17}$/.test(id) || !['confirmed','rejected'].includes(String(decision))) throw new Error('Некорректная отметка.');
  const client = await databasePool().connect();
  try {
    await client.query('BEGIN');
    const item = await client.query('SELECT subject FROM memory_metadata WHERE memory_id=$1', [id]);
    if (!item.rowCount) throw new Error('Эту запись нельзя отметить.');
    const subject: string | null = item.rows[0].subject;
    if (subject) await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 48713))', [subject]);
    const locked = await client.query('SELECT memory_id FROM memory_metadata WHERE memory_id=$1 FOR UPDATE', [id]);
    if (!locked.rowCount) throw new Error('Эту запись нельзя отметить.');
    if (decision === 'confirmed' && subject) {
      await client.query("UPDATE memory_metadata SET status='superseded' WHERE subject=$1 AND memory_id<>$2 AND status IN ('confirmed','reported','needs_review')", [subject,id]);
    }
    await client.query('UPDATE memory_metadata SET status=$1 WHERE memory_id=$2', [decision,id]);
    await client.query('UPDATE memories SET updated_at=now() WHERE id=$1', [id]);
    await client.query('COMMIT');
  } catch (error) { try { await client.query('ROLLBACK'); } catch {} throw error; }
  finally { client.release(); }
}

function memoryId(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,17}$/.test(value)) throw new Error('Неверный идентификатор записи.');
  return value;
}
/** User-initiated edit creates a new version and keeps the previous source intact. */
export async function reviseMemory(value: unknown, text: unknown): Promise<void> {
  const id=memoryId(value);
  if(typeof text!=='string' || text.trim().length<4 || text.length>1000) throw new Error('Текст должен содержать от 4 до 1000 символов.');
  const fact=extractExplicit('Запомни: '+text);
  if(!fact) throw new Error('Проверьте текст: секреты и пароли не сохраняются в память.');
  const client=await databasePool().connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 48712))',[fact.normalized]);
    const item=await client.query('SELECT t.subject,t.kind FROM memory_metadata t WHERE t.memory_id=$1',[id]);
    if(!item.rowCount) throw new Error('Запись не найдена или недоступна для изменения.');
    const subject:string|null=item.rows[0].subject;
    if(subject)await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 48713))',[subject]);
    if(subject && fact.subject!==subject)throw new Error('Сохраните тему записи при изменении.');
    const locked=await client.query('SELECT memory_id FROM memory_metadata WHERE memory_id=$1 FOR UPDATE',[id]);
    if(!locked.rowCount)throw new Error('Запись не найдена.');
    const existing=await client.query('SELECT memory_id FROM memory_metadata WHERE normalized=$1',[fact.normalized]);
    if(existing.rowCount)throw new Error('Такая запись уже существует.');
    const created=await client.query("INSERT INTO memories(content,source) VALUES($1,'Исправлено пользователем') RETURNING id::text",[fact.content]);
    const next=created.rows[0].id;
    await client.query("INSERT INTO memory_metadata(memory_id,normalized,subject,status,kind) VALUES($1,$2,$3,'confirmed',$4)",[next,fact.normalized,subject,item.rows[0].kind]);
    if(subject) await client.query("UPDATE memory_metadata SET status='superseded' WHERE subject=$1 AND memory_id<>$2 AND status IN ('confirmed','reported','needs_review')",[subject,next]);
    else await client.query("UPDATE memory_metadata SET status='superseded' WHERE memory_id=$1",[id]);
    await client.query('UPDATE memories SET updated_at=now() WHERE id=$1',[id]);
    await client.query("INSERT INTO knowledge_links(from_memory_id,to_memory_id,relation) VALUES($1,$2,'исправленная версия')",[id,next]);
    await client.query('COMMIT');
  } catch(error) {try{await client.query('ROLLBACK')}catch{} throw error;}
  finally {client.release();}
}
/** Deletion is explicitly triggered by the user in the graph. */
export async function deleteMemory(value: unknown): Promise<void> {
  const id=memoryId(value);
  const result=await databasePool().query('DELETE FROM memories WHERE id=$1 RETURNING id',[id]);
  if(!result.rowCount)throw new Error('Запись не найдена.');
}
