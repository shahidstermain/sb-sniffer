import { AffectedObject, DiagnosticFinding, DiagnosticSnapshot } from '../types.js';

/**
 * Check 13: Supabase Egress & Compute Cost Drivers
 * Identifies high-egress SELECT * queries, heavy sequential scan tables, and public storage buckets
 * that drive unexpected Supabase billing spikes.
 */
export function checkEgressCostDrivers(snapshot: DiagnosticSnapshot): DiagnosticFinding | null {
  const affectedObjects: AffectedObject[] = [];
  const fixStatements: string[] = [];

  // 1. High-row SELECT * or unpaginated queries in pg_stat_statements
  if (snapshot.statStatements) {
    for (const stmt of snapshot.statStatements) {
      const normalized = stmt.query.toLowerCase();
      const avgRowsPerCall = stmt.calls > 0 ? stmt.rows / stmt.calls : 0;
      if (normalized.includes('select *') && avgRowsPerCall > 100 && stmt.calls > 20) {
        affectedObjects.push({
          name: stmt.query.slice(0, 80) + (stmt.query.length > 80 ? '...' : ''),
          type: 'query',
          detail: `SELECT * executed ${stmt.calls} times returning ~${Math.round(avgRowsPerCall)} rows/call (${stmt.rows} total rows). High PostgREST egress driver.`,
        });
      }
    }
  }

  // 2. Heavy sequential scan tables burning Compute/IOPS
  if (snapshot.statTables) {
    for (const tbl of snapshot.statTables) {
      if (tbl.schema === 'public' && tbl.seqScan > 500 && tbl.seqTupRead > 500_000) {
        affectedObjects.push({
          name: `${tbl.schema}.${tbl.table}`,
          type: 'table',
          detail: `${tbl.seqScan.toLocaleString()} sequential scans reading ${tbl.seqTupRead.toLocaleString()} tuples (vs ${tbl.idxScan.toLocaleString()} index scans). Burning CPU & Disk IOPS.`,
        });
      }
    }
  }

  // 3. Public storage buckets without CDN cache-control or large unowned objects
  if (snapshot.storageBuckets) {
    const publicBuckets = snapshot.storageBuckets.filter((b) => b.public);
    for (const bucket of publicBuckets) {
      affectedObjects.push({
        name: `storage.bucket/${bucket.name}`,
        type: 'bucket',
        detail: `Public bucket "${bucket.name}" serves unauthenticated downloads directly; ensure Cache-Control headers and image transformations are bounded to prevent egress spikes.`,
      });
    }
  }

  if (affectedObjects.length === 0) return null;

  return {
    id: 'EGRESS_AND_COST_DRIVERS',
    category: 'egress_cost',
    severity: affectedObjects.some((o) => o.type === 'query' || o.type === 'table') ? 'high' : 'info',
    title: 'Supabase Egress & Compute Cost Drivers',
    summary: `Identified ${affectedObjects.length} egress or compute cost driver(s) across queries, sequential scans, or public storage buckets.`,
    whyItClogsSupport:
      'Unexpected Supabase Egress and Disk IOPS overages are one of the top billing/support escalations. Unpaginated `SELECT *` queries, missing indexes causing millions of sequential tuple reads, and uncached public Storage buckets rapidly exhaust monthly quotas.',
    affectedObjects,
    remediationExplanation:
      '1. Replace `SELECT *` with explicit column lists and enforce `.limit()` / keyset pagination.\n' +
      '2. Add indexes on high-sequential-scan tables to eliminate wasted Disk IOPS.\n' +
      '3. Set `cacheControl` on Storage uploads and restrict public buckets where signed URLs suffice.',
    fixSql: fixStatements.length > 0 ? fixStatements.join('\n') : undefined,
    documentationUrl: 'https://supabase.com/docs/guides/platform/manage-your-usage/egress',
  };
}
