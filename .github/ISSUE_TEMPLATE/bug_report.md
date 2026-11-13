---
name: Bug Report
about: Report a bug, false positive, parser failure, or crash in SB Sniffer
title: '[Bug]: '
labels: ['bug']
assignees: []
---

## Summary
A clear description of the bug, false positive, or unexpected behavior.

## Reproduction Steps
1. Command or UI flow used (e.g., `sb-sniffer analyze --schema ...`, `sb-sniffer web`, `sb-sniffer pentest`)
2. Input SQL snippet or anonymized app snippet (never paste real credentials or private JWTs!)
3. Actual output vs expected output

```sql
-- Paste minimal anonymized SQL schema / policy / query that reproduces the issue
```

## Environment
- OS: (e.g., macOS 15, Ubuntu 24.04, Windows WSL2)
- Node.js version: (`node -v`)
- SB Sniffer version / commit:
- Postgres / Supabase mode: (Static SQL dump, Local Supabase CLI, Remote Supavisor `:6543`, Direct `:5432`)
