import { AffectedObject, DiagnosticFinding, DiagnosticSnapshot } from '../types.js';

export function checkAuthUsersTriggers(snapshot: DiagnosticSnapshot): DiagnosticFinding | null {
  const authTriggers = snapshot.triggers.filter(
    (t) => t.schema.toLowerCase() === 'auth' && t.table.toLowerCase() === 'users'
  );

  const problematicTriggers: {
    name: string;
    issue: string;
    detail: string;
    def?: string;
  }[] = [];

  for (const trigger of authTriggers) {
    const fnDef = (trigger.functionDef || '').toLowerCase();

    // Check 1: Synchronous external HTTP calls inside trigger (net.http_post, http_post, curl)
    const hasSyncHttp =
      fnDef.includes('net.http_post') ||
      fnDef.includes('http_post') ||
      fnDef.includes('http_get') ||
      fnDef.includes('extensions.http');

    if (hasSyncHttp) {
      problematicTriggers.push({
        name: trigger.name,
        issue: 'Synchronous HTTP Call in Auth Trigger',
        detail: `Function "${trigger.functionSchema}.${trigger.functionName}" performs synchronous HTTP network requests during auth.users insert. High latency or network timeouts on external endpoints directly fail user signups with HTTP 500.`,
        def: trigger.functionDef,
      });
    }

    // Check 2: Missing EXCEPTION handler in handle_new_user() pattern
    const isInsertTrigger = trigger.event.toUpperCase().includes('INSERT');
    const hasExceptionHandler = fnDef.includes('exception') && fnDef.includes('when');
    if (isInsertTrigger && !hasExceptionHandler && fnDef.length > 50) {
      problematicTriggers.push({
        name: trigger.name,
        issue: 'Missing EXCEPTION Handler in Auth Trigger',
        detail: `Trigger "${trigger.name}" runs inside GoTrue's atomic signup transaction without an EXCEPTION block. If public.profiles has missing columns or unique constraints violate, the entire user signup rolls back.`,
        def: trigger.functionDef,
      });
    }

    // Check 3: Missing SECURITY DEFINER or mutable search_path (Supabase Rule 0011_function_search_path_mutable)
    const isSecurityDefiner = trigger.isSecurityDefiner === true || fnDef.includes('security definer');
    const hasSearchPath =
      (trigger.proConfig && trigger.proConfig.some((c) => c.toLowerCase().includes('search_path'))) ||
      fnDef.includes('search_path');

    if (isSecurityDefiner && !hasSearchPath) {
      problematicTriggers.push({
        name: trigger.name,
        issue: 'SECURITY DEFINER with Mutable search_path (Rule 0011)',
        detail: `Function "${trigger.functionName}" is SECURITY DEFINER but does not specify SET search_path = ''. Malicious users could hijack schema search paths to execute unauthorized code with elevated privileges.`,
        def: trigger.functionDef,
      });
    }
  }

  if (problematicTriggers.length === 0) {
    return null;
  }

  const affectedObjects: AffectedObject[] = problematicTriggers.map((t) => ({
    schema: 'auth',
    name: `users.${t.name}`,
    type: 'trigger' as const,
    detail: `${t.issue}: ${t.detail}`,
  }));

  const fixSqlStatements: string[] = [];

  for (const t of problematicTriggers) {
    fixSqlStatements.push(
      `-- Recommendation for auth trigger "${t.name}":\n` +
      `-- 1. Ensure function has "SECURITY DEFINER SET search_path = ''"\n` +
      `-- 2. Wrap insert operations in "BEGIN ... EXCEPTION WHEN OTHERS THEN RAISE WARNING ... END;"\n` +
      `-- 3. Offload external webhooks to pg_net asynchronous queues (net.http_post with async worker) rather than blocking GoTrue signup transactions.`
    );
  }

  return {
    id: 'AUTH_USERS_BLOCKING_TRIGGERS',
    category: 'auth',
    severity: 'critical',
    title: 'Fragile Triggers on auth.users Breaking GoTrue User Signups',
    summary: `${problematicTriggers.length} trigger(s) on auth.users have issues that can break user registrations with "Database error saving new user".`,
    whyItClogsSupport:
      'This is one of the top ticket drivers on Supabase: "Why do my user signups fail with 500 Database error saving new user?". In Supabase, GoTrue wraps auth.users INSERT and all its triggers in a single atomic database transaction. If a custom trigger tries to write to public.profiles and hits a constraint mismatch, or executes an external HTTP call that times out, the entire transaction aborts and the signup fails.',
    affectedObjects,
    remediationExplanation:
      'Ensure trigger functions on `auth.users`:\n' +
      '1. Include an `EXCEPTION` handler to gracefully log failures rather than aborting signup.\n' +
      '2. Are declared with `SECURITY DEFINER SET search_path = \'\'`.\n' +
      '3. Never perform synchronous HTTP calls — use asynchronous workers or Supabase Edge Functions with Database Webhooks.',
    fixSql: fixSqlStatements.join('\n\n'),
    documentationUrl: 'https://supabase.com/docs/guides/auth/managing-user-data#using-triggers',
    metadata: {
      linterRule: '0011_function_search_path_mutable',
      triggerCount: problematicTriggers.length,
    },
  };
}
