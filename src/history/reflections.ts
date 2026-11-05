import { Pool } from 'pg';
import { containsSensitive } from '../memory/extract';

/** One inactive conversation per tick; an advisory lock avoids overlapping workers. */
export async function reflectOneConversation(pool: Pool): Promise<void> {
 const client=await pool.connect();
 try {
  await client.query('BEGIN');
  const lock=await client.query('SELECT pg_try_advisory_xact_lock(487154872) AS locked');
  if(!lock.rows[0].locked){await client.query('COMMIT');return;}
  await client.query(`INSERT INTO conversation_reflections(conversation_id,last_message_id,reviewed_at)
   SELECT c.id, x.last_id, now() FROM conversations c
   CROSS JOIN LATERAL (SELECT max(id) AS last_id FROM messages WHERE conversation_id=c.id AND status='completed') x
   LEFT JOIN conversation_reflections r ON r.conversation_id=c.id
   WHERE x.last_id IS NOT NULL AND c.updated_at < now()-interval '10 minutes'
     AND (r.last_message_id IS NULL OR r.last_message_id<x.last_id)
     AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id=c.id AND m.status='streaming')
   ORDER BY c.updated_at ASC,c.id ASC LIMIT 1
   ON CONFLICT (conversation_id) DO UPDATE SET last_message_id=EXCLUDED.last_message_id,reviewed_at=now()
   WHERE conversation_reflections.last_message_id<EXCLUDED.last_message_id`);
  await client.query('COMMIT');
 } catch(error) {try {await client.query('ROLLBACK')}catch{}throw error;} finally {client.release();}
}
export async function recentReflections(pool: Pool) {
 const sessions=await pool.query(`SELECT c.id::text, left(c.title,80) AS title, r.reviewed_at,
  r.last_message_id::text, (c.updated_at > r.reviewed_at) AS stale
  FROM conversation_reflections r JOIN conversations c ON c.id=r.conversation_id
  ORDER BY r.reviewed_at DESC,c.id DESC LIMIT 10`);
 const ids:string[]=sessions.rows.map(r=>r.id);if(!ids.length)return {sessions:[]};
 const memories=await pool.query(`SELECT conversation_id::text, id::text,content,kind,status,message_id::text FROM (
   SELECT e.conversation_id,m.id,left(m.content,500) AS content,t.kind,t.status,e.message_id,
    row_number() OVER(PARTITION BY e.conversation_id ORDER BY e.message_id DESC,m.id DESC) AS n
   FROM memory_evidence e JOIN memories m ON m.id=e.memory_id
   JOIN memory_metadata t ON t.memory_id=m.id
   WHERE e.conversation_id=ANY($1::bigint[]) AND t.status IN ('confirmed','reported','needs_review')
  ) items WHERE n<=10 ORDER BY conversation_id,n`,[ids]);
 const questions=await pool.query(`SELECT conversation_id::text,id::text,left(content,500) AS content FROM (
   SELECT conversation_id,id,content,row_number() OVER(PARTITION BY conversation_id ORDER BY id DESC) AS n
   FROM messages WHERE conversation_id=ANY($1::bigint[]) AND role='user' AND status='completed' AND content LIKE '%?%'
  ) q WHERE n<=3 ORDER BY id DESC`,[ids]);
 return {sessions:sessions.rows.map(session=>({...session,
   memories:memories.rows.filter(m=>m.conversation_id===session.id).slice(0,10),
   questions:questions.rows.filter(q=>q.conversation_id===session.id&&!containsSensitive(q.content)).slice(0,3)
 }))};
}
