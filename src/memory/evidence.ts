import { Pool } from 'pg';
import { containsSensitive } from './extract';

/** Read-only evidence overview. A text match is not proof of semantic correctness. */
export async function inspectEvidence(pool:Pool,value:unknown){
 if(typeof value!=='string'||!/^[1-9][0-9]{0,17}$/.test(value))throw new Error('Неверный идентификатор записи.');
 const item=await pool.query(`SELECT m.id::text,left(m.content,1000) AS content,m.source,t.kind,t.status,t.subject
  FROM memories m JOIN memory_metadata t ON t.memory_id=m.id WHERE m.id=$1`,[value]);
 if(!item.rowCount)throw new Error('Запись не найдена или недоступна для проверки.');
 const sources=await pool.query(`SELECT e.conversation_id::text,e.message_id::text,left(msg.content,500) AS content,
   e.created_at FROM memory_evidence e JOIN messages msg ON msg.id=e.message_id
   WHERE e.memory_id=$1 ORDER BY e.created_at DESC,e.message_id DESC LIMIT 20`,[value]);
 const conflicts=await pool.query(`SELECT m.id::text,left(m.content,500) AS content,t.status FROM knowledge_links l
   JOIN memories m ON m.id=CASE WHEN l.from_memory_id=$1 THEN l.to_memory_id ELSE l.from_memory_id END
   JOIN memory_metadata t ON t.memory_id=m.id
   WHERE (l.from_memory_id=$1 OR l.to_memory_id=$1) AND l.relation='возможное противоречие'
   ORDER BY m.updated_at DESC,m.id DESC LIMIT 10`,[value]);
 return {item:item.rows[0],sources:sources.rows.map(x=>({...x,content:containsSensitive(x.content)?'[Содержимое скрыто: возможно, содержит секрет]':x.content})),conflicts:conflicts.rows};
}
