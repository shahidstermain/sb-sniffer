import readline from 'node:readline';
import os from 'node:os';
import pc from 'picocolors';
import {
  analyzeSnapshot,
  BROKEN_SUPABASE_PROJECT_SNAPSHOT,
  STUDIO_INTROSPECTION_SQL,
} from '@sb-sniffer/core';
import { renderTerminalReport } from './terminalRenderer.js';
import { runLinuxTui } from './linuxTui.js';
import { startLiveBridgeServer } from './liveServer.js';

export function renderWelcomeBanner(): void {
  // Clear screen and reset cursor
  process.stdout.write('\x1b[2J\x1b[3J\x1b[H');

  const banner = `
${pc.green('  ███████╗██████╗     ███████╗███╗   ██╗██╗███████╗███████╗███████╗██████╗ ')}
${pc.green('  ██╔════╝██╔══██╗    ██╔════╝████╗  ██║██║██╔════╝██╔════╝██╔════╝██╔══██╗')}
${pc.cyan('  ███████╗██████╔╝    ███████╗██╔██╗ ██║██║█████╗  █████╗  █████╗  ██████╔╝')}
${pc.cyan('  ╚════██║██╔══██╗    ╚════██║██║╚██╗██║██║██╔══╝  ██╔══╝  ██╔══╝  ██╔══██╗')}
${pc.cyan('  ███████║██████╔╝    ███████║██║ ╚████║██║██║     ██║     ███████╗██║  ██║')}
${pc.dim('  ╚══════╝╚═════╝     ╚══════╝╚═╝  ╚═══╝╚═╝╚═╝     ╚═╝     ╚══════╝╚═╝  ╚═╝')}
`;

  console.log(banner);

  // Subtitle & Metadata Header
  console.log(
    `  ${pc.bgGreen(pc.black(pc.bold(' SUPABASE DIAGNOSTIC & HEALTH ENGINE ')))} ${pc.dim('──')} ${pc.bold(
      'v1.0.0'
    )} ${pc.dim(`[Node ${process.version} // ${os.platform()}-${os.arch()}]`)}`
  );
  console.log(
    pc.dim('  The open-source diagnostic sniffer built for Supabase Support Engineers.\n')
  );

  // Target Hotspot Tags
  console.log(
    pc.dim('  🎯 Checks: ') +
      pc.green('RLS initPlan') +
      pc.dim(' • ') +
      pc.yellow('Supavisor 6543') +
      pc.dim(' • ') +
      pc.red('GoTrue Triggers') +
      pc.dim(' • ') +
      pc.cyan('Storage RLS') +
      pc.dim(' • ') +
      pc.magenta('Realtime WAL') +
      pc.dim(' • ') +
      pc.blue('pg_stat_statements')
  );
  console.log(pc.dim('  ─────────────────────────────────────────────────────────────────────────────'));
  console.log(pc.bold('\n  ⚡ QUICK LAUNCH PALETTE:\n'));

  console.log(`    ${pc.green(pc.bold('[1]'))} ${pc.bold('Run Demo Analysis')}           ${pc.dim('Analyze broken SaaS project across all 14 diagnostic checks')}`);
  console.log(`    ${pc.cyan(pc.bold('[2]'))} ${pc.bold('Interactive Terminal TUI')}    ${pc.dim('Vim-driven dual-column keyboard terminal explorer')}`);
  console.log(`    ${pc.yellow(pc.bold('[3]'))} ${pc.bold('Copy Studio SQL Query')}        ${pc.dim('Single read-only CTE to run in Supabase Studio SQL editor')}`);
  console.log(`    ${pc.magenta(pc.bold('[4]'))} ${pc.bold('Start Web GUI Server')}        ${pc.dim('Launch HTTP Web GUI on :3001 & open browser')}`);
  console.log(`    ${pc.blue(pc.bold('[5]'))} ${pc.bold('Show CLI Syntax & Flags')}     ${pc.dim('Inspect flags for live DB, schema dumps, and CI/CD gates')}`);
  console.log(`    ${pc.dim(pc.bold('[0]'))} ${pc.dim('Exit')}`);

  console.log(pc.dim('\n  ─────────────────────────────────────────────────────────────────────────────'));
}

/**
 * Runs the interactive welcome screen if stdin is a TTY.
 * Allows instant 1-key action execution.
 */
export function runInteractiveWelcomeScreen(): void {
  renderWelcomeBanner();

  if (!process.stdin.isTTY) {
    return;
  }

  console.log(pc.cyan('  Press a key [1-5, or 0 to exit] to launch:'));

  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();

  const handleKeypress = (str: string, key: readline.Key) => {
    // Exit conditions: 0, q, escape, Ctrl+C
    if (str === '0' || str === 'q' || str === 'x' || (key.ctrl && key.name === 'c') || key.name === 'escape') {
      cleanup();
      console.log(pc.dim('\n  Goodbye! 👋\n'));
      process.exit(0);
    }

    // Option 1: Demo
    if (str === '1' || str === 'd') {
      cleanup();
      const report = analyzeSnapshot(BROKEN_SUPABASE_PROJECT_SNAPSHOT);
      renderTerminalReport(report);
      process.exit(0);
    }

    // Option 2: Linux TUI
    if (str === '2' || str === 't') {
      cleanup();
      const report = analyzeSnapshot(BROKEN_SUPABASE_PROJECT_SNAPSHOT);
      runLinuxTui(report);
      return;
    }

    // Option 3: Studio SQL
    if (str === '3' || str === 's') {
      cleanup();
      console.log(pc.bold('\n-- 🐘 COPY-PASTE INTO SUPABASE STUDIO SQL EDITOR:\n'));
      console.log(STUDIO_INTROSPECTION_SQL);
      console.log(pc.dim('\nRun this query in Supabase Studio, download JSON results, then analyze with:'));
      console.log(pc.green('  sb-sniffer analyze --studio-json ./studio_export.json\n'));
      process.exit(0);
    }

    // Option 4: Web GUI Server
    if (str === '4' || str === 'b' || str === 'w' || str === 'g') {
      cleanup();
      console.log(pc.cyan('\nStarting Supabase Sniffer Web GUI server on port 3001...'));
      startLiveBridgeServer({ port: 3001, openBrowser: true });
      return;
    }

    // Option 5: Help & Syntax
    if (str === '5' || str === 'h' || str === '?') {
      cleanup();
      console.log(pc.bold('\n📖 SUPABASE SNIFFER CLI MANUAL & EXAMPLES:\n'));
      console.log(pc.cyan('  1. Analyze Live Supabase Project:'));
      console.log(pc.dim('     sb-sniffer analyze --db "postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres"\n'));
      console.log(pc.cyan('  2. Analyze Offline Schema Dump:'));
      console.log(pc.dim('     sb-sniffer analyze --schema ./schema.sql --stats ./pg_stat_statements.json\n'));
      console.log(pc.cyan('  3. Interactive Linux TUI:'));
      console.log(pc.dim('     sb-sniffer tui\n'));
      console.log(pc.cyan('  4. Continuous Realtime Monitor:'));
      console.log(pc.dim('     sb-sniffer watch --db "<connection-uri>" --interval 3\n'));
      console.log(pc.cyan('  5. CI/CD Quality Gate:'));
      console.log(pc.dim('     sb-sniffer analyze --schema ./schema.sql --fail-on critical\n'));
      console.log(pc.cyan('  6. Export Consolidated SQL Fixes:'));
      console.log(pc.dim('     sb-sniffer demo --format sql --out ./fix_all.sql\n'));
      process.exit(0);
    }
  };

  const cleanup = () => {
    process.stdin.removeListener('keypress', handleKeypress);
    try {
      process.stdin.setRawMode(false);
    } catch {
      // ignore
    }
  };

  process.stdin.on('keypress', handleKeypress);
}
