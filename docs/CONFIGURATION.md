# Configuration Reference

SB Sniffer is zero-config by default and accepts configuration through CLI flags, environment variables, and GitHub Action inputs.

## 1. Environment Variables

| Variable | Used By | Description |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | `serve` / `web` (`/api/logs`) | Personal Supabase Management API token (`sbp_...`) kept strictly server-side in the Node bridge to query `postgres_logs`, `auth_logs`, `edge_logs`, and `supavisor_logs`. |
| `SUPABASE_PROJECT_REF` | `serve` / `web` (`/api/logs`) | 20-character Supabase project reference ID. Automatically inferred from the active Postgres URI (`db.<ref>.supabase.co` or `postgres.<ref>`) when omitted. |
| `PORT` / `--port` | `serve` / `web` | HTTP port for the local Web dashboard bridge (CLI default: `3001`). |
| `HOST` / `--host` | `serve` / `web` | Bind address for the bridge server (default: `127.0.0.1`). Avoid binding to `0.0.0.0` on untrusted networks. |

> **Security Note:** Never store `SUPABASE_ACCESS_TOKEN`, `service_role` keys, or live Postgres passwords inside committed `.env` files. Pass them at runtime in your shell environment.

---

## 2. CLI Reference

### `sb-sniffer analyze`

| Flag | Default | Valid Values / Description |
|---|---|---|
| `-d, --db <uri>` | — | Live PostgreSQL / Supabase URI (`postgresql://...`) |
| `-s, --schema <path>` | — | Single `.sql` dump or directory containing `.sql` migrations (sorted lexicographically) |
| `-a, --app <dir>` | — | Application root directory to scan (`.env*`, `.ts`, `.tsx`, `.js`, `.jsx`, Prisma, Drizzle) |
| `--stats <file>` | — | Path to exported `pg_stat_statements` `.json` or `.csv` |
| `--studio-json <file>` | — | Path to JSON output copied from `sb-sniffer sql-query` |
| `-f, --format <fmt>` | `terminal` | `terminal`, `json`, `markdown`, `sql`, `ai`, `tui` |
| `-o, --out <file>` | stdout | Write formatted output to a file path |
| `--fail-on <sev>` | — | Exit code `1` if any finding matches or exceeds `critical`, `high`, `medium`, or `info` |

### `sb-sniffer fix`

| Flag | Default | Description |
|---|---|---|
| `-s, --schema <path>` | — | Schema dump or migrations directory |
| `-d, --db <uri>` | — | Live Postgres database URI |
| `-a, --app <dir>` | — | App codebase directory (enables App <-> DB index fix generation) |
| `--out-dir <dir>` | `supabase/migrations` | Destination directory for `<timestamp>_sb_sniffer_fixes.sql` |
| `--dry-run` | `false` | Print generated SQL to stdout without writing a file |

### `sb-sniffer pentest`

| Flag | Default | Description |
|---|---|---|
| `-d, --db <uri>` | (required) | Live Postgres URI |
| `-w, --writes` | `false` | Include write/delete probes inside rolled-back transactions |
| `-f, --format <fmt>` | `terminal` | `terminal` or `json` |

### `sb-sniffer prove`

| Flag | Default | Description |
|---|---|---|
| `-d, --db <uri>` | (required) | Live Postgres URI (staging/non-critical workload recommended) |
| `-l, --limit <n>` | `5` | Maximum query patterns to benchmark |
| `-f, --format <fmt>` | `terminal` | `terminal` or `json` |

### `sb-sniffer serve` (aliases: `web`, `gui`)

| Flag | Default | Description |
|---|---|---|
| `-p, --port <port>` | `3001` | Local HTTP/SSE server port |
| `--host <host>` | `127.0.0.1` | Bind host (`127.0.0.1` loopback by default) |
| `-d, --db <uri>` | — | Pre-populate active live connection URI on startup |
| `--no-open` | opens browser | Disable automatic browser launch |

---

## 3. GitHub Action Inputs (`action.yml`)

| Input | Default | Description |
|---|---|---|
| `schema-path` | `supabase/migrations` | Path to SQL schema file or migration directory |
| `app-dir` | `.` | Path to application code directory |
| `fail-on` | `critical` | Minimum finding severity that fails the CI step (`critical`, `high`, `medium`, `info`) |

---

## 4. Connection String & TLS Rules

`pgCollector.ts` normalizes connection URIs automatically:
1. Special characters in DB passwords (`@`, `#`, `$`, `!`, `%`) are percent-encoded safely without double-encoding already encoded sequences.
2. **Localhost / Loopback (`127.0.0.1`, `localhost`, `::1`)**: Connects without TLS unless `sslmode` requires SSL.
3. **Remote Supabase Hosts**: Enables TLS (`ssl: { rejectUnauthorized: false }` by default, or `rejectUnauthorized: true` when `sslmode=verify-full` / `verify-ca` is present).
