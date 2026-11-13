import { AffectedObject, DiagnosticFinding, DiagnosticSnapshot, PolicyInfo } from '../types.js';

// Regex patterns to detect unwrapped auth helper functions.
// We want to detect calls like:
//   auth.uid()
//   auth.jwt()
//   auth.role()
//   auth.email()
//   current_setting('request.jwt.claims'...)
// but NOT when properly wrapped as (select auth.uid()) or (SELECT auth.uid())
const UNWRAPPED_HELPERS = [
  { name: 'auth.uid()', regex: /(?<!\(\s*select\s+)auth\.uid\s*\(\s*\)/i },
  { name: 'auth.jwt()', regex: /(?<!\(\s*select\s+)auth\.jwt\s*\(\s*\)/i },
  { name: 'auth.role()', regex: /(?<!\(\s*select\s+)auth\.role\s*\(\s*\)/i },
  { name: 'auth.email()', regex: /(?<!\(\s*select\s+)auth\.email\s*\(\s*\)/i },
  {
    name: 'current_setting(jwt)',
    regex: /(?<!\(\s*select\s+)current_setting\s*\(\s*['"]request\.jwt\.claims['"]/i,
  },
];

export function checkRlsUnwrappedAuthFunc(snapshot: DiagnosticSnapshot): DiagnosticFinding | null {
  const unwrappedPolicies: { policy: PolicyInfo; unwrapped: string[]; expression: string }[] = [];

  for (const policy of snapshot.policies) {
    const fullExpr = `${policy.qual || ''} ${policy.withCheck || ''}`;
    const found: string[] = [];

    for (const helper of UNWRAPPED_HELPERS) {
      // Test regex against expression
      if (helper.regex.test(fullExpr)) {
        found.push(helper.name);
      }
    }

    if (found.length > 0) {
      unwrappedPolicies.push({
        policy,
        unwrapped: Array.from(new Set(found)),
        expression: fullExpr.trim(),
      });
    }
  }

  // Also check for multiple permissive policies on the same table and command
  // E.g. 3 SELECT policies for authenticated role -> Postgres must evaluate all with OR per row
  const permissiveGroups = new Map<string, PolicyInfo[]>();
  for (const policy of snapshot.policies) {
    if (policy.permissive === 'PERMISSIVE') {
      const key = `${policy.schema}.${policy.table}:${policy.command}`;
      const existing = permissiveGroups.get(key) || [];
      existing.push(policy);
      permissiveGroups.set(key, existing);
    }
  }

  const multiPermissiveTables = Array.from(permissiveGroups.entries()).filter(
    ([_, list]) => list.length >= 3
  );

  if (unwrappedPolicies.length === 0 && multiPermissiveTables.length === 0) {
    return null;
  }

  const affectedObjects: AffectedObject[] = unwrappedPolicies.map(({ policy, unwrapped }) => ({
    schema: policy.schema,
    name: `${policy.table}.${policy.name}`,
    type: 'policy' as const,
    detail: `Calls unwrapped ${unwrapped.join(', ')} — forces per-row function evaluation instead of initPlan caching.`,
  }));

  for (const [tableCmd, list] of multiPermissiveTables) {
    const [tbl, cmd] = tableCmd.split(':');
    affectedObjects.push({
      schema: list[0].schema,
      name: tbl,
      type: 'table' as const,
      detail: `${list.length} permissive ${cmd} policies found (${list.map((p) => p.name).join(', ')}). Multiple policies combine with OR and multiply execution overhead.`,
    });
  }

  const fixSqlStatements = unwrappedPolicies.map(({ policy }) => {
    let fixedQual = policy.qual;
    let fixedCheck = policy.withCheck;

    const wrap = (str: string | null | undefined) => {
      if (!str) return str;
      return str
        .replace(/(?<!\(\s*select\s+)auth\.uid\s*\(\s*\)/gi, '(select auth.uid())')
        .replace(/(?<!\(\s*select\s+)auth\.jwt\s*\(\s*\)/gi, '(select auth.jwt())')
        .replace(/(?<!\(\s*select\s+)auth\.role\s*\(\s*\)/gi, '(select auth.role())')
        .replace(/(?<!\(\s*select\s+)auth\.email\s*\(\s*\)/gi, '(select auth.email())')
        .replace(
          /(?<!\(\s*select\s+)current_setting\s*\(\s*(['"]request\.jwt\.claims['"][^)]*)\)/gi,
          '(select current_setting($1))'
        );
    };

    fixedQual = wrap(fixedQual);
    fixedCheck = wrap(fixedCheck);

    const clauses: string[] = [];
    if (fixedQual) clauses.push(`USING (${fixedQual})`);
    if (fixedCheck) clauses.push(`WITH CHECK (${fixedCheck})`);

    return (
      `-- Fix policy "${policy.name}" on ${policy.schema}.${policy.table} to use initPlan caching:\n` +
      `ALTER POLICY "${policy.name}" ON "${policy.schema}"."${policy.table}"\n` +
      `  ${clauses.join(' ')};`
    );
  });

  return {
    id: 'RLS_UNWRAPPED_AUTH_FUNC',
    category: 'rls',
    severity: 'critical',
    title: 'Unwrapped auth.uid() or Helper Functions in RLS Policies',
    summary: `${unwrappedPolicies.length} policy/policies call auth helpers directly without a (select ...) wrapper, bypassing PostgreSQL initPlan caching.`,
    whyItClogsSupport:
      'Supabase users frequently open high-severity tickets asking why queries on tables with 10k+ rows suddenly time out (504 Gateway Timeout) or spike CPU to 100%. When auth.uid() is called directly, Postgres must execute the PL/pgSQL function on EVERY single candidate row in a sequential scan instead of running it once and using an index lookup.',
    affectedObjects,
    remediationExplanation:
      'Wrap all auth helpers like `auth.uid()` or `auth.jwt()` inside a sub-select: `(select auth.uid())`. This instructs the Postgres query optimizer to treat the value as an `initPlan`, evaluating it exactly once at query start and reusing the result for B-tree index seeks. Additionally, consolidate redundant permissive policies to avoid evaluating multiple OR expressions per row.',
    fixSql: fixSqlStatements.join('\n\n'),
    documentationUrl: 'https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select',
    metadata: {
      unwrappedCount: unwrappedPolicies.length,
      multiPermissiveCount: multiPermissiveTables.length,
    },
  };
}
