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
      const v2 = await client.query("SELECT version FROM hanayorina_migrations WHERE version = $1", [2]);
      if (v2.rowCount === 0) {
        await client.query(`
          ALTER TABLE messages ADD COLUMN status text NOT NULL DEFAULT 'completed';
          ALTER TABLE messages ADD CONSTRAINT messages_status_check CHECK (status IN ('completed', 'streaming', 'interrupted', 'failed'));
          CREATE TABLE chat_requests (
            request_id uuid PRIMARY KEY,
            conversation_id bigint NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            assistant_message_id bigint NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
            status text NOT NULL CHECK (status IN ('streaming', 'completed', 'interrupted', 'failed')),
            created_at timestamptz NOT NULL DEFAULT now()
          );
          CREATE INDEX conversations_recent_order ON conversations (updated_at DESC, id DESC);
          CREATE INDEX messages_streaming_by_chat ON messages (conversation_id) WHERE status = 'streaming';
        `);
        await client.query("INSERT INTO hanayorina_migrations (version) VALUES ($1)", [2]);
      }
      const v3 = await client.query("SELECT version FROM hanayorina_migrations WHERE version = $1", [3]);
      if (v3.rowCount === 0) {
        await client.query(`
          CREATE TABLE memory_metadata (
            memory_id bigint PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
            normalized text NOT NULL UNIQUE,
            subject text,
            status text NOT NULL CHECK(status IN ('reported','needs_review','confirmed','superseded','rejected')),
            created_at timestamptz NOT NULL DEFAULT now()
          );
          CREATE INDEX memory_metadata_subject ON memory_metadata(subject) WHERE subject IS NOT NULL;
          CREATE TABLE memory_evidence (
            memory_id bigint NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
            message_id bigint NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
            conversation_id bigint NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            created_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY(memory_id, message_id)
          );
          CREATE TABLE memory_jobs (
            message_id bigint PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
            conversation_id bigint NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','done','failed')),
            attempts integer NOT NULL DEFAULT 0,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
          );
          CREATE INDEX memory_jobs_pending ON memory_jobs(created_at) WHERE status = 'pending';
        `);
        await client.query("INSERT INTO hanayorina_migrations (version) VALUES ($1)", [3]);
      }
      const v4 = await client.query("SELECT version FROM hanayorina_migrations WHERE version = $1", [4]);
      if (v4.rowCount === 0) {
        await client.query(`
          ALTER TABLE memory_metadata ADD COLUMN kind text NOT NULL DEFAULT 'fact';
          ALTER TABLE memory_metadata ADD CONSTRAINT memory_kind_check CHECK (kind IN ('fact','decision','correction'));
          CREATE TABLE memory_ai_jobs (
            message_id bigint PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
            conversation_id bigint NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','done','failed','skipped')),
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
          );
          CREATE INDEX memory_ai_jobs_pending ON memory_ai_jobs(created_at) WHERE status='pending';
          CREATE TABLE memory_ai_calls (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now());
          CREATE INDEX memory_ai_calls_recent ON memory_ai_calls(created_at DESC);
        `);
        await client.query("INSERT INTO hanayorina_migrations(version) VALUES ($1)", [4]);
      }
      const v5 = await client.query("SELECT version FROM hanayorina_migrations WHERE version = $1", [5]);
      if (v5.rowCount === 0) {
        await client.query(`CREATE TABLE conversation_reflections (
          conversation_id bigint PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
          last_message_id bigint NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
          reviewed_at timestamptz NOT NULL DEFAULT now()
        )`);
        await client.query("INSERT INTO hanayorina_migrations(version) VALUES ($1)", [5]);
      }
      const v6 = await client.query("SELECT version FROM hanayorina_migrations WHERE version = $1", [6]);
      if (v6.rowCount === 0) {
        await client.query(`CREATE TABLE library_index (
          root_hash text NOT NULL, path text NOT NULL, size_bytes bigint NOT NULL, mtime_ms double precision NOT NULL,
          content text NOT NULL, indexed_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(root_hash,path)
        )`);
        await client.query("INSERT INTO hanayorina_migrations(version) VALUES ($1)",[6]);
      }
      const vectorAvailable = await client.query("SELECT to_regtype('vector') IS NOT NULL AS available");
      if (vectorAvailable.rows[0].available) {
        await client.query(`CREATE TABLE IF NOT EXISTS memory_embeddings (
          memory_id bigint NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
          model text NOT NULL,
          dimensions integer NOT NULL,
          embedding vector NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY(memory_id, model)
        )`);
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
