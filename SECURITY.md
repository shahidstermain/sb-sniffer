# Security Policy

## Supported Versions

| Version | Supported |
|---|---|
| `1.0.x` (`main`) | Yes |

## Security Model & Data Handling

SB Sniffer is designed for local-first and CI-based Supabase diagnostics:

- **Offline / Static Modes (`analyze --schema`, `--app`, `--json`, Web Upload, `mcp`)**: Runs completely locally without network access or database credentials.
- **Live Bridge Server (`sb-sniffer serve` / `web`)**: Binds by default to `127.0.0.1` (loopback only), restricts CORS headers to local browser origins (`localhost`, `127.0.0.1`, `[::1]`), holds any active Postgres URI in process memory only, and keeps `SUPABASE_ACCESS_TOKEN` on the server side when querying the Supabase Management API.
- **Read-Mostly & Transaction-Rolled-Back Live Operations**:
  - Live snapshot inspection executes read-only `pg_catalog`, `pg_stat_*`, and `information_schema` queries.
  - `sb-sniffer pentest` and `sb-sniffer prove` wrap probes inside explicit `BEGIN ... ROLLBACK` transactions (`SET LOCAL ROLE anon` / `SET LOCAL ROLE authenticated` for `pentest`, `EXPLAIN (ANALYZE, BUFFERS)` for `prove`) so no data mutations are committed. **Caution**: `EXPLAIN ANALYZE` still executes query plans against live tables; run `prove` against staging or non-critical workloads when possible.
  - `POST /api/terminate-session` explicitly executes `pg_terminate_backend($1)` only when triggered by an operator in the Live Bridge UI.

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues, discussions, or pull requests.**

Instead, please report them privately via [GitHub Security Advisories](https://github.com/shahidstermain/sb-sniffer/security/advisories/new).

Include as much of the following as possible:

- Affected package (`@sb-sniffer/core`, `sb-sniffer`, `@sb-sniffer/web`) and version/commit
- Steps to reproduce or proof-of-concept
- Potential impact (e.g., SSRF, path traversal, CORS bypass, SQL injection, credential leakage)

We aim to acknowledge reports within 48 hours and provide an assessment or remediation timeline as quickly as possible.

## Best Practices for Users

- Never commit `.env*`, database connection strings, `service_role` keys, `SUPABASE_ACCESS_TOKEN`, or `supabase/.temp/` files.
- Keep `sb-sniffer serve` bound to `127.0.0.1` unless you intentionally expose it behind an authenticated tunnel.
- Avoid running `sb-sniffer prove` (`EXPLAIN ANALYZE`) with production write workloads during peak traffic.
