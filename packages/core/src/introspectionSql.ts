/**
 * Unified Read-Only SQL Introspection Query for Supabase Projects.
 *
 * This single SQL snippet can be run by anyone inside the Supabase Studio SQL Editor
 * or executed via live connection by the CLI. It collects metadata without mutating
 * anything or reading sensitive user table rows.
 */
export const STUDIO_INTROSPECTION_SQL = `
WITH
-- 1. Tables in public and auth
tables_meta AS (
  SELECT
    c.relnamespace::regnamespace::text AS schema,
    c.relname AS name,
    c.relrowsecurity AS "rlsEnabled",
    c.relreplident::text AS "replicaIdentity",
    c.reltuples AS "totalRowsEstimate"
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind = 'r'
    AND n.nspname IN ('public', 'auth', 'storage')
),

-- 2. Policies
policies_meta AS (
  SELECT
    p.schemaname AS schema,
    p.tablename AS table,
    p.policyname AS name,
    p.cmd AS command,
    p.permissive AS permissive,
    p.roles AS roles,
    p.qual AS qual,
    p.with_check AS "withCheck"
  FROM pg_policies p
  WHERE p.schemaname IN ('public', 'auth', 'storage')
),

-- 3. Indexes (with covering columns in exact ordinal position)
indexes_meta AS (
  SELECT
    n.nspname AS schema,
    c.relname AS table,
    idx_c.relname AS name,
    ARRAY(
      SELECT pg_get_indexdef(i.indexrelid, k + 1, true)
      FROM generate_subscripts(i.indkey, 1) as k
      ORDER BY k
    ) AS columns,
    i.indisunique AS "isUnique",
    i.indisprimary AS "isPrimary",
    i.indisvalid AS "isValid",
    COALESCE(ui.idx_scan, 0) AS scans,
    pg_relation_size(i.indexrelid) AS "sizeBytes"
  FROM pg_index i
  JOIN pg_class c ON c.oid = i.indrelid
  JOIN pg_class idx_c ON idx_c.oid = i.indexrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_stat_user_indexes ui ON ui.indexrelid = i.indexrelid
  WHERE n.nspname IN ('public', 'auth', 'storage')
),

-- 4. Foreign Keys
fks_meta AS (
  SELECT
    n.nspname::text AS schema,
    c.relname::text AS "table",
    con.conname::text AS name,
    ARRAY(SELECT a.attname::text FROM unnest(con.conkey) WITH ORDINALITY k(attnum, ord)
          JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum ORDER BY k.ord) AS columns,
    fn.nspname::text AS "foreignSchema",
    fc.relname::text AS "foreignTable",
    ARRAY(SELECT a.attname::text FROM unnest(con.confkey) WITH ORDINALITY k(attnum, ord)
          JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.attnum ORDER BY k.ord) AS "foreignColumns"
  FROM pg_constraint con
  JOIN pg_class c ON c.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_class fc ON fc.oid = con.confrelid
  JOIN pg_namespace fn ON fn.oid = fc.relnamespace
  WHERE con.contype = 'f'
    AND n.nspname IN ('public', 'auth', 'storage')
),

-- 5. Triggers (especially auth.users and custom business logic)
triggers_meta AS (
  SELECT
    n.nspname AS schema,
    c.relname AS table,
    t.tgname AS name,
    fn_n.nspname AS "functionSchema",
    p.proname AS "functionName",
    CASE t.tgtype & 2 WHEN 2 THEN 'BEFORE' ELSE 'AFTER' END AS timing,
    CASE t.tgtype & 28
      WHEN 4 THEN 'INSERT'
      WHEN 8 THEN 'DELETE'
      WHEN 16 THEN 'UPDATE'
      ELSE 'EVENT'
    END AS event,
    pg_get_functiondef(p.oid) AS "functionDef",
    p.prosecdef AS "isSecurityDefiner",
    p.proconfig AS "proConfig"
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_proc p ON p.oid = t.tgfoid
  JOIN pg_namespace fn_n ON fn_n.oid = p.pronamespace
  WHERE NOT t.tgisinternal
    AND n.nspname IN ('public', 'auth', 'storage')
),

-- 6. Extensions
extensions_meta AS (
  SELECT
    extname AS name,
    n.nspname AS schema,
    extversion AS version
  FROM pg_extension e
  JOIN pg_namespace n ON n.oid = e.extnamespace
),

-- 7. Connections & Activity
conn_meta AS (
  SELECT
    (SELECT count(*)::int FROM pg_stat_activity WHERE state = 'active') AS "activeConnections",
    (SELECT count(*)::int FROM pg_stat_activity WHERE state = 'idle') AS "idleConnections",
    (SELECT count(*)::int FROM pg_stat_activity WHERE state = 'idle in transaction') AS "idleInTransaction",
    COALESCE(
      (SELECT extract(epoch from (now() - state_change))::int
       FROM pg_stat_activity
       WHERE state = 'idle in transaction'
       ORDER BY state_change ASC
       LIMIT 1),
      0
    ) AS "idleInTransactionLongestSeconds",
    (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') AS "maxConnections",
    COALESCE(
      (SELECT count(*)::int FROM pg_prepared_statements),
      0
    ) AS "preparedStatementsCount",
    COALESCE(inet_server_port(), 5432) AS port
),

-- 7b. Live pg_stat_activity Sessions (Diagnostics)
activity_meta AS (
  SELECT
    pid,
    usename::text AS "user",
    client_addr::text AS "clientAddr",
    application_name::text AS "applicationName",
    state::text AS state,
    wait_event_type::text AS "waitEventType",
    wait_event::text AS "waitEvent",
    LEFT(query, 250) AS query,
    COALESCE(extract(epoch from (now() - query_start))::int, 0) AS "durationSeconds",
    state_change::text AS "stateChange"
  FROM pg_stat_activity
  WHERE pid <> pg_backend_pid()
  ORDER BY state_change DESC
  LIMIT 50
),

-- 7c. Table Bloat & Scans from pg_stat_user_tables (Diagnostics)
tables_stat_meta AS (
  SELECT
    schemaname AS schema,
    relname AS table,
    seq_scan AS "seqScan",
    seq_tup_read AS "seqTupRead",
    idx_scan AS "idxScan",
    idx_tup_fetch AS "idxTupFetch",
    n_live_tup AS "nLiveTup",
    n_dead_tup AS "nDeadTup",
    CASE
      WHEN (n_live_tup + n_dead_tup) > 0
      THEN ROUND((n_dead_tup::numeric / (n_live_tup + n_dead_tup)::numeric) * 100, 1)::float
      ELSE 0
    END AS "deadTupleRatio",
    last_vacuum::text AS "lastVacuum",
    last_autovacuum::text AS "lastAutovacuum",
    pg_total_relation_size(relid) AS "sizeBytes"
  FROM pg_stat_user_tables
  WHERE schemaname IN ('public', 'auth', 'storage')
  ORDER BY n_dead_tup DESC
  LIMIT 50
),

-- 7d. Index Scans from pg_stat_user_indexes (Diagnostics)
indexes_stat_meta AS (
  SELECT
    schemaname AS schema,
    relname AS table,
    indexrelname AS "indexName",
    idx_scan AS "idxScan",
    idx_tup_read AS "idxTupRead",
    idx_tup_fetch AS "idxTupFetch",
    pg_relation_size(indexrelid) AS "sizeBytes",
    (idx_scan = 0 AND pg_relation_size(indexrelid) > 1048576) AS "isUnused"
  FROM pg_stat_user_indexes
  WHERE schemaname IN ('public', 'auth', 'storage')
  ORDER BY idx_scan ASC, pg_relation_size(indexrelid) DESC
  LIMIT 50
),

-- 8. Realtime Tables
realtime_meta AS (
  SELECT
    p.schemaname AS schema,
    p.tablename AS table,
    true AS "inPublication",
    c.relreplident::text AS "replicaIdentity",
    c.relrowsecurity AS "rlsEnabled"
  FROM pg_publication_tables p
  JOIN pg_class c ON c.relname = p.tablename
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = p.schemaname
  WHERE p.pubname = 'supabase_realtime'
),

-- 9. Storage Buckets (if schema exists)
buckets_meta AS (
  SELECT
    id::text,
    name::text,
    public
  FROM storage.buckets
  LIMIT 50
),

-- 10. Storage Objects sample
objects_meta AS (
  SELECT
    bucket_id::text AS "bucketId",
    name::text,
    owner::text,
    created_at::text AS "createdAt"
  FROM storage.objects
  LIMIT 200
),

-- 11. Views in public (check security_invoker & auth.users exposure)
views_meta AS (
  SELECT
    n.nspname AS schema,
    c.relname AS name,
    COALESCE('security_invoker=true' = ANY(c.reloptions), false) AS "securityInvoker",
    pg_get_viewdef(c.oid, true) AS definition
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind = 'v'
    AND n.nspname = 'public'
),

-- 12. Materialized Views in public
matviews_meta AS (
  SELECT
    n.nspname AS schema,
    c.relname AS name,
    pg_get_viewdef(c.oid, true) AS definition
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind = 'm'
    AND n.nspname = 'public'
),

-- 13. Foreign Tables in public
foreign_tables_meta AS (
  SELECT
    n.nspname AS schema,
    c.relname AS name
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind = 'f'
    AND n.nspname = 'public'
)

SELECT json_build_object(
  'timestamp', now(),
  'source', 'studio_json',
  'tables', (SELECT COALESCE(json_agg(t), '[]'::json) FROM tables_meta t),
  'policies', (SELECT COALESCE(json_agg(p), '[]'::json) FROM policies_meta p),
  'indexes', (SELECT COALESCE(json_agg(i), '[]'::json) FROM indexes_meta i),
  'foreignKeys', (SELECT COALESCE(json_agg(f), '[]'::json) FROM fks_meta f),
  'triggers', (SELECT COALESCE(json_agg(tr), '[]'::json) FROM triggers_meta tr),
  'extensions', (SELECT COALESCE(json_agg(e), '[]'::json) FROM extensions_meta e),
  'connections', (SELECT row_to_json(c) FROM conn_meta c),
  'statActivity', (SELECT COALESCE(json_agg(a), '[]'::json) FROM activity_meta a),
  'statTables', (SELECT COALESCE(json_agg(ts), '[]'::json) FROM tables_stat_meta ts),
  'statUserIndexes', (SELECT COALESCE(json_agg(is_meta), '[]'::json) FROM indexes_stat_meta is_meta),
  'realtimeTables', (SELECT COALESCE(json_agg(r), '[]'::json) FROM realtime_meta r),
  'storageBuckets', (SELECT COALESCE(json_agg(b), '[]'::json) FROM buckets_meta b),
  'storageObjects', (SELECT COALESCE(json_agg(o), '[]'::json) FROM objects_meta o),
  'views', (SELECT COALESCE(json_agg(v), '[]'::json) FROM views_meta v),
  'materializedViews', (SELECT COALESCE(json_agg(mv), '[]'::json) FROM matviews_meta mv),
  'foreignTables', (SELECT COALESCE(json_agg(ft), '[]'::json) FROM foreign_tables_meta ft)
) AS supabase_diagnostics;
`.trim();
