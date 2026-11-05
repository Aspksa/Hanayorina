import { config } from "dotenv";
import { Pool } from "pg";

config({ quiet: true });

export function databaseConfigured(): boolean {
  const values = [process.env.PGHOST, process.env.PGDATABASE, process.env.PGUSER];
  if (values.some(Boolean) && !values.every(Boolean)) {
    throw new Error("Set PGHOST, PGDATABASE and PGUSER together in .env.");
  }
  return values.every(Boolean);
}

export async function prepareDatabase(): Promise<void> {
  const pool = new Pool({ connectionTimeoutMillis: 5000, max: 1 });
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(741204822)");
      await client.query(`
        CREATE TABLE IF NOT EXISTS hanayorina_migrations (
          version integer PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      const result = await client.query("SELECT version FROM hanayorina_migrations WHERE version = $1", [1]);
      if (result.rowCount === 0) {
        await client.query(`
          CREATE TABLE conversations (
            id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            title text NOT NULL DEFAULT '',
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
          );
          CREATE TABLE messages (
            id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            conversation_id bigint NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            role text NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
            content text NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now()
          );
          CREATE INDEX messages_conversation_order ON messages (conversation_id, id);
          CREATE TABLE memories (
            id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            content text NOT NULL,
            source text,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
          );
          CREATE TABLE agents (
            id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            name text NOT NULL,
            description text NOT NULL DEFAULT '',
            created_at timestamptz NOT NULL DEFAULT now()
          );
          CREATE TABLE agent_tasks (
            id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            agent_id bigint REFERENCES agents(id) ON DELETE SET NULL,
            description text NOT NULL,
            status text NOT NULL DEFAULT 'pending',
            result text,
            created_at timestamptz NOT NULL DEFAULT now()
          );
          CREATE TABLE documents (
            id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            title text NOT NULL,
            local_path text,
            extracted_text text,
            created_at timestamptz NOT NULL DEFAULT now()
          );
          CREATE TABLE knowledge_links (
            id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            from_memory_id bigint NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
            to_memory_id bigint NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
            relation text NOT NULL DEFAULT '',
            UNIQUE (from_memory_id, to_memory_id, relation)
          );
          CREATE TABLE app_settings (
            key text PRIMARY KEY,
            value jsonb NOT NULL,
            updated_at timestamptz NOT NULL DEFAULT now()
          );
        `);
        await client.query("INSERT INTO hanayorina_migrations (version) VALUES ($1)", [1]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}
