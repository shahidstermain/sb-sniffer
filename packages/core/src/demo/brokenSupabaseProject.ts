import { DiagnosticSnapshot } from '../types.js';
import { BROKEN_SUPABASE_LOGS } from './brokenSupabaseLogs.js';

/**
 * Realistic "Broken SaaS Project" Snapshot.
 * Triggers all 10 common issues that clog the Supabase Support queue.
 * Used for instant live-demo walkthroughs and unit testing.
 */
export const BROKEN_SUPABASE_PROJECT_SNAPSHOT: DiagnosticSnapshot = {
  timestamp: new Date().toISOString(),
  projectName: 'Broken Acme SaaS (Demo)',
  source: 'demo',
  tables: [
    {
      schema: 'public',
      name: 'profiles',
      rlsEnabled: true,
      replicaIdentity: 'd',
      totalRowsEstimate: 45000,
    },
    {
      schema: 'public',
      name: 'organizations',
      rlsEnabled: true,
      replicaIdentity: 'd',
      totalRowsEstimate: 1200,
    },
    {
      schema: 'public',
      name: 'organization_members',
      rlsEnabled: true,
      replicaIdentity: 'd',
      totalRowsEstimate: 60000,
    },
    {
      schema: 'public',
      name: 'invoices',
      rlsEnabled: true,
      replicaIdentity: 'd',
      totalRowsEstimate: 180000,
      deadTuples: 42000,
      liveTuples: 138000,
    },
    {
      schema: 'public',
      name: 'audit_logs',
      rlsEnabled: false, // ISSUE 3: RLS disabled in public table!
      replicaIdentity: 'd',
      totalRowsEstimate: 950000,
    },
    {
      schema: 'public',
      name: 'internal_notes',
      rlsEnabled: true, // ISSUE 3b: RLS enabled with 0 policies!
      replicaIdentity: 'd',
      totalRowsEstimate: 500,
    },
    {
      schema: 'auth',
      name: 'users',
      rlsEnabled: true, // ISSUE 6b: RLS mistakenly enabled on auth.users!
      replicaIdentity: 'd',
      totalRowsEstimate: 45000,
    },
  ],
  policies: [
    // ISSUE 1: Unwrapped auth.uid() causing per-row function evaluation instead of initPlan
    {
      schema: 'public',
      table: 'profiles',
      name: 'Users can read own profile',
      command: 'SELECT',
      permissive: 'PERMISSIVE',
      roles: ['authenticated'],
      qual: 'auth.uid() = id',
      withCheck: null,
    },
    {
      schema: 'public',
      table: 'invoices',
      name: 'Users can view invoices of their org',
      command: 'SELECT',
      permissive: 'PERMISSIVE',
      roles: ['authenticated'],
      qual: 'organization_id IN (SELECT org_id FROM organization_members WHERE user_id = auth.uid())',
      withCheck: null,
    },
    // Multiple permissive policies combining with OR on invoices
    {
      schema: 'public',
      table: 'invoices',
      name: 'Allow billing admins full read',
      command: 'SELECT',
      permissive: 'PERMISSIVE',
      roles: ['authenticated'],
      qual: "auth.jwt() ->> 'role' = 'billing_admin'",
      withCheck: null,
    },
    {
      schema: 'public',
      table: 'invoices',
      name: 'Allow guest auditor read',
      command: 'SELECT',
      permissive: 'PERMISSIVE',
      roles: ['authenticated'],
      qual: "auth.email() LIKE '%@auditor.com'",
      withCheck: null,
    },
  ],
  indexes: [
    {
      schema: 'public',
      table: 'profiles',
      name: 'profiles_pkey',
      columns: ['id'],
      isUnique: true,
      isPrimary: true,
      scans: 12040,
    },
    {
      schema: 'public',
      table: 'organizations',
      name: 'organizations_pkey',
      columns: ['id'],
      isUnique: true,
      isPrimary: true,
      scans: 8900,
    },
    // Note: organization_members and invoices are missing indexes on org_id and user_id!
    // ISSUE 10c: Huge unused index
    {
      schema: 'public',
      table: 'invoices',
      name: 'idx_invoices_deprecated_legacy_search',
      columns: ['created_at', 'status', 'description'],
      isUnique: false,
      isPrimary: false,
      scans: 0,
      sizeBytes: 84 * 1024 * 1024, // 84 MB unused index!
    },
  ],
  foreignKeys: [
    // ISSUE 2: Missing indexes on foreign keys
    {
      schema: 'public',
      table: 'organization_members',
      name: 'fk_org_members_user_id',
      columns: ['user_id'],
      foreignSchema: 'auth',
      foreignTable: 'users',
      foreignColumns: ['id'],
    },
    {
      schema: 'public',
      table: 'organization_members',
      name: 'fk_org_members_org_id',
      columns: ['org_id'],
      foreignSchema: 'public',
      foreignTable: 'organizations',
      foreignColumns: ['id'],
    },
    {
      schema: 'public',
      table: 'invoices',
      name: 'fk_invoices_organization_id',
      columns: ['organization_id'],
      foreignSchema: 'public',
      foreignTable: 'organizations',
      foreignColumns: ['id'],
    },
  ],
  triggers: [
    // ISSUE 6: Fragile auth.users trigger with sync HTTP call and no exception block
    {
      schema: 'auth',
      table: 'users',
      name: 'on_auth_user_created',
      functionSchema: 'public',
      functionName: 'handle_new_user',
      timing: 'AFTER',
      event: 'INSERT',
      functionDef: `
        BEGIN
          -- Insert profile
          INSERT INTO public.profiles (id, email, full_name)
          VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name');

          -- Synchronous webhook call during user signup transaction
          PERFORM extensions.http_post(
            'https://api.thirdparty-crm.com/v1/leads',
            json_build_object('user_id', NEW.id, 'email', NEW.email)::text,
            'application/json'
          );
          RETURN NEW;
        END;
      `,
    },
  ],
  extensions: [
    // ISSUE 10a: Extensions installed into public schema instead of extensions
    {
      name: 'uuid-ossp',
      schema: 'public',
      version: '1.1',
    },
    {
      name: 'pg_stat_statements',
      schema: 'extensions',
      version: '1.10',
    },
    {
      name: 'pgcrypto',
      schema: 'public',
      version: '1.3',
    },
  ],
  connections: {
    // ISSUE 4 & 5: Pooler port 6543 with active prepared statements + high exhaustion
    port: 6543,
    poolerMode: 'transaction',
    maxConnections: 100,
    activeConnections: 58,
    idleConnections: 31,
    idleInTransaction: 5,
    idleInTransactionLongestSeconds: 142,
    preparedStatementsCount: 14,
    isSupavisorDetected: true,
    connectionsByApp: {
      'nextjs-serverless-worker': 62,
      'supabase-studio': 5,
      'unknown-client': 22,
    },
  },
  storageBuckets: [
    {
      id: 'avatars',
      name: 'avatars',
      public: true,
    },
    {
      id: 'receipts',
      name: 'receipts',
      public: false,
    },
  ],
  storageObjects: [
    // ISSUE 7: Orphaned objects from deleted buckets & no RLS policies on storage.objects
    {
      bucketId: 'deleted_temporary_bucket',
      name: 'temp_doc_99182.pdf',
      owner: null,
      createdAt: '2026-09-12T10:00:00Z',
    },
    {
      bucketId: 'deleted_temporary_bucket',
      name: 'temp_doc_99183.pdf',
      owner: null,
      createdAt: '2026-09-12T10:05:00Z',
    },
    {
      bucketId: 'receipts',
      name: 'org_12/invoice_491.pdf',
      owner: '00000000-0000-0000-0000-000000000000', // non-existent user
      createdAt: '2026-10-01T14:22:00Z',
    },
  ],
  realtimeTables: [
    // ISSUE 8: Table in publication with REPLICA IDENTITY DEFAULT
    {
      schema: 'public',
      table: 'invoices',
      inPublication: true,
      replicaIdentity: 'd', // default -> misses payload.old on UPDATE/DELETE
      rlsEnabled: true,
    },
    {
      schema: 'public',
      table: 'profiles',
      inPublication: true,
      replicaIdentity: 'd',
      rlsEnabled: true,
    },
  ],
  statStatements: [
    // ISSUE 9: Slow queries, low cache hit ratio, large offset
    {
      queryId: '109283741',
      query:
        'SELECT * FROM invoices WHERE organization_id = $1 ORDER BY created_at DESC OFFSET 45000 LIMIT 25',
      calls: 1420,
      totalExecTimeMs: 498000,
      meanExecTimeMs: 350.7,
      rows: 35500,
      sharedBlksHit: 1200,
      sharedBlksRead: 85000, // heavily misses RAM cache
      cacheHitRatio: 0.014,
    },
    {
      queryId: '298374102',
      query:
        'SELECT p.*, count(i.id) FROM profiles p LEFT JOIN invoices i ON i.organization_id = p.id GROUP BY p.id',
      calls: 420,
      totalExecTimeMs: 382000,
      meanExecTimeMs: 909.5,
      rows: 4200,
      sharedBlksHit: 4500,
      sharedBlksRead: 198000,
      cacheHitRatio: 0.022,
    },
  ],
  statActivity: [
    {
      pid: 24192,
      user: 'authenticated',
      clientAddr: '192.168.1.14',
      applicationName: 'nextjs-serverless-worker',
      state: 'idle in transaction',
      waitEventType: 'Client',
      waitEvent: 'ClientRead',
      query: 'BEGIN; SELECT * FROM invoices WHERE organization_id = $1 FOR UPDATE;',
      durationSeconds: 142,
      stateChange: '2026-11-13T04:54:12Z',
    },
    {
      pid: 24198,
      user: 'authenticated',
      clientAddr: '192.168.1.15',
      applicationName: 'nextjs-serverless-worker',
      state: 'active',
      waitEventType: 'IO',
      waitEvent: 'DataFileRead',
      query: 'SELECT * FROM invoices WHERE organization_id = $1 ORDER BY created_at DESC OFFSET 45000 LIMIT 25;',
      durationSeconds: 12,
      stateChange: '2026-11-13T04:56:22Z',
    },
    {
      pid: 24203,
      user: 'postgres',
      clientAddr: '10.0.4.12',
      applicationName: 'supabase-studio',
      state: 'idle',
      waitEventType: 'Client',
      waitEvent: 'ClientRead',
      query: 'SELECT * FROM pg_stat_activity;',
      durationSeconds: 0,
      stateChange: '2026-11-13T04:56:30Z',
    },
    {
      pid: 24207,
      user: 'authenticated',
      clientAddr: '192.168.1.20',
      applicationName: 'nextjs-serverless-worker',
      state: 'idle',
      waitEventType: 'Client',
      waitEvent: 'ClientRead',
      query: 'SELECT * FROM profiles WHERE id = $1;',
      durationSeconds: 0,
      stateChange: '2026-11-13T04:56:29Z',
    },
  ],
  statTables: [
    {
      schema: 'public',
      table: 'invoices',
      seqScan: 18420,
      seqTupRead: 34500000,
      idxScan: 1240,
      idxTupFetch: 14000,
      nLiveTup: 138000,
      nDeadTup: 42000,
      deadTupleRatio: 23.3,
      lastVacuum: null,
      lastAutovacuum: '2026-11-10T12:00:00Z',
      sizeBytes: 148 * 1024 * 1024,
    },
    {
      schema: 'public',
      table: 'audit_logs',
      seqScan: 89000,
      seqTupRead: 98000000,
      idxScan: 0,
      idxTupFetch: 0,
      nLiveTup: 950000,
      nDeadTup: 5200,
      deadTupleRatio: 0.5,
      lastVacuum: null,
      lastAutovacuum: '2026-11-12T08:00:00Z',
      sizeBytes: 420 * 1024 * 1024,
    },
    {
      schema: 'public',
      table: 'profiles',
      seqScan: 120,
      seqTupRead: 54000,
      idxScan: 34000,
      idxTupFetch: 34000,
      nLiveTup: 45000,
      nDeadTup: 1200,
      deadTupleRatio: 2.6,
      lastVacuum: '2026-11-11T00:00:00Z',
      lastAutovacuum: '2026-11-12T18:00:00Z',
      sizeBytes: 18 * 1024 * 1024,
    },
  ],
  statUserIndexes: [
    {
      schema: 'public',
      table: 'invoices',
      indexName: 'idx_invoices_deprecated_legacy_search',
      idxScan: 0,
      idxTupRead: 0,
      idxTupFetch: 0,
      sizeBytes: 84 * 1024 * 1024,
      isUnused: true,
    },
    {
      schema: 'public',
      table: 'profiles',
      indexName: 'profiles_pkey',
      idxScan: 34000,
      idxTupRead: 34000,
      idxTupFetch: 34000,
      sizeBytes: 4 * 1024 * 1024,
      isUnused: false,
    },
    {
      schema: 'public',
      table: 'organizations',
      indexName: 'organizations_pkey',
      idxScan: 8900,
      idxTupRead: 8900,
      idxTupFetch: 8900,
      sizeBytes: 1 * 1024 * 1024,
      isUnused: false,
    },
  ],
  logs: BROKEN_SUPABASE_LOGS,
};
