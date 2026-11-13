# Changelog

All notable changes to SB Sniffer will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-11-13

### Added
- **14 Diagnostic Checks** across 9 categories (`rls`, `connection_pooler`, `auth`, `storage`, `realtime`, `performance`, `hygiene`, `app_code`, `egress_cost`), including full Supabase Splinter parity (`SPLINTER_DB_SECURITY_HYGIENE`: Rules `0001`, `0002`, `0005`, `0007`, `0008`, `0010`, `0011`, `0013`, `0014`, `0015`, `0016`, `0017`).
- **Dual-Layer Schema Ingestion**: PostgreSQL AST parsing (`pgsql-ast-parser`) with Supabase DDL fallback for policies, triggers (`$tag$` dollar quotes, `SECURITY DEFINER`, `search_path`), publications, extensions, and `REPLICA IDENTITY`.
- **Full-Stack Application Scanner (`--app`)**: Scans `.env*`, TypeScript/JavaScript, Prisma, and Drizzle codebases for client-exposed `service_role` keys, Supavisor `:6543` prepared statement mismatches (`?pgbouncer=true`, `{ prepare: false }`), SSR `supabase.auth.getSession()` misuse, unbounded `.select('*')`, and unindexed PostgREST `.eq()` filters.
- **Live Telemetry & Active Execution**:
  - `sb-sniffer serve` / `web`: Loopback-bound local Web GUI + HTTP/SSE bridge with zero-credential Studio SQL generator and Management API log correlation (`postgres_logs`, `auth_logs`, `edge_logs`, `supavisor_logs`).
  - `sb-sniffer watch`: Real-time terminal monitor for active locks, idle-in-transaction sessions, and connection pool saturation.
  - `sb-sniffer fix`: Generates production-safe migrations (`CREATE INDEX CONCURRENTLY IF NOT EXISTS` stripped of explicit `BEGIN`/`COMMIT` wrappers).
  - `sb-sniffer pentest`: Transaction-rolled-back RLS Red Team probe as `anon` and `authenticated`.
  - `sb-sniffer prove`: Transaction-rolled-back `EXPLAIN (ANALYZE, BUFFERS)` query proof runner.
  - `sb-sniffer mcp`: Stdio Model Context Protocol server exposing `analyze_schema`, `scan_app_code`, and `generate_safe_migration`.
- **CI/CD & Automation**: Composite GitHub Action (`action.yml`), CI build/typecheck/test/audit workflow, tag-based release workflow, issue/PR templates, and regression test suite (30 core tests + 8 CLI/bridge/MCP tests).

### Security & Hardening
- Bound `serve`/`web` HTTP bridge to `127.0.0.1` by default, restricted CORS headers strictly to local origins, blocked path traversal (`403`), enforced 1 MB JSON payload limits, parameterized `pg_terminate_backend($1)` with positive-integer `pid` validation, replaced shell `exec` browser launch with `execFile`, and added request timeouts on Management API fetches.
- Added safe Postgres SSL defaults (loopback vs remote Supabase TLS) and proper handling of passwords containing `@` or reserved URI characters in `normalizeConnectionString`.
- Fixed stateful `/g` regex `lastIndex` bugs across consecutive RLS policies, balanced parenthesis parsing in `USING`/`WITH CHECK`, multi-table `ALTER PUBLICATION` parsing, Studio JSON view/matview/foreign-table retention, and RFC-style CSV quoting for `pg_stat_statements`.
