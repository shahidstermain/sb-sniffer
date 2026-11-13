#!/usr/bin/env node

import { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import {
  analyzeSnapshot,
  BROKEN_SUPABASE_PROJECT_SNAPSHOT,
  formatFixAllSql,
  formatReportMarkdown,
  formatReportForAI,
  formatSafeMigrationSql,
  parseSchemaDump,
  parseStatStatements,
  parseStudioJson,
  scanAppCodeFiles,
  STUDIO_INTROSPECTION_SQL,
} from '@sb-sniffer/core';
import { collectLiveSnapshot } from './pgCollector.js';
import { renderTerminalReport } from './terminalRenderer.js';
import { runLinuxTui } from './linuxTui.js';
import { startLiveBridgeServer } from './liveServer.js';
import { runLiveWatchMode } from './liveWatch.js';
import { runInteractiveWelcomeScreen } from './welcomeScreen.js';
import { collectAppSourceFiles, loadSchemaFromPath } from './appScanner.js';
import { renderRlsPentestTerminal, runRlsPentest } from './rlsPentester.js';
import { renderExplainProofTerminal, runExplainProof } from './explainProver.js';
import { startMcpServer } from './mcpServer.js';

const VALID_FORMATS = new Set(['terminal', 'json', 'markdown', 'sql', 'ai', 'tui']);
const SEVERITY_LEVELS: Record<string, number> = { critical: 3, high: 2, medium: 1, info: 0 };

function failCli(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

const program = new Command();

program
  .name('sb-sniffer')
  .description('Supabase Diagnostic & Health Sniffer — Flags the top Supabase support bottlenecks')
  .version('1.0.0');

// Command: analyze
program
  .command('analyze')
  .description('Run health diagnostics on a live database, schema dump/migrations dir, studio export, or app codebase')
  .option('-d, --db <connectionString>', 'Live Postgres connection URI (e.g. postgresql://postgres:...@db.xxx.supabase.co:5432/postgres)')
  .option('-s, --schema <path>', 'Path to SQL schema dump or supabase/migrations directory')
  .option('-a, --app <dir>', 'Path to application codebase (.env, Next.js, Prisma, Drizzle) for Full-Stack App <-> DB correlation')
  .option('--stats <filePath>', 'Path to pg_stat_statements export (.json or .csv)')
  .option('--studio-json <filePath>', 'Path to Studio Introspection JSON dump')
  .option('-f, --format <format>', 'Output format: terminal, json, markdown, sql, ai, tui', 'terminal')
  .option('-o, --out <outputPath>', 'Write output to file instead of stdout')
  .option('--fail-on <severity>', 'CI exit gate: fail if any finding meets or exceeds severity (critical, high, medium, info)')
  .action(async (options) => {
    const format = String(options.format || 'terminal').toLowerCase();
    if (!VALID_FORMATS.has(format)) {
      failCli(`Unsupported format "${options.format}". Expected one of: ${Array.from(VALID_FORMATS).join(', ')}.`);
    }

    if (options.failOn && !(String(options.failOn).toLowerCase() in SEVERITY_LEVELS)) {
      failCli(`Invalid --fail-on threshold "${options.failOn}". Expected one of: critical, high, medium, info.`);
    }

    let snapshot;

    try {
      if (options.db) {
        console.log(`Connecting to database...`);
        snapshot = await collectLiveSnapshot({ connectionString: options.db });
      } else if (options.studioJson) {
        const content = fs.readFileSync(path.resolve(options.studioJson), 'utf-8');
        snapshot = parseStudioJson(content);
      } else if (options.schema) {
        const schemaSql = loadSchemaFromPath(options.schema);
        snapshot = parseSchemaDump(schemaSql);

        if (options.stats) {
          const statsContent = fs.readFileSync(path.resolve(options.stats), 'utf-8');
          snapshot.statStatements = parseStatStatements(statsContent);
        }
      } else if (options.app) {
        snapshot = {
          timestamp: new Date().toISOString(),
          projectName: path.basename(path.resolve(options.app)),
          source: 'schema_dump' as const,
          tables: [],
          policies: [],
          indexes: [],
          foreignKeys: [],
          triggers: [],
          extensions: [],
        };
      } else {
        failCli('Please specify --db, --schema, --studio-json, or --app (or run `sb-sniffer demo`).');
      }

      if (options.app) {
        const appFiles = collectAppSourceFiles(options.app);
        snapshot.appCode = scanAppCodeFiles(appFiles);
      }
    } catch (err: any) {
      failCli(err?.message || String(err));
    }

    const report = analyzeSnapshot(snapshot);

    if (format === 'tui') {
      runLinuxTui(report);
      return;
    }

    let output = '';
    if (format === 'json') {
      output = JSON.stringify(report, null, 2);
      if (options.out) fs.writeFileSync(options.out, output, 'utf-8');
      else console.log(output);
    } else if (format === 'markdown') {
      output = formatReportMarkdown(report);
      if (options.out) fs.writeFileSync(options.out, output, 'utf-8');
      else console.log(output);
    } else if (format === 'ai') {
      output = formatReportForAI(report, snapshot);
      if (options.out) fs.writeFileSync(options.out, output, 'utf-8');
      else console.log(output);
    } else if (format === 'sql') {
      output = formatFixAllSql(report.findings);
      if (options.out) fs.writeFileSync(options.out, output, 'utf-8');
      else console.log(output);
    } else {
      renderTerminalReport(report);
      if (options.out) {
        fs.writeFileSync(options.out, formatReportMarkdown(report), 'utf-8');
        console.log(`Report written to ${options.out}`);
      }
    }

    // CI fail-on gate check
    if (options.failOn) {
      const threshold = SEVERITY_LEVELS[String(options.failOn).toLowerCase()];
      const hasFailure = report.findings.some((f) => (SEVERITY_LEVELS[f.severity] ?? 0) >= threshold);

      if (hasFailure) {
        console.error(`\n❌ CI Gate Triggered: Found issues matching or exceeding severity threshold "${options.failOn}".`);
        process.exit(1);
      }
    }
  });

// Command: tui
program
  .command('tui')
  .description('Launch interactive Linux TUI (Vim navigation, split-screen inspector, tmux friendly)')
  .option('-s, --schema <path>', 'Path to schema dump or migrations directory')
  .action((options) => {
    try {
      let snapshot = BROKEN_SUPABASE_PROJECT_SNAPSHOT;
      if (options.schema) {
        const sql = loadSchemaFromPath(options.schema);
        snapshot = parseSchemaDump(sql);
      }
      const report = analyzeSnapshot(snapshot);
      runLinuxTui(report);
    } catch (err: any) {
      failCli(err?.message || String(err));
    }
  });

// Command: demo
program
  .command('demo')
  .description('Run diagnostics on the preloaded "Broken SaaS App" snapshot showcasing all 14 checks')
  .option('-f, --format <format>', 'Output format: terminal, json, markdown, sql, ai', 'terminal')
  .option('-o, --out <outputPath>', 'Write output to file')
  .action((options) => {
    const report = analyzeSnapshot(BROKEN_SUPABASE_PROJECT_SNAPSHOT);

    if (options.format === 'json') {
      const output = JSON.stringify(report, null, 2);
      if (options.out) fs.writeFileSync(options.out, output, 'utf-8');
      else console.log(output);
    } else if (options.format === 'markdown') {
      const output = formatReportMarkdown(report);
      if (options.out) fs.writeFileSync(options.out, output, 'utf-8');
      else console.log(output);
    } else if (options.format === 'ai') {
      const output = formatReportForAI(report, BROKEN_SUPABASE_PROJECT_SNAPSHOT);
      if (options.out) fs.writeFileSync(options.out, output, 'utf-8');
      else console.log(output);
    } else if (options.format === 'sql') {
      const output = formatFixAllSql(report.findings);
      if (options.out) fs.writeFileSync(options.out, output, 'utf-8');
      else console.log(output);
    } else {
      renderTerminalReport(report);
      if (options.out) {
        fs.writeFileSync(options.out, formatReportMarkdown(report), 'utf-8');
        console.log(`Demo report written to ${options.out}`);
      }
    }
  });

// Command: sql-query
program
  .command('sql-query')
  .description('Print the single read-only SQL query to copy-paste into Supabase Studio SQL editor')
  .action(() => {
    console.log(STUDIO_INTROSPECTION_SQL);
  });

// Command: watch
program
  .command('watch')
  .description('Live continuous terminal monitor (auto-refreshes diagnostics and active locks in real-time)')
  .requiredOption('-d, --db <connectionString>', 'Live Postgres connection URI')
  .option('-i, --interval <seconds>', 'Poll interval in seconds (default: 3s)', '3')
  .action(async (options) => {
    try {
      await runLiveWatchMode({
        connectionString: options.db,
        intervalSeconds: Number(options.interval) || 3,
      });
    } catch (err: any) {
      failCli(err?.message || String(err));
    }
  });

// Command: serve / web / gui
program
  .command('serve')
  .alias('web')
  .alias('gui')
  .description('Start the local Web GUI and live telemetry server')
  .option('-p, --port <port>', 'Port to listen on (default: 3001)', '3001')
  .option('--host <host>', 'Host address to bind (default: 127.0.0.1)', '127.0.0.1')
  .option('-d, --db <connectionString>', 'Initial live database connection URI')
  .option('-o, --open', 'Automatically open the Web GUI in default browser', true)
  .option('--no-open', 'Do not automatically open the browser')
  .action((options) => {
    startLiveBridgeServer({
      port: Number(options.port) || 3001,
      host: options.host || '127.0.0.1',
      initialDbUri: options.db,
      openBrowser: options.open !== false,
    });
  });

// Command: welcome
program
  .command('welcome')
  .description('Display the interactive TUI welcome screen and launch palette')
  .action(() => {
    runInteractiveWelcomeScreen();
  });

// Command: fix
program
  .command('fix')
  .description('Generate a production-safe Supabase migration file (using CONCURRENTLY) to remediate detected issues')
  .option('-s, --schema <path>', 'Path to SQL schema dump or supabase/migrations directory')
  .option('-d, --db <connectionString>', 'Live Postgres connection URI')
  .option('-a, --app <dir>', 'Optional application directory for App <-> DB index fixes')
  .option('--out-dir <dir>', 'Directory to write timestamped migration file', 'supabase/migrations')
  .option('--dry-run', 'Print the generated migration SQL to stdout without writing a file')
  .action(async (options) => {
    try {
      let snapshot;
      if (options.db) {
        snapshot = await collectLiveSnapshot({ connectionString: options.db });
      } else if (options.schema) {
        snapshot = parseSchemaDump(loadSchemaFromPath(options.schema));
      } else {
        failCli('Please specify --schema or --db.');
      }

      if (options.app) {
        snapshot.appCode = scanAppCodeFiles(collectAppSourceFiles(options.app));
      }

      const report = analyzeSnapshot(snapshot);
      const migrationSql = formatSafeMigrationSql(report.findings);

      if (options.dryRun) {
        console.log(migrationSql);
        return;
      }

      const ts = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
      const outDir = path.resolve(options.outDir);
      fs.mkdirSync(outDir, { recursive: true });
      const outFile = path.join(outDir, `${ts}_sb_sniffer_fixes.sql`);
      fs.writeFileSync(outFile, migrationSql, 'utf-8');
      console.log(`✅ Wrote production-safe remediation migration to ${outFile}`);
    } catch (err: any) {
      failCli(err?.message || String(err));
    }
  });

// Command: pentest
program
  .command('pentest')
  .description('Run a transaction-rolled-back RLS Red Team probe against all public tables')
  .requiredOption('-d, --db <connectionString>', 'Live Postgres connection URI')
  .option('-w, --writes', 'Also probe DELETE/write isolation inside rolled-back transactions', false)
  .option('-f, --format <format>', 'Output format: terminal, json', 'terminal')
  .action(async (options) => {
    try {
      const results = await runRlsPentest(options.db, !!options.writes);
      if (options.format === 'json') {
        console.log(JSON.stringify(results, null, 2));
      } else {
        renderRlsPentestTerminal(results);
      }
    } catch (err: any) {
      failCli(err?.message || String(err));
    }
  });

// Command: prove
program
  .command('prove')
  .description('Benchmark EXPLAIN (ANALYZE, BUFFERS) before/after candidate fixes inside a rolled-back transaction (staging recommended)')
  .requiredOption('-d, --db <connectionString>', 'Live Postgres connection URI')
  .option('-l, --limit <count>', 'Maximum slow queries to benchmark', '5')
  .option('-f, --format <format>', 'Output format: terminal, json', 'terminal')
  .action(async (options) => {
    try {
      const proofs = await runExplainProof(options.db, Number(options.limit) || 5);
      if (options.format === 'json') {
        console.log(JSON.stringify(proofs, null, 2));
      } else {
        renderExplainProofTerminal(proofs);
      }
    } catch (err: any) {
      failCli(err?.message || String(err));
    }
  });

// Command: mcp
program
  .command('mcp')
  .description('Start a Model Context Protocol (MCP) server over stdio for AI coding agents')
  .action(() => {
    startMcpServer();
  });

if (process.argv.length <= 2) {
  runInteractiveWelcomeScreen();
} else {
  program.parse(process.argv);
}
