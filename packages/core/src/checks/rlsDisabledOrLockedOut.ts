import { DiagnosticFinding, DiagnosticSnapshot } from '../types.js';

export function checkRlsDisabledOrLockedOut(snapshot: DiagnosticSnapshot): DiagnosticFinding | null {
  const publicTables = snapshot.tables.filter((t) => t.schema === 'public');

  // Supabase Linter Rule 0013: RLS disabled in public
  const rlsDisabledTables: typeof publicTables = [];
  // Supabase Linter Rule 0007: Policy exists, but RLS is disabled
  const policyExistsRlsDisabled: { table: typeof publicTables[0]; policyCount: number }[] = [];
  // Supabase Linter Rule 0008: RLS enabled, but 0 policies defined
  const rlsEnabledNoPolicy: typeof publicTables = [];

  for (const table of publicTables) {
    const policiesForTable = snapshot.policies.filter(
      (p) => p.schema === table.schema && p.table === table.name
    );

    if (!table.rlsEnabled) {
      rlsDisabledTables.push(table);
      if (policiesForTable.length > 0) {
        policyExistsRlsDisabled.push({ table, policyCount: policiesForTable.length });
      }
    } else {
      if (policiesForTable.length === 0) {
        rlsEnabledNoPolicy.push(table);
      }
    }
  }

  if (rlsDisabledTables.length === 0 && rlsEnabledNoPolicy.length === 0) {
    return null;
  }

  const affectedObjects: {
    schema?: string;
    name: string;
    type: 'table' | 'policy';
    detail: string;
  }[] = [];

  for (const { table, policyCount } of policyExistsRlsDisabled) {
    affectedObjects.push({
      schema: table.schema,
      name: table.name,
      type: 'table',
      detail: `[Rule 0007] CRITICAL: Table has ${policyCount} policy/policies defined, but RLS is DISABLED (relrowsecurity = false). Policies are completely ignored and data is publicly exposed.`,
    });
  }

  for (const table of rlsDisabledTables) {
    if (!policyExistsRlsDisabled.some((p) => p.table.name === table.name)) {
      affectedObjects.push({
        schema: table.schema,
        name: table.name,
        type: 'table',
        detail: `[Rule 0013] RLS is DISABLED on public table. All rows are completely exposed to public PostgREST API requests (anon/authenticated).`,
      });
    }
  }

  for (const table of rlsEnabledNoPolicy) {
    affectedObjects.push({
      schema: table.schema,
      name: table.name,
      type: 'table',
      detail: `[Rule 0008] RLS is ENABLED but has 0 policies. Non-superuser PostgREST queries silently return empty arrays [].`,
    });
  }

  const fixSqlStatements: string[] = [];

  for (const t of rlsDisabledTables) {
    fixSqlStatements.push(
      `-- Enable RLS on ${t.schema}.${t.name} to enforce access controls:\n` +
      `ALTER TABLE "${t.schema}"."${t.name}" ENABLE ROW LEVEL SECURITY;`
    );
  }

  for (const t of rlsEnabledNoPolicy) {
    fixSqlStatements.push(
      `-- Table ${t.schema}.${t.name} has RLS enabled with 0 policies. Add at least one policy for your intended roles, for example:\n` +
      `-- CREATE POLICY "Allow read for authenticated" ON "${t.schema}"."${t.name}"\n` +
      `--   FOR SELECT TO authenticated USING (true);`
    );
  }

  const severity = rlsDisabledTables.length > 0 ? 'critical' : 'medium';

  return {
    id: 'RLS_DISABLED_OR_LOCKED_OUT',
    category: 'rls',
    severity,
    title: 'Public Tables Missing RLS or Locked Out with Zero Policies',
    summary: `Found ${rlsDisabledTables.length} table(s) with RLS disabled in public schema (Rules 0013/0007), and ${rlsEnabledNoPolicy.length} table(s) with RLS enabled with 0 policies (Rule 0008).`,
    whyItClogsSupport:
      'Two opposing extremes drive frequent support escalations: (1) Developers create public tables without enabling RLS, inadvertently exposing private company data via the Supabase client SDK. (2) Developers write policies but leave RLS disabled (Rule 0007), or enable RLS without adding any policies (Rule 0008), leading to "Why is my query returning an empty list [] even though I can see rows in the Table Editor?". In Postgres, enabling RLS with no policies denies all non-superuser access.',
    affectedObjects,
    remediationExplanation:
      '1. Enable Row Level Security on all public tables: `ALTER TABLE "<schema>"."<table>" ENABLE ROW LEVEL SECURITY;`.\n' +
      '2. Ensure tables with RLS enabled have explicitly scoped policies for `anon` and `authenticated` roles.\n' +
      '3. Verify that tables with defined policies have RLS actively turned on.',
    fixSql: fixSqlStatements.join('\n\n'),
    documentationUrl: 'https://supabase.com/docs/guides/database/postgres/row-level-security#enable-row-level-security',
    metadata: {
      linterRules: ['0013_rls_disabled_in_public', '0007_policy_exists_rls_disabled', '0008_rls_enabled_no_policy'],
      disabledCount: rlsDisabledTables.length,
      policyExistsDisabledCount: policyExistsRlsDisabled.length,
      lockedOutCount: rlsEnabledNoPolicy.length,
    },
  };
}
