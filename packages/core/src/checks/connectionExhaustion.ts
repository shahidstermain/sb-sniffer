import { DiagnosticFinding, DiagnosticSnapshot } from '../types.js';

export function checkConnectionExhaustion(snapshot: DiagnosticSnapshot): DiagnosticFinding | null {
  const conn = snapshot.connections;
  if (!conn) {
    return null;
  }

  const maxConn = conn.maxConnections || 100;
  const totalInUse = (conn.activeConnections || 0) + (conn.idleConnections || 0);
  const utilizationRatio = totalInUse / maxConn;
  const idleInTx = conn.idleInTransaction || 0;
  const idleInTxSeconds = conn.idleInTransactionLongestSeconds || 0;

  const affectedObjects: {
    name: string;
    type: 'connection';
    detail: string;
  }[] = [];

  if (utilizationRatio >= 0.85) {
    affectedObjects.push({
      name: `High Connection Pool Utilization (${Math.round(utilizationRatio * 100)}%)`,
      type: 'connection',
      detail: `${totalInUse} out of ${maxConn} connections occupied (${conn.activeConnections} active, ${conn.idleConnections} idle). Risk of immediate connection rejection.`,
    });
  } else if (utilizationRatio >= 0.7) {
    affectedObjects.push({
      name: `Elevated Connection Pool Utilization (${Math.round(utilizationRatio * 100)}%)`,
      type: 'connection',
      detail: `${totalInUse} out of ${maxConn} connections in use. Approaching saturation threshold.`,
    });
  }

  if (idleInTx > 0 && idleInTxSeconds > 30) {
    affectedObjects.push({
      name: `Stuck Idle-in-Transaction Connections (${idleInTx})`,
      type: 'connection',
      detail: `${idleInTx} connection(s) stuck in "idle in transaction" for up to ${Math.round(idleInTxSeconds)}s. These hold locks and lock backend tellers in Supavisor.`,
    });
  }

  // App breakdown inspection
  if (conn.connectionsByApp) {
    for (const [appName, count] of Object.entries(conn.connectionsByApp)) {
      if (count > maxConn * 0.4) {
        affectedObjects.push({
          name: `Client Pool Sprawl: "${appName}"`,
          type: 'connection',
          detail: `Application "${appName}" holds ${count} connections (${Math.round((count / maxConn) * 100)}% of total capacity).`,
        });
      }
    }
  }

  if (affectedObjects.length === 0) {
    return null;
  }

  const isSevere = utilizationRatio >= 0.85 || (idleInTx > 0 && idleInTxSeconds > 60);

  return {
    id: 'CONNECTION_EXHAUSTION_AND_IDLE_LEAKS',
    category: 'connection_pooler',
    severity: isSevere ? 'critical' : 'high',
    title: 'Connection Pool Exhaustion and Idle-in-Transaction Leaks',
    summary: `Connection pool utilization is at ${Math.round(utilizationRatio * 100)}% (${totalInUse}/${maxConn}) with ${idleInTx} connection(s) idle in transaction.`,
    whyItClogsSupport:
      'Users frequently report that their database has crashed or "stopped responding" with error: `FATAL: sorry, too many clients already` or `Max client connections reached`. In reality, serverless deployments spin up tens of container instances with default pool limits (e.g. 10 connections each), quickly exhausting Postgres slots. Unclosed transaction blocks (`BEGIN` without `COMMIT`/`ROLLBACK`) hold Supavisor backend tellers hostage, blocking all other tenants.',
    affectedObjects,
    remediationExplanation:
      '1. In serverless / Lambda / Vercel functions, set connection pool size to 1 (`connection_limit=1` or `NullPool`).\n' +
      '2. Configure `idle_in_transaction_session_timeout` to automatically terminate stuck transactions:\n' +
      '   `ALTER DATABASE postgres SET idle_in_transaction_session_timeout = "60000";` (60s)\n' +
      '3. Ensure all backend transaction blocks in your code have `try ... finally { client.release() }`.',
    fixSql:
      '-- Terminate transactions that have been idle for more than 60 seconds:\n' +
      'ALTER DATABASE postgres SET idle_in_transaction_session_timeout = "60000";\n\n' +
      '-- Force terminate active idle-in-transaction connections right now:\n' +
      "SELECT pg_terminate_backend(pid)\nFROM pg_stat_activity\nWHERE state = 'idle in transaction'\n  AND state_change < NOW() - INTERVAL '60 seconds'\n  AND pid <> pg_backend_pid();",
    documentationUrl: 'https://supabase.com/docs/guides/platform/performance#managing-connections',
    metadata: {
      utilizationRatio,
      totalInUse,
      maxConn,
      idleInTx,
      idleInTxSeconds,
    },
  };
}
