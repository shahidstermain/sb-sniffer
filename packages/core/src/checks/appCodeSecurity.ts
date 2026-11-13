import { AffectedObject, DiagnosticFinding, DiagnosticSnapshot } from '../types.js';

/**
 * Check 11: Application Env, ORM Pooler & Auth Misconfigurations
 * Scans .env, Prisma, Drizzle, and SSR/API routes for critical Supabase client/driver pitfalls.
 */
export function checkAppCodeSecurity(snapshot: DiagnosticSnapshot): DiagnosticFinding | null {
  const appCode = snapshot.appCode;
  if (!appCode || appCode.items.length === 0) return null;

  const securityItems = appCode.items.filter(
    (item) =>
      item.kind === 'service_role_leak' ||
      item.kind === 'pooler_6543_missing_pgbouncer' ||
      item.kind === 'drizzle_missing_prepare_false' ||
      item.kind === 'insecure_get_session'
  );

  if (securityItems.length === 0) return null;

  const hasCritical = securityItems.some(
    (i) =>
      i.kind === 'service_role_leak' ||
      i.kind === 'pooler_6543_missing_pgbouncer' ||
      i.kind === 'drizzle_missing_prepare_false'
  );

  const affectedObjects: AffectedObject[] = securityItems.map((item) => ({
    name: `${item.file}:${item.line}`,
    type: item.kind === 'service_role_leak' || item.kind === 'pooler_6543_missing_pgbouncer' ? 'env' : 'code',
    detail: item.detail,
  }));

  return {
    id: 'APP_ENV_AND_DRIVER_MISCONFIG',
    category: 'app_code',
    severity: hasCritical ? 'critical' : 'high',
    title: 'Full-Stack App Code, Env & ORM Driver Misconfigurations',
    summary: `Found ${securityItems.length} application-level Supabase configuration issue(s) across ${appCode.scannedFiles} scanned file(s).`,
    whyItClogsSupport:
      'Database-only linters miss half the story. Exposing service_role in NEXT_PUBLIC_/VITE_ env vars bypasses RLS entirely, omitting ?pgbouncer=true or prepare:false on port 6543 crashes production apps with prepared statement errors, and calling auth.getSession() on the server trusts unverified client cookies.',
    affectedObjects,
    remediationExplanation:
      '1. Never prefix SUPABASE_SERVICE_ROLE_KEY with NEXT_PUBLIC_, VITE_, or EXPO_PUBLIC_.\n' +
      '2. For Supavisor Transaction Mode (port 6543), append `?pgbouncer=true` to Prisma DATABASE_URL or pass `{ prepare: false }` to postgres.js / Drizzle.\n' +
      '3. Replace `supabase.auth.getSession()` with `supabase.auth.getUser()` in server routes, Server Components, and middleware.',
    documentationUrl: 'https://supabase.com/docs/guides/auth/server-side/creating-a-client',
    metadata: {
      scannedFiles: appCode.scannedFiles,
      issueCount: securityItems.length,
    },
  };
}
