import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeSnapshot,
  checkAppCodeSecurity,
  checkAppDbCorrelation,
  checkEgressCostDrivers,
  DiagnosticSnapshot,
  formatSafeMigrationSql,
  scanAppCodeFiles,
} from '../index.js';

function createBaseSnapshot(): DiagnosticSnapshot {
  return {
    timestamp: new Date().toISOString(),
    source: 'schema_dump',
    tables: [{ schema: 'public', name: 'orders', rlsEnabled: true, replicaIdentity: 'd' }],
    policies: [],
    indexes: [],
    foreignKeys: [],
    triggers: [],
    extensions: [],
  };
}

test('Full-Stack Check 11: detects service_role leaks, :6543 pooler mismatch, Drizzle prepare:false, and SSR getSession()', () => {
  const snapshot = createBaseSnapshot();
  snapshot.appCode = scanAppCodeFiles([
    {
      path: '.env.local',
      content: [
        'NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...',
        'DATABASE_URL="postgresql://postgres.ref:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres"',
      ].join('\n'),
    },
    {
      path: 'src/db/index.ts',
      content: `import { drizzle } from 'drizzle-orm/postgres-js';\nimport postgres from 'postgres';\nconst client = postgres(process.env.DATABASE_URL!);`,
    },
    {
      path: 'src/middleware.ts',
      content: `export async function middleware() {\n  const { data } = await supabase.auth.getSession();\n}`,
    },
  ]);

  const finding = checkAppCodeSecurity(snapshot);
  assert.ok(finding, 'Expected APP_ENV_AND_DRIVER_MISCONFIG finding');
  assert.equal(finding.severity, 'critical');
  assert.equal(finding.affectedObjects.length, 4);
});

test('Full-Stack Check 12: correlates app .eq() filters against DB indexes and flags unbounded .select("*")', () => {
  const snapshot = createBaseSnapshot();
  snapshot.appCode = scanAppCodeFiles([
    {
      path: 'src/app/orders/page.tsx',
      content: `
        const { data } = await supabase.from('orders').select('*');
        const { data: filtered } = await supabase.from('orders').select('id').eq('tenant_id', orgId).limit(20);
      `,
    },
  ]);

  const finding = checkAppDbCorrelation(snapshot);
  assert.ok(finding, 'Expected APP_QUERY_AND_INDEX_MISMATCH finding');
  assert.equal(finding.severity, 'high');
  assert.ok(finding.fixSql?.includes('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_tenant_id'));
});

test('Check 13: detects Supabase Egress & Compute cost drivers', () => {
  const snapshot = createBaseSnapshot();
  snapshot.statStatements = [
    {
      query: 'SELECT * FROM public.orders WHERE status = $1',
      calls: 250,
      totalExecTimeMs: 5000,
      meanExecTimeMs: 20,
      rows: 50000,
      sharedBlksHit: 1000,
      sharedBlksRead: 50,
    },
  ];
  snapshot.statTables = [
    {
      schema: 'public',
      table: 'orders',
      seqScan: 1200,
      seqTupRead: 2500000,
      idxScan: 10,
      idxTupFetch: 50,
      nLiveTup: 5000,
      nDeadTup: 100,
      deadTupleRatio: 0.02,
    },
  ];
  snapshot.storageBuckets = [{ id: 'avatars', name: 'avatars', public: true }];

  const finding = checkEgressCostDrivers(snapshot);
  assert.ok(finding, 'Expected EGRESS_AND_COST_DRIVERS finding');
  assert.equal(finding.severity, 'high');
  assert.equal(finding.affectedObjects.length, 3);
});

test('formatSafeMigrationSql rewrites CREATE INDEX to CREATE INDEX CONCURRENTLY IF NOT EXISTS', () => {
  const snapshot = createBaseSnapshot();
  snapshot.foreignKeys = [
    {
      schema: 'public',
      table: 'orders',
      name: 'orders_user_id_fkey',
      columns: ['user_id'],
      foreignSchema: 'auth',
      foreignTable: 'users',
      foreignColumns: ['id'],
    },
  ];
  const report = analyzeSnapshot(snapshot);
  const safeSql = formatSafeMigrationSql(report.findings);
  assert.ok(safeSql.includes('CREATE INDEX CONCURRENTLY IF NOT EXISTS'));
});
