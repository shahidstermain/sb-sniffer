import { AffectedObject, DiagnosticFinding, DiagnosticSnapshot } from '../types.js';

/**
 * Check 14: Supabase Splinter Security & API Exposure Parity
 * Covers Splinter rules:
 * - 0010_security_definer_view
 * - 0002_auth_users_exposed
 * - 0015_rls_references_user_metadata
 * - 0016_materialized_view_in_api
 * - 0017_foreign_table_in_api
 */
export function checkSplinterParity(snapshot: DiagnosticSnapshot): DiagnosticFinding | null {
  const affectedObjects: AffectedObject[] = [];
  const fixStatements: string[] = [];
  let hasCritical = false;

  // 1. security_definer_view & auth_users_exposed on Views
  for (const v of snapshot.views || []) {
    if (v.schema !== 'public') continue;

    if (!v.securityInvoker) {
      affectedObjects.push({
        schema: v.schema,
        name: `${v.schema}.${v.name}`,
        type: 'view',
        detail: `View runs with SECURITY DEFINER semantics (missing security_invoker = true), bypassing caller RLS policies.`,
      });
      fixStatements.push(`ALTER VIEW "${v.schema}"."${v.name}" SET (security_invoker = true);`);
    }

    if (v.definition && /\bauth\.users\b/i.test(v.definition)) {
      hasCritical = true;
      affectedObjects.push({
        schema: v.schema,
        name: `${v.schema}.${v.name}`,
        type: 'view',
        detail: `Exposes auth.users data in public schema view (0002_auth_users_exposed).`,
      });
      fixStatements.push(`REVOKE ALL ON "${v.schema}"."${v.name}" FROM anon, authenticated;`);
    }
  }

  // 2. materialized_view_in_api & auth_users_exposed on Materialized Views
  for (const mv of snapshot.materializedViews || []) {
    if (mv.schema !== 'public') continue;
    const exposesAuthUsers = mv.definition && /\bauth\.users\b/i.test(mv.definition);
    if (exposesAuthUsers) hasCritical = true;

    affectedObjects.push({
      schema: mv.schema,
      name: `${mv.schema}.${mv.name}`,
      type: 'matview',
      detail: exposesAuthUsers
        ? `Materialized view in public schema exposes auth.users and bypasses RLS (0002/0016).`
        : `Materialized view in public schema is exposed via PostgREST API without RLS support (0016_materialized_view_in_api).`,
    });
    fixStatements.push(`REVOKE ALL ON "${mv.schema}"."${mv.name}" FROM anon, authenticated;`);
  }

  // 3. foreign_table_in_api
  for (const ft of snapshot.foreignTables || []) {
    if (ft.schema !== 'public') continue;
    affectedObjects.push({
      schema: ft.schema,
      name: `${ft.schema}.${ft.name}`,
      type: 'foreign_table',
      detail: `Foreign table in public schema is exposed via PostgREST API and does not enforce RLS (0017_foreign_table_in_api).`,
    });
    fixStatements.push(`REVOKE ALL ON FOREIGN TABLE "${ft.schema}"."${ft.name}" FROM anon, authenticated;`);
  }

  // 4. rls_references_user_metadata
  for (const p of snapshot.policies || []) {
    const expr = `${p.qual || ''} ${p.withCheck || ''}`;
    if (/\b(raw_user_meta_data|user_metadata)\b/i.test(expr)) {
      hasCritical = true;
      affectedObjects.push({
        schema: p.schema,
        name: `${p.table}.${p.name}`,
        type: 'policy',
        detail: `RLS policy references user-editable user_metadata / raw_user_meta_data (0015_rls_references_user_metadata). Users can modify this via supabase.auth.updateUser().`,
      });
    }
  }

  if (affectedObjects.length === 0) return null;

  return {
    id: 'SPLINTER_SECURITY_AND_API_EXPOSURE',
    category: 'rls',
    severity: hasCritical ? 'critical' : 'high',
    title: 'PostgREST API Exposure & Security Definer Views (Splinter Parity)',
    summary: `Detected ${affectedObjects.length} view, materialized view, foreign table, or user_metadata RLS issue(s) matching Supabase Splinter security advisors.`,
    whyItClogsSupport:
      'Views without `security_invoker = true`, materialized views, and foreign tables in `public` silently bypass Row Level Security when queried through PostgREST. Referencing `user_metadata` in RLS policies allows any authenticated user to escalate privileges by calling `auth.updateUser({ data: ... })`.',
    affectedObjects,
    remediationExplanation:
      '1. Set `security_invoker = true` on all public views.\n' +
      '2. Revoke `anon` and `authenticated` privileges on materialized views, foreign tables, and views referencing `auth.users`.\n' +
      '3. Store authorization roles in `app_metadata` (or a dedicated `user_roles` table), never `user_metadata`.',
    fixSql: fixStatements.length > 0 ? Array.from(new Set(fixStatements)).join('\n') : undefined,
    documentationUrl: 'https://supabase.com/docs/guides/database/database-linter',
    metadata: {
      linterRules: [
        '0002_auth_users_exposed',
        '0010_security_definer_view',
        '0015_rls_references_user_metadata',
        '0016_materialized_view_in_api',
        '0017_foreign_table_in_api',
      ],
    },
  };
}
