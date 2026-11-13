import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeSnapshot,
  BROKEN_SUPABASE_PROJECT_SNAPSHOT,
  checkRlsUnwrappedAuthFunc,
  checkRlsMissingIndex,
  checkRlsDisabledOrLockedOut,
  checkPoolerMismatch,
  checkConnectionExhaustion,
  checkAuthUsersTriggers,
  checkStorageOrphanedObjects,
  checkRealtimeConfig,
  checkStatStatements,
  checkSchemaHygiene,
  parseSchemaDump,
  DiagnosticFinding,
  AffectedObject,
} from '../index.js';

test('Core Check 1: RLS Unwrapped Auth detects raw auth.uid() and unwrapped helpers', () => {
  const finding = checkRlsUnwrappedAuthFunc(BROKEN_SUPABASE_PROJECT_SNAPSHOT);
  assert.ok(finding);
  assert.strictEqual(finding.id, 'RLS_UNWRAPPED_AUTH_FUNC');
  assert.strictEqual(finding.severity, 'critical');
  assert.ok(finding.fixSql?.includes('(select auth.uid())'));
});

test('Core Check 2: Missing Index detects unindexed foreign keys and filter columns', () => {
  const finding = checkRlsMissingIndex(BROKEN_SUPABASE_PROJECT_SNAPSHOT);
  assert.ok(finding);
  assert.strictEqual(finding.id, 'RLS_MISSING_INDEX');
  assert.ok(finding.fixSql?.includes('CREATE INDEX CONCURRENTLY'));
});

test('Core Check 3: RLS Disabled or Locked Out detects public tables with RLS off or 0 policies', () => {
  const finding = checkRlsDisabledOrLockedOut(BROKEN_SUPABASE_PROJECT_SNAPSHOT);
  assert.ok(finding);
  assert.strictEqual(finding.id, 'RLS_DISABLED_OR_LOCKED_OUT');
  assert.ok(finding.affectedObjects.some((o: AffectedObject) => o.name === 'audit_logs'));
  assert.ok(finding.affectedObjects.some((o: AffectedObject) => o.name === 'internal_notes'));
});

test('Core Check 4: Pooler Mismatch detects prepared statements on port 6543', () => {
  const finding = checkPoolerMismatch(BROKEN_SUPABASE_PROJECT_SNAPSHOT);
  assert.ok(finding);
  assert.strictEqual(finding.id, 'POOLER_PORT_AND_PREPARED_STMT_MISMATCH');
  assert.ok(finding.remediationExplanation.includes('pgbouncer=true'));
});

test('Core Check 5: Connection Exhaustion detects pool saturation and idle in transaction', () => {
  const finding = checkConnectionExhaustion(BROKEN_SUPABASE_PROJECT_SNAPSHOT);
  assert.ok(finding);
  assert.strictEqual(finding.id, 'CONNECTION_EXHAUSTION_AND_IDLE_LEAKS');
  assert.ok(finding.fixSql?.includes('idle_in_transaction_session_timeout'));
});

test('Core Check 6: Auth Triggers detects sync HTTP and missing exception handlers', () => {
  const finding = checkAuthUsersTriggers(BROKEN_SUPABASE_PROJECT_SNAPSHOT);
  assert.ok(finding);
  assert.strictEqual(finding.id, 'AUTH_USERS_BLOCKING_TRIGGERS');
  assert.strictEqual(finding.severity, 'critical');
});

test('Core Check 7: Storage Orphans detects orphaned files and missing storage RLS', () => {
  const finding = checkStorageOrphanedObjects(BROKEN_SUPABASE_PROJECT_SNAPSHOT);
  assert.ok(finding);
  assert.strictEqual(finding.id, 'STORAGE_ORPHANED_OBJECTS_AND_POLICIES');
});

test('Core Check 8: Realtime Replica Identity detects missing REPLICA IDENTITY FULL', () => {
  const finding = checkRealtimeConfig(BROKEN_SUPABASE_PROJECT_SNAPSHOT);
  assert.ok(finding);
  assert.strictEqual(finding.id, 'REALTIME_PUBLICATION_MISCONFIG');
  assert.ok(finding.fixSql?.includes('REPLICA IDENTITY FULL'));
});

test('Core Check 9: Stat Statements detects slow queries and buffer cache misses', () => {
  const finding = checkStatStatements(BROKEN_SUPABASE_PROJECT_SNAPSHOT);
  assert.ok(finding);
  assert.strictEqual(finding.id, 'PG_STAT_STATEMENTS_HOTSPOTS');
});

test('Core Check 10: Schema Hygiene detects extensions in public schema and table bloat', () => {
  const finding = checkSchemaHygiene(BROKEN_SUPABASE_PROJECT_SNAPSHOT);
  assert.ok(finding);
  assert.strictEqual(finding.id, 'SCHEMA_BLOAT_AND_EXTENSIONS_HYGIENE');
  assert.ok(finding.fixSql?.includes('SET SCHEMA extensions'));
});

test('End-to-End Analysis on Broken Demo triggers all 10+ checks and calculates health score', () => {
  const report = analyzeSnapshot(BROKEN_SUPABASE_PROJECT_SNAPSHOT);
  assert.strictEqual(report.findings.length, 11);
  assert.ok(report.healthScore < 50, `Health score should be heavily penalized, was: ${report.healthScore}`);
  assert.strictEqual(report.grade, 'F');
  assert.strictEqual(report.summary.criticalCount >= 3, true);
});

test('Schema Dump Parser converts raw SQL into snapshot correctly', () => {
  const sql = `
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;
    CREATE TABLE public.todos (
      id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id uuid NOT NULL,
      task text NOT NULL
    );
    ALTER TABLE public.todos ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "todos_select" ON public.todos FOR SELECT USING (auth.uid() = user_id);
    ALTER TABLE public.todos ADD CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES auth.users(id);
    ALTER PUBLICATION supabase_realtime ADD TABLE public.todos;
  `;

  const snapshot = parseSchemaDump(sql);
  assert.strictEqual(snapshot.tables.length, 1);
  assert.strictEqual(snapshot.tables[0].rlsEnabled, true);
  assert.strictEqual(snapshot.policies.length, 1);
  assert.strictEqual(snapshot.policies[0].qual, 'auth.uid() = user_id');
  assert.strictEqual(snapshot.foreignKeys.length, 1);
  assert.strictEqual(snapshot.extensions.length, 1);
  assert.strictEqual(snapshot.realtimeTables?.length, 1);

  const findings = analyzeSnapshot(snapshot).findings;
  assert.ok(findings.some((f: DiagnosticFinding) => f.id === 'RLS_UNWRAPPED_AUTH_FUNC'));
  assert.ok(findings.some((f: DiagnosticFinding) => f.id === 'RLS_MISSING_INDEX'));
  assert.ok(findings.some((f: DiagnosticFinding) => f.id === 'SCHEMA_BLOAT_AND_EXTENSIONS_HYGIENE'));
});

