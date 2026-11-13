import { DiagnosticFinding, DiagnosticSnapshot } from '../types.js';

export function checkStatStatements(snapshot: DiagnosticSnapshot): DiagnosticFinding | null {
  const stats = snapshot.statStatements || [];
  if (stats.length === 0) {
    return null;
  }

  const slowQueries: typeof stats = [];
  const lowCacheQueries: typeof stats = [];
  const largeOffsetQueries: typeof stats = [];

  for (const q of stats) {
    // 1. Slow queries (mean exec time > 250ms or total exec time > 10000ms with multiple calls)
    if (q.meanExecTimeMs > 250 && q.calls > 5) {
      slowQueries.push(q);
    }

    // 2. Low cache hit ratio
    const totalBlocks = (q.sharedBlksHit || 0) + (q.sharedBlksRead || 0);
    if (totalBlocks > 500) {
      const hitRatio = q.sharedBlksHit / totalBlocks;
      if (hitRatio < 0.9) {
        lowCacheQueries.push(q);
      }
    }

    // 3. High offset pagination queries
    if (/OFFSET\s+[0-9]{4,}/i.test(q.query)) {
      largeOffsetQueries.push(q);
    }
  }

  if (slowQueries.length === 0 && lowCacheQueries.length === 0 && largeOffsetQueries.length === 0) {
    return null;
  }

  const affectedObjects: {
    name: string;
    type: 'query';
    detail: string;
  }[] = [];

  for (const q of slowQueries.slice(0, 5)) {
    const preview = q.query.replace(/\s+/g, ' ').substring(0, 100);
    affectedObjects.push({
      name: `Query: ${preview}...`,
      type: 'query',
      detail: `Mean exec time: ${q.meanExecTimeMs.toFixed(1)}ms across ${q.calls} calls (Total: ${(q.totalExecTimeMs / 1000).toFixed(1)}s).`,
    });
  }

  for (const q of lowCacheQueries.slice(0, 3)) {
    const preview = q.query.replace(/\s+/g, ' ').substring(0, 100);
    const totalBlocks = (q.sharedBlksHit || 0) + (q.sharedBlksRead || 0);
    const hitRatio = Math.round((q.sharedBlksHit / totalBlocks) * 100);
    affectedObjects.push({
      name: `Disk I/O Heavy: ${preview}...`,
      type: 'query',
      detail: `Low shared buffer hit ratio (${hitRatio}%). Query is continually reading blocks from disk storage rather than RAM.`,
    });
  }

  for (const q of largeOffsetQueries.slice(0, 3)) {
    const preview = q.query.replace(/\s+/g, ' ').substring(0, 100);
    affectedObjects.push({
      name: `Deep Offset Pagination: ${preview}...`,
      type: 'query',
      detail: `Uses large OFFSET clauses. Postgres must scan and discard thousands of rows before returning results.`,
    });
  }

  const severity = slowQueries.some((q) => q.meanExecTimeMs > 1000) ? 'high' : 'medium';

  return {
    id: 'PG_STAT_STATEMENTS_HOTSPOTS',
    category: 'performance',
    severity,
    title: 'Top Slow Queries and Buffer Cache Misses in pg_stat_statements',
    summary: `Identified ${slowQueries.length} slow query/queries (>250ms mean latency) and ${lowCacheQueries.length} high-disk-read query/queries in pg_stat_statements.`,
    whyItClogsSupport:
      'Spike in database CPU and disk IOPS is a primary reason users write to Supabase support asking for emergency instance upgrades. A single unindexed query or deep `OFFSET 50000` pagination invoked repeatedly by a frontend component can overwhelm compute credits, triggering 504 timeouts across the entire project.',
    affectedObjects,
    remediationExplanation:
      '1. Replace `OFFSET` pagination with Keyset Cursor pagination (`WHERE id > last_seen_id ORDER BY id ASC LIMIT 20`).\n' +
      '2. Inspect query execution plans using `EXPLAIN (ANALYZE, BUFFERS) <query>` in the Supabase Studio SQL editor.\n' +
      '3. Add composite indexes matching the `WHERE` and `ORDER BY` columns to eliminate sequential table scans and buffer misses.',
    documentationUrl: 'https://supabase.com/docs/guides/database/inspecting-queries',
    metadata: {
      slowCount: slowQueries.length,
      lowCacheCount: lowCacheQueries.length,
      largeOffsetCount: largeOffsetQueries.length,
    },
  };
}
