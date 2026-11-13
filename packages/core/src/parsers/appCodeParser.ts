import { AppCodeFindingItem, AppCodeSnapshot } from '../types.js';

export interface AppSourceFile {
  path: string;
  content: string;
}

const PUBLIC_ENV_PREFIXES = ['NEXT_PUBLIC_', 'VITE_', 'EXPO_PUBLIC_', 'REACT_APP_', 'NUXT_PUBLIC_'];

/**
 * Pure, browser-safe static scanner for Supabase application code, ORMs, and .env files.
 * Detects client-side service_role leaks, Supavisor 6543 ORM misconfigs,
 * insecure server getSession() usage, unbounded .select('*'), and filter columns for DB correlation.
 */
export function scanAppCodeFiles(files: AppSourceFile[]): AppCodeSnapshot {
  const items: AppCodeFindingItem[] = [];

  for (const file of files) {
    const normalizedPath = file.path.replace(/\\/g, '/');
    const lines = file.content.split(/\r?\n/);
    const isEnvFile = /(^|\/)\.env(\.|$)/i.test(normalizedPath);
    const isCodeFile = /\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(normalizedPath);
    const hasUseServerDirective = /^\s*['"]use server['"]\s*;?/m.test(file.content);
    const isServerLike =
      hasUseServerDirective ||
      /(middleware|route|server|api|action|trpc|webhook|cron)\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/i.test(normalizedPath) ||
      /\/app\/api\//i.test(normalizedPath) ||
      /\/pages\/api\//i.test(normalizedPath);

    if (isEnvFile) {
      lines.forEach((line, idx) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;

        // 1. service_role key exposed in public client env var
        for (const prefix of PUBLIC_ENV_PREFIXES) {
          if (trimmed.startsWith(prefix) && /SERVICE_ROLE/i.test(trimmed)) {
            items.push({
              file: normalizedPath,
              line: idx + 1,
              snippet: trimmed.split('=')[0] + '=***',
              kind: 'service_role_leak',
              detail: `Public client env variable "${trimmed.split('=')[0]}" exposes Supabase service_role key to browser bundles, completely bypassing all RLS policies.`,
            });
          }
        }

        // 2. DATABASE_URL using port 6543 (Supavisor transaction mode) without pgbouncer=true
        if (/^(DATABASE_URL|DIRECT_URL|POSTGRES_URL)\s*=/.test(trimmed) && /:6543\b/.test(trimmed)) {
          if (!/pgbouncer=true/i.test(trimmed)) {
            items.push({
              file: normalizedPath,
              line: idx + 1,
              snippet: trimmed.split('=')[0] + '="postgresql://...:6543/..."',
              kind: 'pooler_6543_missing_pgbouncer',
              detail: `Connection string uses Supavisor transaction mode (:6543) without "?pgbouncer=true". Prisma and pooled ORMs will crash with "prepared statement already exists".`,
            });
          }
        }
      });
    }

    if (isCodeFile) {
      // Check whole-file Drizzle/postgres-js without prepare: false when 6543 or pooler referenced
      if (/postgres\s*\(/.test(file.content) && /drizzle/i.test(file.content)) {
        if (!/prepare\s*:\s*false/.test(file.content)) {
          const lineIdx = lines.findIndex((l) => /postgres\s*\(/.test(l));
          items.push({
            file: normalizedPath,
            line: lineIdx >= 0 ? lineIdx + 1 : 1,
            snippet: lineIdx >= 0 ? lines[lineIdx].trim() : 'postgres(...)',
            kind: 'drizzle_missing_prepare_false',
            detail: `Drizzle + postgres.js client initialized without "{ prepare: false }". This causes prepared statement collisions on Supabase Supavisor port 6543.`,
          });
        }
      }

      lines.forEach((line, idx) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;

        // 3. Hardcoded service_role JWT or key in client-side code
        if (!isServerLike && /SUPABASE_SERVICE_ROLE_KEY/.test(trimmed) && /NEXT_PUBLIC_|VITE_|EXPO_PUBLIC_|REACT_APP_/.test(trimmed)) {
          items.push({
            file: normalizedPath,
            line: idx + 1,
            snippet: trimmed.slice(0, 120),
            kind: 'service_role_leak',
            detail: `Reference to public-prefixed service_role variable in client-side code.`,
          });
        }

        // 4. Insecure supabase.auth.getSession() in server/middleware context
        if (isServerLike && /\.auth\.getSession\s*\(/.test(trimmed)) {
          items.push({
            file: normalizedPath,
            line: idx + 1,
            snippet: trimmed.slice(0, 120),
            kind: 'insecure_get_session',
            detail: `Server/middleware code calls supabase.auth.getSession(). In SSR/server contexts, getSession() reads unverified cookie data without validating the JWT with Supabase Auth; use supabase.auth.getUser() instead.`,
          });
        }

        // 5. Unbounded .from('table').select('*') (single or multi-line) without .limit() / .range() / .single()
        const fromMatch = trimmed.match(/\.from\(\s*['"`]([a-zA-Z0-9_]+)['"`]\s*\)/);
        if (fromMatch) {
          const table = fromMatch[1];
          const windowText = lines.slice(idx, idx + 5).join(' ');
          if (/\.select\(\s*['"`]\*['"`]\s*\)/.test(windowText)) {
            const hasBound = /\.(limit|range|single|maybeSingle)\s*\(/.test(windowText);
            if (!hasBound) {
              items.push({
                file: normalizedPath,
                line: idx + 1,
                snippet: trimmed.slice(0, 120),
                kind: 'unbounded_select_star',
                table,
                detail: `Unbounded .from('${table}').select('*') without .limit(), .range(), or .single() — fetches all columns and potentially thousands of rows, inflating Supabase Egress.`,
              });
            }
          }

          // 6. Capture .from('table') ... .eq('col', ...) for App <-> DB index correlation
          const filterRegex = /\.(eq|in|neq|gt|lt|gte|lte)\(\s*['"`]([a-zA-Z0-9_]+)['"`]/g;
          let m: RegExpExecArray | null;
          while ((m = filterRegex.exec(windowText)) !== null) {
            const col = m[2];
            if (col !== 'id') {
              items.push({
                file: normalizedPath,
                line: idx + 1,
                snippet: trimmed.slice(0, 120),
                kind: 'app_filter_call',
                table,
                column: col,
                detail: `App code filters "${table}.${col}" via .${m[1]}('${col}', ...).`,
              });
            }
          }
        }
      });
    }
  }

  return {
    scannedFiles: files.length,
    items,
  };
}
