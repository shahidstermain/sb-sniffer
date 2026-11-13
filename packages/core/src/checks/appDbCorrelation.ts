import { AffectedObject, DiagnosticFinding, DiagnosticSnapshot } from '../types.js';

/**
 * Check 12: Full-Stack App <-> DB Query & Index Correlation
 * Cross-references supabase.from(...).eq('col') calls in application code against live Postgres indexes,
 * and flags unbounded .select('*') queries that inflate Supabase Egress.
 */
export function checkAppDbCorrelation(snapshot: DiagnosticSnapshot): DiagnosticFinding | null {
  const appCode = snapshot.appCode;
  if (!appCode || appCode.items.length === 0) return null;

  const affectedObjects: AffectedObject[] = [];
  const fixStatements: string[] = [];
  const seenMissingIndexes = new Set<string>();

  // 1. Unbounded .select('*') in app code
  const unbounded = appCode.items.filter((i) => i.kind === 'unbounded_select_star');
  for (const item of unbounded) {
    affectedObjects.push({
      name: `${item.file}:${item.line}`,
      type: 'code',
      detail: item.detail,
    });
  }

  // 2. Cross-reference app .eq('col') filters against DB indexes
  const filterCalls = appCode.items.filter((i) => i.kind === 'app_filter_call' && i.table && i.column);
  for (const call of filterCalls) {
    const tableName = call.table!;
    const colName = call.column!;

    // Only check if the table exists in the DB snapshot
    const tableExists = snapshot.tables.some((t) => t.name === tableName && t.schema === 'public');
    if (!tableExists) continue;

    const hasLeadingIndex = snapshot.indexes.some(
      (idx) =>
        idx.table === tableName &&
        idx.schema === 'public' &&
        idx.isValid !== false &&
        idx.columns.length > 0 &&
        idx.columns[0].replace(/"/g, '').toLowerCase() === colName.toLowerCase()
    );

    if (!hasLeadingIndex) {
      const key = `${tableName}.${colName}`;
      if (!seenMissingIndexes.has(key)) {
        seenMissingIndexes.add(key);
        affectedObjects.push({
          name: `public.${tableName} (${colName})`,
          type: 'index',
          detail: `App code (${call.file}:${call.line}) filters on "${colName}", but no leading B-tree index exists on public.${tableName}(${colName}).`,
        });
        fixStatements.push(
          `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_${tableName}_${colName} ON public."${tableName}" ("${colName}");`
        );
      }
    }
  }

  if (affectedObjects.length === 0) return null;

  return {
    id: 'APP_QUERY_AND_INDEX_MISMATCH',
    category: 'app_code',
    severity: seenMissingIndexes.size > 0 ? 'high' : 'medium',
    title: 'App Query <-> Database Index & Pagination Mismatches',
    summary: `Correlated ${appCode.scannedFiles} app file(s) with Postgres schema: found ${seenMissingIndexes.size} unindexed app filter(s) and ${unbounded.length} unbounded .select('*') call(s).`,
    whyItClogsSupport:
      'Frontend/API filters like `.from("orders").eq("tenant_id", id)` trigger full sequential scans in Postgres when no matching index exists, while unbounded `.select("*")` calls pull entire JSONB/text payloads and spike PostgREST egress.',
    affectedObjects,
    remediationExplanation:
      'Add B-tree indexes for columns frequently filtered by your application code, and specify explicit columns + `.limit()` / `.range()` on PostgREST `.select()` calls.',
    fixSql: fixStatements.length > 0 ? fixStatements.join('\n') : undefined,
    documentationUrl: 'https://supabase.com/docs/guides/database/indexes',
    metadata: {
      unindexedAppFilters: seenMissingIndexes.size,
      unboundedSelectStars: unbounded.length,
    },
  };
}
