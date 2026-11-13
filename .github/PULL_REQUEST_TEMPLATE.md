## Summary
Describe what this PR fixes or adds and why.

## Related Issue
Closes #

## Verification
- [ ] `npm run build` passes cleanly
- [ ] `npm run typecheck` passes cleanly
- [ ] `npm test` passes cleanly (including new regression tests for parser/check changes)
- [ ] No hardcoded credentials, tokens, or personal environment files (`.env*`, `supabase/.temp`) included

## Check / Parser Impact (if applicable)
- [ ] Updated or verified affected check documentation and remediation SQL (`CONCURRENTLY` / transaction-safe where applicable)
- [ ] Verified static SQL parser and live Postgres collector parity where relevant
