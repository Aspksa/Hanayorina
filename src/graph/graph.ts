import { databasePool } from '../chat/chat';

// Bound the graph to keep rendering and response sizes predictable on modest hardware.
export async function knowledgeGraph() {
  const pool = databasePool();
  const memory = await pool.query(`
    SELECT id::text, left(content, 2000) AS content, left(source, 500) AS source
    FROM memories ORDER BY updated_at DESC, memories.id DESC LIMIT 121
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
