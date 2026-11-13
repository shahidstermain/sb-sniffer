import { DiagnosticFinding, DiagnosticSnapshot } from '../types.js';

export function checkPoolerMismatch(snapshot: DiagnosticSnapshot): DiagnosticFinding | null {
  const conn = snapshot.connections;
  if (!conn) {
    return null;
  }

  const isPort6543 = conn.port === 6543 || conn.poolerMode === 'transaction';
  const hasPreparedStmts = (conn.preparedStatementsCount || 0) > 0;
  const isDirectServerless = conn.port === 5432 && conn.activeConnections > 40;

  const affectedObjects: {
    name: string;
    type: 'connection';
    detail: string;
  }[] = [];

  const tips: string[] = [];

  if (isPort6543 && hasPreparedStmts) {
    affectedObjects.push({
      name: `Port ${conn.port || 6543} (Supavisor Transaction Mode)`,
      type: 'connection',
      detail: `Found ${conn.preparedStatementsCount} prepared statement(s) on transaction mode pooler. Prepared statements are session-scoped and fail when pooled across backend connections.`,
    });
    tips.push(
      'Prisma: Append `?pgbouncer=true` to your DATABASE_URL in transaction mode (port 6543).'
    );
    tips.push(
      'Node.js (postgres / pg): Disable statement caching or use `prepare: false`.'
    );
    tips.push(
      'Drizzle ORM: Pass `{ prepare: false }` to the postgres-js client configuration.'
    );
    tips.push(
      'Python (asyncpg / SQLAlchemy): Pass `statement_cache_size: 0` in connect_args.'
    );
    tips.push(
      'Go (pgx): Set `DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol` in connection pool config.'
    );
  }

  if (isDirectServerless) {
    affectedObjects.push({
      name: `Direct Postgres Port 5432 with High Concurrency`,
      type: 'connection',
      detail: `High connection count (${conn.activeConnections}) on direct session port 5432. Serverless functions (e.g. Next.js on Vercel) exhaust max connections on port 5432.`,
    });
    tips.push(
      'Switch serverless / edge runtime connection strings to Supavisor transaction pooler on port 6543.'
    );
  }

  if (affectedObjects.length === 0) {
    return null;
  }

  return {
    id: 'POOLER_PORT_AND_PREPARED_STMT_MISMATCH',
    category: 'connection_pooler',
    severity: isPort6543 && hasPreparedStmts ? 'critical' : 'high',
    title: 'Connection Pooler (Supavisor) Port and Prepared Statement Mismatch',
    summary:
      isPort6543 && hasPreparedStmts
        ? `Active prepared statements detected while routing through transaction mode (port ${conn.port || 6543}).`
        : `Direct session connection port 5432 used under high concurrency.`,
    whyItClogsSupport:
      'Supabase Support regularly deals with mysterious "ERROR: prepared statement \\"s1\\" already exists" or "does not exist" errors. When clients use Prisma, Drizzle, or asyncpg on port 6543 without pooler flags, Supavisor hands each query a different backend Postgres connection. If Connection A prepares a statement and Connection B tries to execute it, Postgres crashes the query. Conversely, connecting serverless lambdas directly to port 5432 rapidly triggers "FATAL: sorry, too many clients already".',
    affectedObjects,
    remediationExplanation:
      `Configure ORM / driver parameters based on port:\n- ${tips.join('\n- ')}\n` +
      'For heavy migrations (e.g. `prisma migrate dev`), use direct port 5432 (Session mode); for serverless app runtime, use port 6543 (Transaction mode) with prepared statements disabled.',
    documentationUrl: 'https://supabase.com/docs/guides/database/connecting-to-postgres#how-connection-pooling-works',
    metadata: {
      port: conn.port,
      poolerMode: conn.poolerMode,
      preparedStatementsCount: conn.preparedStatementsCount,
      activeConnections: conn.activeConnections,
    },
  };
}
