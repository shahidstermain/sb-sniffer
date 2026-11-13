import {
  DiagnosticSnapshot,
  STUDIO_INTROSPECTION_SQL,
} from '@sb-sniffer/core';
import pg from 'pg';

export interface CollectorOptions {
  connectionString: string;
  timeoutMs?: number;
}

/**
 * Normalizes connection URIs by URL-encoding unescaped special characters in passwords
 * (e.g. '!', '#', '$', '%') so node-postgres parses them safely without throwing URI malformed.
 */
export function normalizeConnectionString(uri: string): string {
  const trimmed = uri.trim();
  const protoMatch = trimmed.match(/^(postgres(?:ql)?:\/\/)(.+)$/i);
  if (!protoMatch) return trimmed;

  const [, proto, body] = protoMatch;
  const atIdx = body.lastIndexOf('@');
  if (atIdx === -1) return trimmed;

  const authPart = body.slice(0, atIdx);
  const hostPart = body.slice(atIdx + 1);
  const colonIdx = authPart.indexOf(':');
  if (colonIdx === -1) return trimmed;

  const user = authPart.slice(0, colonIdx);
  const rawPass = authPart.slice(colonIdx + 1);

  // Decode if already partially encoded to prevent double-encoding, then safely re-encode
  let decodedPass = rawPass;
  try {
    decodedPass = decodeURIComponent(rawPass);
  } catch {
    // ignore malformed percent sequences
  }

  const safePass = encodeURIComponent(decodedPass);
  return `${proto}${user}:${safePass}@${hostPart}`;
}

/**
 * Builds a node-postgres ClientConfig with password normalization, timeouts,
 * and automatic SSL detection (avoids forcing SSL against localhost/127.0.0.1).
 */
export function createPgClientConfig(connectionString: string, timeoutMs = 10000): pg.ClientConfig {
  const safeUri = normalizeConnectionString(connectionString);
  let isLocalHost = false;
  let sslMode: string | null = null;

  try {
    const parsed = new URL(safeUri);
    const host = parsed.hostname.toLowerCase();
    isLocalHost = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
    sslMode = parsed.searchParams.get('sslmode')?.toLowerCase() ?? null;
  } catch {
    // Fallback to string checks if URL parsing fails
    isLocalHost = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/i.test(safeUri);
  }

  let ssl: pg.ClientConfig['ssl'];
  if (sslMode === 'disable' || (isLocalHost && sslMode !== 'require' && sslMode !== 'verify-full')) {
    ssl = false;
  } else if (sslMode === 'verify-full' || sslMode === 'verify-ca') {
    ssl = { rejectUnauthorized: true };
  } else {
    ssl = { rejectUnauthorized: false };
  }

  return {
    connectionString: safeUri,
    statement_timeout: timeoutMs,
    query_timeout: timeoutMs,
    ssl,
  };
}

export async function collectLiveSnapshot(options: CollectorOptions): Promise<DiagnosticSnapshot> {
  const { connectionString, timeoutMs = 10000 } = options;

  // Enforce read-only and statement timeout to guarantee non-destructive safety
  const client = new pg.Client(createPgClientConfig(connectionString, timeoutMs));

  try {
    await client.connect();

    // Enforce session-level read-only so all subsequent queries cannot mutate state
    await client.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY;');

    // Run the introspection query
    let rawData: any = null;
    try {
      const res = await client.query(STUDIO_INTROSPECTION_SQL);
      rawData = res.rows[0]?.supabase_diagnostics;
    } catch (introspectErr: any) {
      // If unified query failed (e.g. missing storage schema on custom DB), attempt resilient fallback
      throw new Error(`Supabase introspection failed: ${introspectErr.message}`);
    }

    if (!rawData) {
      throw new Error('Introspection query returned empty result.');
    }

    // Try fetching pg_stat_statements if extension is active
    let statStatements: any[] = [];
    try {
      const statsRes = await client.query(`
        SELECT
          queryid::text AS "queryId",
          query,
          calls,
          total_exec_time AS "totalExecTimeMs",
          mean_exec_time AS "meanExecTimeMs",
          rows,
          shared_blks_hit AS "sharedBlksHit",
          shared_blks_read AS "sharedBlksRead"
        FROM pg_stat_statements
        ORDER BY total_exec_time DESC
        LIMIT 25;
      `);
      statStatements = statsRes.rows;
    } catch {
      // pg_stat_statements might not be enabled or user lacks permissions
    }

    const snapshot: DiagnosticSnapshot = {
      timestamp: rawData.timestamp || new Date().toISOString(),
      projectName: 'Live Supabase Instance',
      source: 'live_connection',
      tables: rawData.tables || [],
      policies: rawData.policies || [],
      indexes: rawData.indexes || [],
      foreignKeys: rawData.foreignKeys || [],
      triggers: rawData.triggers || [],
      extensions: rawData.extensions || [],
      connections: rawData.connections || undefined,
      realtimeTables: rawData.realtimeTables || [],
      storageBuckets: rawData.storageBuckets || [],
      storageObjects: rawData.storageObjects || [],
      views: rawData.views || [],
      materializedViews: rawData.materializedViews || [],
      foreignTables: rawData.foreignTables || [],
      statActivity: rawData.statActivity || [],
      statTables: rawData.statTables || [],
      statUserIndexes: rawData.statUserIndexes || [],
      statStatements,
    };

    return snapshot;
  } finally {
    await client.end().catch(() => {});
  }
}
