import { Pool } from 'pg';
/** Timeline of reviewed and proposed memory from explicit linked sources, without model calls. */
export async function personalHistory(pool: Pool) {
 const result=await pool.query(`SELECT m.id::text, left(m.content,500) AS content, m.source,
   t.status, t.kind, m.created_at, m.updated_at,
   e.conversation_id::text, e.message_id::text
   FROM memories m JOIN memory_metadata t ON t.memory_id=m.id
   LEFT JOIN LATERAL (SELECT conversation_id,message_id FROM memory_evidence WHERE memory_id=m.id ORDER BY created_at DESC,message_id DESC LIMIT 1) e ON true
   WHERE t.status IN ('confirmed','reported','needs_review','superseded')
   ORDER BY m.updated_at DESC,m.id DESC LIMIT 51`);
 return { entries:result.rows.slice(0,50), truncated:result.rows.length>50 };
}
