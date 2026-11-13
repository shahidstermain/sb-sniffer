import { Client } from 'pg';
import pc from 'picocolors';
import { analyzeSnapshot } from '@sb-sniffer/core';
import { collectLiveSnapshot, createPgClientConfig } from './pgCollector.js';

export interface ExplainProofItem {
  findingId: string;
  query: string;
  fixApplied: string;
  beforeTimeMs: number;
  afterTimeMs: number;
  beforeBuffers: number;
  afterBuffers: number;
  speedupRatio: number;
}

function extractExplainMetrics(planJson: any): { timeMs: number; buffers: number } {
  const root = Array.isArray(planJson) ? planJson[0] : planJson;
  const timeMs = Number(root?.['Execution Time'] ?? root?.Plan?.['Actual Total Time'] ?? 0);
  const plan = root?.Plan || {};
  const buffers = Number(plan['Shared Hit Blocks'] ?? 0) + Number(plan['Shared Read Blocks'] ?? 0);
  return { timeMs, buffers };
}

/**
 * Runs EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) before and after applying candidate
 * fixes inside a strictly rolled-back transaction (BEGIN ... ROLLBACK).
 * Note: Recommended for staging databases; enforces a 10s statement_timeout.
 */
export async function runExplainProof(
  connectionString: string,
  limit = 5
): Promise<ExplainProofItem[]> {
  const snapshot = await collectLiveSnapshot({ connectionString });
  const report = analyzeSnapshot(snapshot);

  // Collect candidate DDL fixes (strip CONCURRENTLY because Postgres forbids it inside BEGIN..ROLLBACK)
  const fixStatements: Array<{ findingId: string; sql: string }> = [];
  for (const f of report.findings) {
    if (!f.fixSql) continue;
    const stmts = f.fixSql
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith('--'))
      .map((s) => s.replace(/CREATE\s+INDEX\s+CONCURRENTLY/gi, 'CREATE INDEX'));

    for (const sql of stmts) {
      if (/^(CREATE\s+INDEX|ALTER\s+POLICY)/i.test(sql)) {
        fixStatements.push({ findingId: f.id, sql });
      }
    }
  }

  // Pick slow SELECT queries from pg_stat_statements (without $1 bind params for direct EXPLAIN, or skip parameterized)
  const candidateQueries = (snapshot.statStatements || [])
    .filter((s) => /^\s*SELECT\b/i.test(s.query) && !/\$\d+/.test(s.query))
    .slice(0, limit);

  if (fixStatements.length === 0 || candidateQueries.length === 0) {
    return [];
  }

  const client = new Client(createPgClientConfig(connectionString, 10000));

  await client.connect();
  const proofs: ExplainProofItem[] = [];

  try {
    for (const stmt of candidateQueries) {
      try {
        await client.query('BEGIN');

        const beforeRes = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${stmt.query}`);
        const before = extractExplainMetrics(beforeRes.rows[0]?.['QUERY PLAN']);

        for (const fix of fixStatements) {
          await client.query(fix.sql);
        }

        const afterRes = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${stmt.query}`);
        const after = extractExplainMetrics(afterRes.rows[0]?.['QUERY PLAN']);

        await client.query('ROLLBACK');

        const speedupRatio = after.timeMs > 0 ? Number((before.timeMs / after.timeMs).toFixed(1)) : 1;
        proofs.push({
          findingId: fixStatements[0].findingId,
          query: stmt.query.slice(0, 100),
          fixApplied: `${fixStatements.length} DDL fix(es) tested in rolled-back tx`,
          beforeTimeMs: Number(before.timeMs.toFixed(2)),
          afterTimeMs: Number(after.timeMs.toFixed(2)),
          beforeBuffers: before.buffers,
          afterBuffers: after.buffers,
          speedupRatio,
        });
      } catch {
        await client.query('ROLLBACK').catch(() => {});
      }
    }
  } finally {
    await client.end().catch(() => {});
  }

  return proofs;
}

export function renderExplainProofTerminal(proofs: ExplainProofItem[]): void {
  console.log('');
  console.log(pc.bold(pc.cyan('⚡ SB Sniffer — EXPLAIN (ANALYZE, BUFFERS) Proof Engine')));
  console.log(pc.dim('All candidate fixes executed inside BEGIN ... ROLLBACK (zero persistent schema changes).\n'));

  if (proofs.length === 0) {
    console.log(pc.yellow('No non-parameterized slow SELECT queries + DDL fixes available to benchmark.'));
    return;
  }

  for (const p of proofs) {
    console.log(`  ${pc.bold(p.query)}`);
    console.log(
      `    Before: ${pc.red(`${p.beforeTimeMs}ms`)} (${p.beforeBuffers} buffers)  →  ` +
        `After: ${pc.green(`${p.afterTimeMs}ms`)} (${p.afterBuffers} buffers)  ` +
        pc.bold(pc.cyan(`[${p.speedupRatio}x faster]`))
    );
  }
  console.log('');
}
