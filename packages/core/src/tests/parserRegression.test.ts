import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSchemaDump,
  parseStudioJson,
  parseStatStatements,
  scanAppCodeFiles,
  checkRlsMissingIndex,
  checkRlsUnwrappedAuthFunc,
  checkRealtimeConfig,
  checkAuthUsersTriggers,
  checkSplinterParity,
  formatSafeMigrationSql,
} from '../index.js';

test('Parser: policy names with spaces are parsed', () => {
  const s = parseSchemaDump('CREATE TABLE public.t (id int PRIMARY KEY, o uuid);\nCREATE POLICY "my policy" ON public.t FOR SELECT TO authenticated USING (o = auth.uid());');
  assert.equal(s.policies.length, 1);
  assert.equal(s.policies[0].name, 'my policy');
});

test('Parser: DISABLE ROW LEVEL SECURITY and DROP POLICY are honored', () => {
  const s = parseSchemaDump('CREATE TABLE public.t (id int);\nALTER TABLE public.t ENABLE ROW LEVEL SECURITY;\nALTER TABLE public.t DISABLE ROW LEVEL SECURITY;\nCREATE POLICY p ON public.t FOR SELECT USING (true);\nDROP POLICY p ON public.t;');
  assert.equal(s.tables[0].rlsEnabled, false);
  assert.equal(s.policies.length, 0);
});

test('Parser: PRIMARY KEY covers a foreign key (no false positive)', () => {
  const s = parseSchemaDump('CREATE TABLE public.p (id int PRIMARY KEY);\nCREATE TABLE public.c (pid int PRIMARY KEY REFERENCES public.p(id));\nCREATE TABLE public.d (x int, pid int);\nALTER TABLE ONLY public.d ADD CONSTRAINT d_pkey PRIMARY KEY (pid);\nALTER TABLE ONLY public.d ADD CONSTRAINT d_fk FOREIGN KEY (pid) REFERENCES public.p(id);');
  const r = checkRlsMissingIndex(s);
  assert.ok(!r || !JSON.stringify(r).includes('fk_c_pid'));
  assert.ok(!r || !JSON.stringify(r).includes('d_fk'));
});

test('Parser: extension names with hyphens like uuid-ossp are preserved', () => {
  const s = parseSchemaDump('CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;');
  assert.equal(s.extensions.length, 1);
  assert.equal(s.extensions[0].name, 'uuid-ossp');
  assert.equal(s.extensions[0].schema, 'public');
});

test('Parser: CREATE POLICY extracts balanced nested parentheses in USING and WITH CHECK', () => {
  const sql = `
    CREATE TABLE public.docs (id uuid PRIMARY KEY, user_id uuid);
    CREATE POLICY "nested" ON public.docs FOR UPDATE TO authenticated
      USING (user_id = (select auth.uid()) AND (1 = 1))
      WITH CHECK (user_id = (select auth.uid()));
  `;
  const s = parseSchemaDump(sql);
  assert.equal(s.policies.length, 1);
  assert.equal(s.policies[0].qual, 'user_id = (select auth.uid()) AND (1 = 1)');
  assert.equal(s.policies[0].withCheck, 'user_id = (select auth.uid())');
});

test('Check 1: detects consecutive unwrapped auth.uid() policies without regex lastIndex false negatives', () => {
  const sql = `
    CREATE TABLE public.a (id uuid PRIMARY KEY, user_id uuid);
    CREATE POLICY "p1" ON public.a FOR SELECT TO authenticated USING (user_id = auth.uid());
    CREATE POLICY "p2" ON public.a FOR UPDATE TO authenticated USING (user_id = auth.uid());
    CREATE POLICY "p3" ON public.a FOR DELETE TO authenticated USING (current_setting('request.jwt.claims', true)::jsonb->>'sub' = user_id::text);
  `;
  const s = parseSchemaDump(sql);
  const f = checkRlsUnwrappedAuthFunc(s);
  assert.ok(f);
  assert.equal(f.metadata?.unwrappedCount, 3);
  assert.ok(f.fixSql?.includes('(select current_setting('));
});

test('Parser: multi-table ALTER PUBLICATION and out-of-order REPLICA IDENTITY FULL are synced', () => {
  const sql = `
    CREATE TABLE public.items (id int PRIMARY KEY);
    CREATE TABLE public.logs (id int PRIMARY KEY);
    ALTER PUBLICATION supabase_realtime ADD TABLE public.items, public.logs;
    ALTER TABLE public.items REPLICA IDENTITY FULL;
  `;
  const s = parseSchemaDump(sql);
  assert.equal(s.realtimeTables?.length, 2);
  const f = checkRealtimeConfig(s);
  assert.ok(f);
  assert.equal(f.affectedObjects.length, 1);
  assert.equal(f.affectedObjects[0].name, 'logs');
});

test('Parser: trigger function with custom dollar tag ($body$) and SECURITY DEFINER without search_path is detected', () => {
  const sql = `
    CREATE FUNCTION public.handle_user() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $body$
    BEGIN
      INSERT INTO public.profiles(id) VALUES (NEW.id);
      RETURN NEW;
    END;
    $body$;
    CREATE TRIGGER on_user AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_user();
  `;
  const s = parseSchemaDump(sql);
  const f = checkAuthUsersTriggers(s);
  assert.ok(f);
  assert.ok(f.affectedObjects.some((o) => o.detail?.includes('EXCEPTION')));
  assert.ok(f.affectedObjects.some((o) => o.detail?.includes('search_path')));
});

test('Studio JSON parser preserves views, materializedViews, and foreignTables for Splinter parity', () => {
  const raw = JSON.stringify([
    {
      supabase_diagnostics: {
        tables: [],
        policies: [],
        indexes: [],
        foreignKeys: [],
        triggers: [],
        extensions: [],
        views: [{ schema: 'public', name: 'v_users', securityInvoker: false, definition: 'SELECT * FROM auth.users' }],
        materializedViews: [{ schema: 'public', name: 'mv_stats' }],
        foreignTables: [{ schema: 'public', name: 'ft_ext' }],
      },
    },
  ]);
  const s = parseStudioJson(raw);
  const f = checkSplinterParity(s);
  assert.ok(f);
  assert.equal(f.affectedObjects.length, 4);
});

test('Stat statements CSV parser handles quoted SQL with spaces/commas and calculates cacheHitRatio', () => {
  const csv = [
    'query,calls,total_exec_time,mean_exec_time,rows,shared_blks_hit,shared_blks_read',
    '"SELECT id, name FROM public.orders WHERE status = $1",100,35000,350,2000,100,900',
  ].join('\n');
  const rows = parseStatStatements(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].query, 'SELECT id, name FROM public.orders WHERE status = $1');
  assert.equal(rows[0].calls, 100);
  assert.equal(rows[0].cacheHitRatio, 0.1);
});

test('App code parser detects multi-line .from(...).select("*")', () => {
  const app = scanAppCodeFiles([
    {
      path: 'src/lib/queries.ts',
      content: [
        'export async function loadOrders(supabase: any) {',
        '  return await supabase',
        "    .from('orders')",
        "    .select('*');",
        '}',
      ].join('\n'),
    },
  ]);
  assert.ok(app.items.some((i) => i.kind === 'unbounded_select_star' && i.table === 'orders'));
});

test('formatSafeMigrationSql strips BEGIN and COMMIT around CONCURRENTLY statements', () => {
  const sql = formatSafeMigrationSql([
    {
      id: 'TEST',
      category: 'rls',
      severity: 'high',
      title: 'Test',
      summary: 'Test',
      whyItClogsSupport: 'Test',
      affectedObjects: [],
      remediationExplanation: 'Test',
      fixSql: 'BEGIN;\nCREATE INDEX idx_t_c ON public.t(c);\nCOMMIT;',
    },
  ]);
  assert.ok(sql.includes('CREATE INDEX CONCURRENTLY IF NOT EXISTS'));
  assert.ok(!/^\s*BEGIN\s*;/im.test(sql));
  assert.ok(!/^\s*COMMIT\s*;/im.test(sql));
});
