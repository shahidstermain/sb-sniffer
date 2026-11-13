import readline from 'node:readline';
import {
  analyzeSnapshot,
  formatFixAllSql,
  formatSafeMigrationSql,
  parseSchemaDump,
  scanAppCodeFiles,
} from '@sb-sniffer/core';
import { collectAppSourceFiles, loadSchemaFromPath } from './appScanner.js';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: any;
}

const TOOLS = [
  {
    name: 'analyze_schema',
    description:
      'Analyze a Supabase/Postgres SQL schema string or migration directory for all 14 Supabase security, RLS, pooler, Splinter parity, and performance checks.',
    inputSchema: {
      type: 'object',
      properties: {
        schemaSql: { type: 'string', description: 'Raw SQL schema or migration content' },
        schemaPath: { type: 'string', description: 'Path to a .sql file or supabase/migrations directory' },
      },
    },
  },
  {
    name: 'audit_app_code',
    description:
      'Scan a Next.js/TypeScript/Prisma/Drizzle application directory for service_role leaks, Supavisor :6543 pooler misconfigs, insecure auth.getSession() usage, and unindexed PostgREST queries.',
    inputSchema: {
      type: 'object',
      properties: {
        appDir: { type: 'string', description: 'Path to the application root directory' },
        schemaPath: { type: 'string', description: 'Optional path to SQL schema/migrations for App <-> DB index correlation' },
      },
      required: ['appDir'],
    },
  },
  {
    name: 'generate_fix_sql',
    description:
      'Generate production-safe remediation SQL (using CREATE INDEX CONCURRENTLY IF NOT EXISTS) for a given SQL schema.',
    inputSchema: {
      type: 'object',
      properties: {
        schemaSql: { type: 'string', description: 'Raw SQL schema content' },
        schemaPath: { type: 'string', description: 'Path to .sql file or migrations directory' },
      },
    },
  },
];

function writeResponse(res: any) {
  process.stdout.write(JSON.stringify(res) + '\n');
}

/**
 * Starts a zero-dependency Model Context Protocol (MCP) server over stdio.
 */
export function startMcpServer(): void {
  const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let req: JsonRpcRequest;
    try {
      req = JSON.parse(trimmed);
    } catch {
      return;
    }

    if (req.method === 'initialize') {
      writeResponse({
        jsonrpc: '2.0',
        id: req.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'sb-sniffer', version: '1.0.0' },
        },
      });
      return;
    }

    if (req.method === 'notifications/initialized') {
      return;
    }

    if (req.method === 'tools/list') {
      writeResponse({
        jsonrpc: '2.0',
        id: req.id,
        result: { tools: TOOLS },
      });
      return;
    }

    if (req.method === 'tools/call') {
      const toolName = req.params?.name;
      const args = req.params?.arguments || {};

      try {
        let textResult = '';

        if (toolName === 'analyze_schema') {
          const sql = args.schemaSql || (args.schemaPath ? loadSchemaFromPath(args.schemaPath) : '');
          if (!sql) throw new Error('Provide either schemaSql or schemaPath');
          const snapshot = parseSchemaDump(sql);
          const report = analyzeSnapshot(snapshot);
          textResult = JSON.stringify(report, null, 2);
        } else if (toolName === 'audit_app_code') {
          const sql = args.schemaPath ? loadSchemaFromPath(args.schemaPath) : '';
          const snapshot = sql
            ? parseSchemaDump(sql)
            : {
                timestamp: new Date().toISOString(),
                source: 'schema_dump' as const,
                tables: [],
                policies: [],
                indexes: [],
                foreignKeys: [],
                triggers: [],
                extensions: [],
              };
          const files = collectAppSourceFiles(args.appDir);
          snapshot.appCode = scanAppCodeFiles(files);
          const report = analyzeSnapshot(snapshot);
          textResult = JSON.stringify(report, null, 2);
        } else if (toolName === 'generate_fix_sql') {
          const sql = args.schemaSql || (args.schemaPath ? loadSchemaFromPath(args.schemaPath) : '');
          if (!sql) throw new Error('Provide either schemaSql or schemaPath');
          const snapshot = parseSchemaDump(sql);
          const report = analyzeSnapshot(snapshot);
          textResult = formatSafeMigrationSql(report.findings) || formatFixAllSql(report.findings);
        } else {
          throw new Error(`Unknown tool: ${toolName}`);
        }

        writeResponse({
          jsonrpc: '2.0',
          id: req.id,
          result: {
            content: [{ type: 'text', text: textResult }],
          },
        });
      } catch (err: any) {
        writeResponse({
          jsonrpc: '2.0',
          id: req.id,
          result: {
            isError: true,
            content: [{ type: 'text', text: err?.message || String(err) }],
          },
        });
      }
      return;
    }

    if (req.id !== undefined) {
      writeResponse({
        jsonrpc: '2.0',
        id: req.id,
        error: { code: -32601, message: `Method not found: ${req.method}` },
      });
    }
  });
}
