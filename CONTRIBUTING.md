# Contributing to SB Sniffer

Thank you for interest in contributing to **SB Sniffer**! Contributions of bug fixes, parser improvements, new diagnostic checks, tests, and documentation are warmly welcomed.

## Repository Structure

SB Sniffer is a TypeScript npm workspaces monorepo (`Node.js >= 18`):

```text
packages/
  core/   # @sb-sniffer/core — Parsers (AST + fallback), 14 diagnostic checks, scorer, formatters, demo fixtures
  cli/    # sb-sniffer — CLI commands, pgCollector, liveServer bridge, MCP server, RLS pentester, EXPLAIN prover, TUI
  web/    # @sb-sniffer/web — Vite + React + Tailwind web dashboard & zero-credential Studio SQL generator
```

## Local Development Setup

```bash
git clone https://github.com/shahidstermain/sb-sniffer.git
cd sb-sniffer
npm install
npm run build
npm run typecheck
npm test
```

Running from source during development:

```bash
# Run CLI offline demo
node packages/cli/dist/index.js demo

# Run static analysis against the included sample broken schema
node packages/cli/dist/index.js analyze --schema sample/schema_dump_broken.sql --format markdown

# Start Web UI dev server (in separate terminal alongside `npm run serve -- --no-open`)
npm run dev:web
```

## Making Changes

1. **Fork & Branch**: Create a descriptive branch from `main` (e.g. `fix/parser-partial-index`, `feat/check-vector-hnsw`).
2. **Keep Checks Self-Contained**:
   - Diagnostic checks live in `packages/core/src/checks/` and are registered in `packages/core/src/checks/index.ts`.
   - Every finding must include an accurate `id`, `category`, `severity`, `whyItMatters`, concrete `affectedObjects`, safe `remediation` steps + SQL, and a valid Supabase/PostgreSQL documentation link.
   - Any auto-generated `CREATE INDEX` remediation SQL must be compatible with `formatSafeMigrationSql` (`CREATE INDEX CONCURRENTLY IF NOT EXISTS`, outside `BEGIN`/`COMMIT` blocks).
3. **Add Regression Tests**:
   - Core parser and check tests live in `packages/core/src/tests/` and run with Node's native test runner (`node --test`).
   - CLI, bridge, and MCP tests live in `packages/cli/src/tests/`.
4. **Verify Before Opening a PR**:

```bash
npm run build && npm run typecheck && npm test
```

## Pull Request Checklist

- Zero hardcoded secrets, `.env*` files, personal project references, or `supabase/.temp/` artifacts.
- Tests and TypeScript checks pass across all three workspaces.
- Documentation (`README.md` or `docs/`) updated if CLI flags, check IDs, or MCP tools changed.

By participating in this project, you agree to abide by the [Code of Conduct](CODE_OF_CONDUCT.md).
