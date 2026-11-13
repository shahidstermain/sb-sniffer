import { DiagnosticSnapshot } from '../types.js';

/**
 * Parses the JSON output from our unified read-only Supabase Studio Introspection Query.
 * This allows users to run 1 query in their Supabase Studio SQL Editor, copy the JSON,
 * and paste it directly into sb-sniffer without sharing any database credentials or passwords.
 */
export function parseStudioJson(jsonString: string): DiagnosticSnapshot {
  const parsed = typeof jsonString === 'string' ? JSON.parse(jsonString) : jsonString;

  // Handle case where query output wraps the json in an array row [{ "supabase_diagnostics": { ... } }]
  const root = Array.isArray(parsed)
    ? parsed[0]?.supabase_diagnostics || parsed[0]
    : parsed?.supabase_diagnostics || parsed;

  if (!root || typeof root !== 'object') {
    throw new Error('Invalid Studio Introspection JSON: expected an object or [{ "supabase_diagnostics": ... }] row.');
  }

  return {
    timestamp: root.timestamp || new Date().toISOString(),
    projectName: root.projectName || 'Supabase Project (Studio Dump)',
    source: 'studio_json',
    tables: root.tables || [],
    policies: root.policies || [],
    indexes: root.indexes || [],
    foreignKeys: root.foreignKeys || [],
    triggers: root.triggers || [],
    extensions: root.extensions || [],
    views: root.views || [],
    materializedViews: root.materializedViews || [],
    foreignTables: root.foreignTables || [],
    connections: root.connections || undefined,
    statStatements: root.statStatements || [],
    statActivity: root.statActivity || [],
    statTables: root.statTables || [],
    statUserIndexes: root.statUserIndexes || [],
    storageObjects: root.storageObjects || [],
    storageBuckets: root.storageBuckets || [],
    realtimeTables: root.realtimeTables || [],
    rawMeta: root.rawMeta || {},
  };
}
