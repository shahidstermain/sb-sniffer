import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSnapshot, checkSplinterParity, parseSchemaDump } from '../index.js';

test('Splinter Parity Check 14: detects security_definer_view, auth_users_exposed, matview, foreign_table, and user_metadata RLS', () => {
  const sql = `
    CREATE VIEW public.user_profiles AS
      SELECT id, email FROM auth.users;

    CREATE VIEW public.safe_profiles WITH (security_invoker = true) AS
      SELECT id FROM public.profiles;

    CREATE MATERIALIZED VIEW public.monthly_revenue AS
      SELECT 1 AS total;

    CREATE FOREIGN TABLE public.external_logs (id int) SERVER log_srv;

    CREATE POLICY "admin_meta_only" ON public.profiles
      FOR SELECT TO authenticated
      USING ((auth.jwt() -> 'raw_user_meta_data' ->> 'role') = 'admin');
  `;

  const snapshot = parseSchemaDump(sql);
  const finding = checkSplinterParity(snapshot);

  assert.ok(finding, 'Expected SPLINTER_SECURITY_AND_API_EXPOSURE finding');
  assert.equal(finding.severity, 'critical');
  // user_profiles (security_definer_view + auth_users_exposed), monthly_revenue (matview), external_logs (foreign_table), admin_meta_only (user_metadata)
  // safe_profiles has security_invoker=true so it should NOT be flagged
  assert.equal(finding.affectedObjects.length, 5);
  assert.ok(finding.fixSql?.includes('ALTER VIEW "public"."user_profiles" SET (security_invoker = true);'));
  assert.ok(finding.fixSql?.includes('REVOKE ALL ON "public"."monthly_revenue" FROM anon, authenticated;'));
});

test('AST Schema Parser handles multi-line CREATE TABLE, inline REFERENCES, and CREATE INDEX', () => {
  const sql = `
    CREATE TABLE public."order_items" (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id uuid NOT NULL REFERENCES public.orders(id),
      product_id uuid NOT NULL
    );
    CREATE INDEX idx_order_items_order_id ON public.order_items (order_id);
  `;

  const snapshot = parseSchemaDump(sql);
  assert.equal(snapshot.tables.length, 1);
  assert.equal(snapshot.tables[0].name, 'order_items');
  assert.equal(snapshot.foreignKeys.length, 1);
  assert.equal(snapshot.foreignKeys[0].columns[0], 'order_id');
  assert.equal(snapshot.indexes.length, 2); // PK + explicit index
  assert.ok(snapshot.indexes.some((i) => i.columns[0] === "order_id"));

  const report = analyzeSnapshot(snapshot);
  // order_id is indexed, so RLS_MISSING_INDEX should not flag order_id
  const missingIdx = report.findings.find((f) => f.id === 'RLS_MISSING_INDEX');
  assert.equal(missingIdx, undefined);
});
