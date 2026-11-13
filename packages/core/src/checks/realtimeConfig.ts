import { DiagnosticFinding, DiagnosticSnapshot } from '../types.js';

export function checkRealtimeConfig(snapshot: DiagnosticSnapshot): DiagnosticFinding | null {
  const realtimeTables = snapshot.realtimeTables || [];

  const tablesWithDefaultReplica: typeof realtimeTables = [];

  for (const rt of realtimeTables) {
    if (rt.inPublication) {
      // In Postgres, 'd' is DEFAULT (logs only PK columns).
      // When users listen to UPDATE or DELETE events on Supabase Realtime,
      // DEFAULT replica identity means payload.old only contains the primary key,
      // not the updated/deleted values! To receive the full old record, REPLICA IDENTITY FULL is required.
      if (rt.replicaIdentity === 'd') {
        tablesWithDefaultReplica.push(rt);
      }
    }
  }

  if (tablesWithDefaultReplica.length === 0) {
    return null;
  }

  const affectedObjects = tablesWithDefaultReplica.map((t) => ({
    schema: t.schema,
    name: t.table,
    type: 'table' as const,
    detail: `Table is in "supabase_realtime" publication with REPLICA IDENTITY DEFAULT ('d'). Realtime DELETE and UPDATE events will lack column values in payload.old.`,
  }));

  const fixSqlStatements = tablesWithDefaultReplica.map(
    (t) =>
      `-- Enable full replica identity so Realtime broadcasts complete payload.old on UPDATE/DELETE:\n` +
      `ALTER TABLE "${t.schema}"."${t.table}" REPLICA IDENTITY FULL;`
  );

  return {
    id: 'REALTIME_PUBLICATION_MISCONFIG',
    category: 'realtime',
    severity: 'medium',
    title: 'Realtime Tables Missing REPLICA IDENTITY FULL',
    summary: `${tablesWithDefaultReplica.length} table(s) in "supabase_realtime" publication use REPLICA IDENTITY DEFAULT, omitting column values from payload.old.`,
    whyItClogsSupport:
      'Developers frequently submit questions like: "Why is payload.old empty or only showing { id } when listening to postgres_changes DELETE/UPDATE events in supabase-js?". In PostgreSQL, the Write-Ahead Log (WAL) only records the primary key for updates and deletes by default. To receive previous column states or enable fine-grained client-side row filters, the table must be configured with REPLICA IDENTITY FULL.',
    affectedObjects,
    remediationExplanation:
      'Set `REPLICA IDENTITY FULL` on tables added to the `supabase_realtime` publication if client-side subscriptions require inspecting previous row values during UPDATE or DELETE operations.',
    fixSql: fixSqlStatements.join('\n\n'),
    documentationUrl: 'https://supabase.com/docs/guides/realtime/postgres-changes#replica-identity',
    metadata: {
      affectedCount: tablesWithDefaultReplica.length,
    },
  };
}
