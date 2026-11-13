# Frequently Asked Questions (FAQ)

### How is SB Sniffer different from Supabase Splinter (`supabase db lint`)?
Supabase Splinter runs inside a live PostgreSQL instance as SQL queries against catalog views. SB Sniffer implements parity checks for key Splinter lint rules (`0001`, `0002`, `0005`, `0007`, `0008`, `0010`, `0011`, `0013`, `0014`, `0015`, `0016`, `0017`) **and** goes further by working offline on migration files, scanning `.env` / Next.js / Drizzle / Prisma application code, correlating app `.eq()` calls against DB indexes, running transaction-rolled-back RLS pentests, and generating `CONCURRENTLY`-safe fix migrations.

### Does SB Sniffer send my database credentials or schema to any external server?
No. Static `analyze`, `fix`, `tui`, `mcp`, and Studio JSON modes make zero network calls. In `serve` / `web` mode, the HTTP bridge binds to `127.0.0.1` by default, holds any live database URI in process memory only, and only calls `api.supabase.com` if you open the Live Logs view with `SUPABASE_ACCESS_TOKEN` explicitly set.

### What is Zero-Credential Studio Mode?
If your production database does not allow direct Postgres connections from your laptop—or you prefer not to share a DB password with any tool—run `sb-sniffer sql-query`, execute that single read-only SQL statement inside the Supabase Studio SQL Editor, copy the JSON output, and pass it to `--studio-json` or upload it in the Web UI.

### Is `sb-sniffer pentest` safe to run against a live database?
`sb-sniffer pentest` runs every `SET LOCAL ROLE anon` / `authenticated` probe inside a `BEGIN ... ROLLBACK` transaction (with `SAVEPOINT` protection per check) so zero writes or role changes are persisted. Still, running security probes against staging or a branch database first is always recommended.

### Is `sb-sniffer prove` safe for production?
Because `EXPLAIN (ANALYZE, BUFFERS)` actually executes query plans to measure buffer hits and execution duration (even inside a rolled-back transaction), heavy queries can consume CPU and I/O on a live primary. Use a staging project, read replica, or Supabase Database Branch when benchmarking expensive queries.

### Why did Check 1 (`RLS_UNWRAPPED_AUTH_FUNC`) flag my working RLS policy?
Calling `auth.uid() = user_id` works functionally, so apps look fine with 100 test rows. Under production load, PostgreSQL often cannot cache bare `auth.uid()` across rows, causing per-row PL/pgSQL function evaluation. Rewriting it to `(select auth.uid()) = user_id` triggers an `initPlan` evaluation once per statement, allowing index scans to work properly.

### Can AI coding assistants (Cursor, Claude Code, Antigravity, Windsurf) use SB Sniffer?
Yes. Start `sb-sniffer mcp` as a stdio MCP server to give your AI assistant direct tools for `analyze_schema`, `scan_app_code`, and `generate_safe_migration`, or export findings via `--format ai` (`formatReportForAI`) to paste clean diagnostic context directly into prompts.
