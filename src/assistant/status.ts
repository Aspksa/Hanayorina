import { databasePool } from '../chat/chat';
import { publicSettings } from '../settings/keys';
import { cloudSettings } from '../settings/cloud';
import { assistantCapabilities } from './capabilities';

export async function assistantStatus() {
  const primary = publicSettings();
  const cloud = cloudSettings();
  const services = {
    primary: Boolean(primary.endpoint && primary.model && primary.keys.length),
    cloud: Boolean(cloud.enabled && cloud.hasKey && cloud.model),
  };
  try {
    const result = await databasePool().query(`SELECT
      (SELECT count(*)::int FROM conversations) AS chats,
      (SELECT count(*)::int FROM memories) AS memories,
      (SELECT count(*)::int FROM knowledge_links) AS links,
      (SELECT count(*)::int FROM memory_jobs WHERE status='pending') AS pending,
      (SELECT count(*)::int FROM memory_jobs WHERE status='failed') AS failed,
      (SELECT count(*)::int FROM memory_metadata WHERE status='needs_review') AS review,
      (SELECT count(*)::int FROM memory_ai_jobs WHERE status='pending') AS ai_pending,
      (SELECT count(*)::int FROM memory_ai_jobs WHERE status='failed') AS ai_failed`);
    return { database: true, services, counts: result.rows[0], capabilities: assistantCapabilities(true, services.primary || services.cloud) };
  } catch {
    return { database: false, services, counts: null, capabilities: assistantCapabilities(false, services.primary || services.cloud) };
  }
}
