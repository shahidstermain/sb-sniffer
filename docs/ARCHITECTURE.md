# SB Sniffer Architecture

This document details the internal architecture, parsing strategies, diagnostic pipeline, and security boundaries across the three workspaces in SB Sniffer.

## 1. Workspace Topology

| Workspace | Package Name | Responsibility | Key Exports / Entrypoints |
|---|---|---|---|
| `packages/core` | `@sb-sniffer/core` | Pure TypeScript analysis engine (no DB drivers or FS assumptions) | `analyzeSnapshot`, `parseSchemaDump`, `parseStudioJson`, `parseStatStatements`, `parseAppCodeFiles`, `STUDIO_INTROSPECTION_SQL`, `formatSafeMigrationSql`, `formatReportForAI` |
| `packages/cli` | `sb-sniffer` | Node.js runtime adapters, CLI commands, Postgres driver, HTTP bridge, MCP server | `index.ts`, `pgCollector.ts`, `liveServer.ts`, `rlsPentester.ts`, `explainProver.ts`, `mcpServer.ts`, `appScanner.ts`, `linuxTui.ts` |
| `packages/web` | `@sb-sniffer/web` | Client-side React 19 dashboard served statically by `liveServer` or Vite | `App.tsx`, `HealthScoreCard`, `FindingCard`, `PostgresDiagnosticsView`, `LiveConnectionModal`, `DumpUploader`, `LogChecker`, `StudioSqlModal` |

Keeping `@sb-sniffer/core` free of Node-specific I/O (`pg`, `fs`, `http`) allows the exact same check and formatter code to run in:
1. The CLI & GitHub Action (`sb-sniffer analyze` / `fix`)
2. Browser uploads in the React UI (`@sb-sniffer/web`)
3. AI agent tool calls via stdio MCP (`sb-sniffer mcp`)

---

## 2. Dual-Layer Schema & Introspection Pipeline

### Static SQL Parsing (`schemaDumpParser.ts` + `astSchemaParser.ts`)

PostgreSQL dumps and Supabase migrations contain both standard ANSI/PG DDL and Supabase-specific conventions (`ALTER PUBLICATION supabase_realtime ADD TABLE ...`, `CREATE POLICY ... USING (...)`, `$body$` custom dollar-quoted PL/pgSQL functions, `CREATE EXTENSION ... WITH SCHEMA ...`).

SB Sniffer parses SQL in two cooperative passes:
1. **Regex / Balanced-Scanner Pass**:
   - Strips comments and splits statements cleanly.
   - Extracts `CREATE POLICY` clauses using a balanced-parenthesis extractor (`extractParenClause`) so nested `EXISTS (SELECT ...)` and `(select auth.uid())` expressions are captured accurately without regex truncation.
   - Tracks `ENABLE` / `DISABLE ROW LEVEL SECURITY`, `DROP POLICY`, `DROP TABLE`, `DROP INDEX`, multi-table `ALTER PUBLICATION supabase_realtime ADD TABLE a, b`, out-of-order `REPLICA IDENTITY FULL`, and `$tag$` dollar-quoted `CREATE TRIGGER` / `CREATE FUNCTION` attributes (`SECURITY DEFINER`, `SET search_path`).
2. **AST Augmentation (`pgsql-ast-parser`)**:
   - Parses standard `CREATE TABLE`, inline `REFERENCES`, `CREATE INDEX`, `CREATE VIEW` (`security_invoker`), `CREATE MATERIALIZED VIEW`, `ALTER TABLE ... ADD CONSTRAINT` definitions so complex multi-line column definitions merge into the unified `DiagnosticSnapshot`.

### Live Introspection (`introspectionSql.ts` & `pgCollector.ts`)

When connected to a live Postgres database (or run via Studio JSON export), SB Sniffer queries PostgreSQL system catalogs directly:
- Uses **`pg_constraint`** instead of `information_schema.table_constraints` / `key_column_usage` because PostgreSQL hides foreign key definitions in `information_schema` when the connecting role does not own the referenced table.
- Uses `pg_class`, `pg_namespace`, `pg_policy`, `pg_index`, `pg_stat_user_tables`, `pg_stat_user_indexes`, `pg_stat_activity`, and `pg_stat_statements` (gracefully handling environments where `pg_stat_statements` is disabled or unprivileged).
- Collects `pg_prepared_statements` and port telemetry to identify Supavisor `:6543` transaction pooler incompatibility.

---

## 3. Application Code Correlation (`appCodeParser.ts` & `appScanner.ts`)

`appScanner.ts` walks source directories recursively (skipping `node_modules`, `.git`, `dist`, `.next`, `build`, `coverage`, binary assets) and passes `.env*`, `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.mts`, and ORM files into `parseAppCodeFiles`:

1. **Secret & Env Misconfiguration**: Detects `NEXT_PUBLIC_*`, `VITE_*`, `EXPO_PUBLIC_*`, `PUBLIC_*` variables carrying `service_role` tokens/keys, and Prisma/Postgres `:6543` URIs omitting `?pgbouncer=true`.
2. **ORM Driver Safety**: Flags Drizzle `postgres(...)` clients without `{ prepare: false }` when paired with transaction pooling, and server-side Supabase SSR calls using `supabase.auth.getSession()` instead of verified `supabase.auth.getUser()`.
3. **App <-> DB Cross-Layer Join**: Extracts `.from('table')...eq('col', ...)` and multi-line `.select('*')` calls, then cross-references `snapshot.indexes` in `appDbCorrelation.ts` (ignoring invalid indexes `isValid === false` and normalizing quoted identifier prefixes) to flag full-stack queries guaranteed to trigger sequential scans.

---

## 4. Transaction-Rolled-Back Active Probes

### RLS Red Team (`rlsPentester.ts`)
- Discovers `public` tables via `pg_class` / `pg_namespace`.
- For each table, opens a transaction (`BEGIN`), executes `SET LOCAL ROLE anon` (and `SET LOCAL ROLE authenticated`), runs scoped `SELECT count(*)` / optional write probes inside `SAVEPOINT` blocks, records exact row visibility or permission failures, and unconditionally executes `ROLLBACK`.

### EXPLAIN Prover (`explainProver.ts`)
- Identifies slow query patterns from `pg_stat_statements` or unindexed filter patterns.
- Wraps `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` before/after candidate fixes (`SET LOCAL enable_seqscan`, or transactional `CREATE INDEX` / `initPlan` rewrites) inside `BEGIN ... ROLLBACK` to report measurable buffer/execution-time deltas without persisting schema changes.

---

## 5. Loopback Bridge & Security Boundaries (`liveServer.ts`)

```text
Browser (127.0.0.1:3001 or Vite :3000)
   │  CORS restricted to localhost / 127.0.0.1 / [::1]
   ▼
HTTP + SSE Bridge (bound to 127.0.0.1 by default)
   ├── Static Web UI (/assets/*, SPA fallback, raw & encoded '..' traversal -> 403)
   ├── /api/connect, /api/snapshot, /api/stream (DB URI held in Node memory only)
   ├── /api/terminate-session (validates positive integer pid, calls pg_terminate_backend($1))
   └── /api/logs (reads SUPABASE_ACCESS_TOKEN server-side -> Supabase Management API, 8s timeout)
```

Key design choices:
- **Zero Credential Persistence**: Connection URIs are never written to disk, logs, or returned to browser storage beyond the active session status flag (`hasActiveConnection: boolean`).
- **Password Encoding (`pgCollector.ts`)**: Splits URIs on `lastIndexOf('@')` to safely percent-encode database passwords containing `@`, `#`, `$`, or `!` without breaking host parsing.
- **Smart TLS Defaults (`createPgClientConfig`)**: Automatically disables forced SSL on loopback addresses (`127.0.0.1`, `localhost`, `::1`, or explicit `sslmode=disable`), verifies certs on `verify-full`/`verify-ca`, and uses TLS with `rejectUnauthorized: false` for standard Supabase pooler endpoints.
