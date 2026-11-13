# Troubleshooting Guide

## Installation & Build Issues

### `No .sql files found in <directory>`
- **Cause:** `analyze --schema <dir>` or `fix --schema <dir>` points to an empty directory (e.g., an uninitialized `supabase/migrations/`).
- **Fix:** Point `--schema` to an existing `.sql` dump (`sample/schema_dump_broken.sql`), run `supabase db dump -f schema.sql`, or omit `--schema` and pass `--app .` to run application-only checks.

### Node.js Version Errors
- **Cause:** SB Sniffer uses ES2022 targets, native `node --test`, and `fetch` with `AbortSignal.timeout`.
- **Fix:** Upgrade to Node.js 18 LTS or newer (CI tests Node 20 and Node 22).

---

## Postgres & Supavisor Connection Issues

### Connection Fails with Special Characters in Password (`@`, `#`, `$`, `!`)
- **Behavior:** Older URL parsers treat the first `@` inside a password as the host delimiter, producing `ENOTFOUND` errors.
- **Fix:** SB Sniffer uses `lastIndexOf('@')` in `normalizeConnectionString` to encode raw passwords automatically. Still, always quote URIs in your shell (`"postgresql://..."`) so zsh/bash does not expand `$` or `!`.

### SSL / TLS Errors on Local Supabase (`127.0.0.1:54322`)
- **Behavior:** Forcing SSL against local `supabase start` Postgres instances fails with `The server does not support SSL connections`.
- **Fix:** SB Sniffer automatically disables TLS for `localhost`, `127.0.0.1`, and `::1` unless you override `sslmode`.

### `prepared statement "..." already exists` on Port `6543`
- **Cause:** Supavisor Transaction Mode (`:6543`) multiplexes backend connections across clients, so named prepared statements are invalid across transactions.
- **Fixes:**
  1. For Drizzle / `postgres.js`: pass `{ prepare: false }` when connecting on `:6543`.
  2. For Prisma: append `?pgbouncer=true` to `DATABASE_URL` and configure `DIRECT_URL` on `:5432` for migrations.
  3. For live diagnostics requiring session-level state or migrations, prefer Direct (`:5432`) or Session Mode URI.

---

## Migration & `fix` Issues

### `CREATE INDEX CONCURRENTLY cannot run inside a transaction block`
- **Cause:** PostgreSQL forbids `CONCURRENTLY` inside `BEGIN ... COMMIT` blocks, including some deployment wrappers.
- **Fix:** `sb-sniffer fix` and `formatSafeMigrationSql` strip explicit `BEGIN;` and `COMMIT;` wrappers around `CONCURRENTLY` statements automatically. If your migration runner wraps every file in an implicit transaction (for example, certain custom runners), run the generated `CREATE INDEX CONCURRENTLY` file directly via `psql` or Supabase SQL Editor (where single statements run autocommit) or split DDL index steps outside transactional runners.

---

## Web Bridge & Live Logs Issues

### Live Logs Tab Shows `SUPABASE_ACCESS_TOKEN is not set`
- **Cause:** Management API log queries (`postgres_logs`, `auth_logs`, `edge_logs`, `supavisor_logs`) require a Supabase Personal Access Token (`sbp_...`) so database credentials alone cannot query project analytics.
- **Fix:** Start the bridge server with `SUPABASE_ACCESS_TOKEN` exported in your shell environment (and `SUPABASE_PROJECT_REF` if not using a standard Supabase URI):

```bash
SUPABASE_ACCESS_TOKEN="sbp_..." SUPABASE_PROJECT_REF="abcdefghijklmnopqrst" \
  node packages/cli/dist/index.js web --port 3001
```

### Port `3001` Already in Use
- **Fix:** Pass an alternate port: `node packages/cli/dist/index.js web --port 3002`.

### `Browser did not open` on Headless Servers / WSL / Containers
- **Fix:** Start with `--no-open` and forward port `3001` locally (`ssh -L 3001:127.0.0.1:3001 ...`), then open `http://127.0.0.1:3001` in your local browser.
