import pc from 'picocolors';
import readline from 'node:readline';
import { collectLiveSnapshot } from './pgCollector.js';
import { analyzeSnapshot } from '@sb-sniffer/core';

export async function runLiveWatchMode(options: { connectionString: string; intervalSeconds?: number }): Promise<void> {
  const { connectionString, intervalSeconds = 3 } = options;

  let isRunning = true;
  let pollCount = 0;
  let lastError = '';

  if (process.stdin.isTTY) {
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.on('keypress', (_str, key) => {
      if ((key.ctrl && key.name === 'c') || key.name === 'q') {
        isRunning = false;
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
        process.stdout.write('\x1b[?25h'); // show cursor
        console.log('\nExited live watch mode.');
        process.exit(0);
      }
    });
  }

  process.stdout.write('\x1b[?25l'); // hide cursor

  const tick = async () => {
    if (!isRunning) return;

    try {
      pollCount++;
      const snapshot = await collectLiveSnapshot({
        connectionString,
        timeoutMs: 5000,
      });
      const report = analyzeSnapshot(snapshot);

      // Redraw in place (no scrollback wipe) so the previous frame never flashes blank
      process.stdout.write('\x1b[H\x1b[J');

      // Top Live Banner
      const now = new Date().toLocaleTimeString();
      console.log(
        pc.bgGreen(pc.black(pc.bold('  ● REALTIME SUPABASE SNIFFER MONITOR  '))) +
          pc.dim(`  Poll #${pollCount}  ──  Updated: `) +
          pc.bold(now) +
          pc.dim(`  [Refresh: ${intervalSeconds}s] (Press q to exit)`)
      );

      // Score and Connection HUD
      const scoreColor =
        report.healthScore >= 80 ? pc.green : report.healthScore >= 60 ? pc.yellow : pc.red;
      console.log(
        `\n  ${pc.dim('Health Score:')} ` +
          scoreColor(pc.bold(`${report.healthScore}/100`)) +
          `  [Grade: ` +
          scoreColor(pc.bold(report.grade)) +
          `]` +
          `  ${pc.dim('Active Issues:')} ` +
          pc.bold(String(report.findings.length)) +
          ` (Crit: ` +
          pc.red(pc.bold(String(report.summary.criticalCount))) +
          `, High: ` +
          pc.yellow(pc.bold(String(report.summary.highCount))) +
          `)`
      );

      // Pooler & Connection HUD
      const conn = snapshot.connections;
      if (conn) {
        const poolerBadge =
          conn.port === 6543
            ? pc.bgCyan(pc.black(' Supavisor Port 6543 (Tx Mode) '))
            : pc.bgBlue(pc.white(' Direct Port 5432 (Session) '));

        const idleTxColor = (conn.idleInTransaction || 0) > 0 ? pc.red : pc.green;
        console.log(
          `  ${pc.dim('Connection HUD:')} ${poolerBadge}  Total: ${pc.bold(
            `${conn.activeConnections + conn.idleConnections}/${conn.maxConnections}`
          )}  Active: ${pc.cyan(String(conn.activeConnections))}  Idle: ${pc.dim(
            String(conn.idleConnections)
          )}  IdleInTx: ${idleTxColor(pc.bold(String(conn.idleInTransaction)))}`
        );
      }

      console.log('\n' + pc.dim('─'.repeat(70)));

      // Top Active Queries / Activity
      const activities = snapshot.statActivity || [];
      console.log(`  ${pc.bold('⚡ Live Sessions (pg_stat_activity):')}`);
      if (activities.length === 0) {
        console.log(`    ${pc.dim('No active external queries running at this moment.')}`);
      } else {
        activities.slice(0, 5).forEach((act) => {
          const stateColor =
            act.state === 'active'
              ? pc.green
              : act.state.includes('idle in transaction')
              ? pc.red
              : pc.dim;
          console.log(
            `    • PID ${pc.cyan(String(act.pid))} [${stateColor(act.state)}] ` +
              pc.bold(act.applicationName || 'client') +
              ` (${act.durationSeconds}s) ${pc.dim(act.query ? act.query.substring(0, 50) + '...' : '')}`
          );
        });
      }

      console.log('\n' + pc.dim('─'.repeat(70)));

      // Top Urgent Diagnostic Warnings
      console.log(`  ${pc.bold('🚨 Live Health Diagnostic Alerts:')}`);
      if (report.findings.length === 0) {
        console.log(`    ${pc.green('✔ All 14 checks passing. No bottlenecks detected!')}`);
      } else {
        report.findings.slice(0, 4).forEach((f, i) => {
          const sev =
            f.severity === 'critical'
              ? pc.red('CRITICAL')
              : f.severity === 'high'
              ? pc.yellow('HIGH')
              : pc.cyan('MED');
          console.log(`    ${i + 1}. [${sev}] ${pc.bold(f.title)}`);
          console.log(`       ${pc.dim(f.summary)}`);
        });
        if (report.findings.length > 4) {
          console.log(`       ${pc.dim(`... and ${report.findings.length - 4} more issues.`)}`);
        }
      }

      console.log('\n' + pc.dim('─'.repeat(70)));
      console.log(pc.dim(' Press "q" to exit live monitoring | Refreshing automatically...'));
      if (lastError) console.log(pc.red(` Last error: ${lastError}`));
    } catch (err: any) {
      lastError = `${new Date().toLocaleTimeString()}  ${err.message}`;
      console.error(pc.red(`\nError polling live database: ${err.message}`));
      console.error(pc.dim(' Will retry automatically...'));
    }

    if (isRunning) {
      setTimeout(tick, intervalSeconds * 1000);
    }
  };

  await tick();
}
