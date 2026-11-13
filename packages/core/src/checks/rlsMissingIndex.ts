import { DiagnosticFinding, DiagnosticSnapshot } from '../types.js';

export function checkRlsMissingIndex(snapshot: DiagnosticSnapshot): DiagnosticFinding | null {
  const missingIndexes: {
    schema: string;
    table: string;
    columns: string[];
    reason: 'foreign_key' | 'policy_filter';
    context: string;
  }[] = [];

  // 1. Check foreign key columns for covering B-tree index (Supabase Rule 0001_unindexed_foreign_keys)
  // An index covers a foreign key if its leading columns match the foreign key columns in order.
  for (const fk of snapshot.foreignKeys) {
    if (fk.columns.length === 0) continue;

    const isCovered = snapshot.indexes.some((idx) => {
      if (idx.schema !== fk.schema || idx.table !== fk.table) return false;
      if (idx.isValid === false) return false;
      if (idx.columns.length < fk.columns.length) return false;

      // Leading columns must match the FK columns in identical order (stripping quotes)
      return fk.columns.every((fkCol, i) => {
        const idxCol = (idx.columns[i] || '').replace(/"/g, '').toLowerCase();
        return idxCol === fkCol.replace(/"/g, '').toLowerCase();
      });
    });

    if (!isCovered) {
      missingIndexes.push({
        schema: fk.schema,
        table: fk.table,
        columns: fk.columns,
        reason: 'foreign_key',
        context: `Foreign key "${fk.name}" referencing ${fk.foreignSchema}.${fk.foreignTable}(${fk.foreignColumns.join(', ')})`,
      });
    }
  }

  // 2. Check columns filtered in RLS policies (e.g. user_id = ..., owner_id = ...)
  for (const policy of snapshot.policies) {
    const fullExpr = `${policy.qual || ''} ${policy.withCheck || ''}`;
    // Look for common equality filter patterns on user identifiers (e.g. user_id =, owner_id =, organization_id =)
    const colMatches = fullExpr.matchAll(/\b([a-zA-Z_][a-zA-Z0-9_]*_id)\s*=\s*/gi);

    for (const match of colMatches) {
      const colName = match[1];
      const hasIndex = snapshot.indexes.some(
        (idx) =>
          idx.schema === policy.schema &&
          idx.table === policy.table &&
          idx.columns.length > 0 &&
          idx.columns[0]?.replace(/"/g, '').toLowerCase() === colName.toLowerCase() &&
          idx.isValid !== false
      );

      const alreadyReported = missingIndexes.some(
        (m) =>
          m.schema === policy.schema &&
          m.table === policy.table &&
          m.columns.length === 1 &&
          m.columns[0].toLowerCase() === colName.toLowerCase()
      );

      if (!hasIndex && !alreadyReported) {
        missingIndexes.push({
          schema: policy.schema,
          table: policy.table,
          columns: [colName],
          reason: 'policy_filter',
          context: `Filtered in RLS policy "${policy.name}" without a covering index`,
        });
      }
    }
  }

  if (missingIndexes.length === 0) {
    return null;
  }

  const affectedObjects = missingIndexes.map((m) => ({
    schema: m.schema,
    name: `${m.table}(${m.columns.join(', ')})`,
    type: 'index' as const,
    detail: `Missing leading B-tree index. ${m.context}`,
  }));

  const fixSqlStatements = missingIndexes.map((m) => {
    const idxName = `idx_${m.table}_${m.columns.join('_')}`;
    const quotedCols = m.columns.map((c) => `"${c}"`).join(', ');
    return `-- [Rule 0001] Add covering index on ${m.schema}.${m.table}(${quotedCols}):\n` +
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS "${idxName}"\n` +
      `ON "${m.schema}"."${m.table}" USING btree (${quotedCols});`;
  });

  return {
    id: 'RLS_MISSING_INDEX',
    category: 'rls',
    severity: 'high',
    title: 'Missing Indexes on Foreign Keys and RLS Filter Columns',
    summary: `${missingIndexes.length} foreign key or policy filter column(s) lack a covering B-tree index (Supabase Advisor 0001_unindexed_foreign_keys).`,
    whyItClogsSupport:
      'In Supabase, PostgREST automatically embeds relationships using foreign keys, and RLS evaluates ownership filters on every query. Without B-tree indexes matching the foreign key column prefix, parent deletions and updates trigger heavy sequential scans or full table locks on child tables, and user queries turn into sluggish Seq Scans, causing connection pooler saturation and 504 Gateway Timeouts.',
    affectedObjects,
    remediationExplanation:
      'Create covering B-tree indexes matching the exact column order of the foreign key constraint using `CREATE INDEX CONCURRENTLY IF NOT EXISTS`. The `CONCURRENTLY` option builds the index without taking an exclusive table lock.',
    fixSql: fixSqlStatements.join('\n\n'),
    documentationUrl: 'https://supabase.com/docs/guides/database/database-linter#unindexed_foreign_keys',
    metadata: {
      linterRule: '0001_unindexed_foreign_keys',
      missingIndexCount: missingIndexes.length,
    },
  };
}
