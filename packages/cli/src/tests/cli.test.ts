import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { Readable } from 'node:stream';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createPgClientConfig, formatPgConnectionError, normalizeConnectionString } from '../pgCollector.js';
import { createLiveBridgeHandler } from '../liveServer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLI_BIN = path.resolve(__dirname, '../index.js');
const REPO_ROOT = path.resolve(__dirname, '../../../..');

test('normalizeConnectionString encodes special characters in passwords without double-encoding', () => {
  const raw = 'postgresql://postgres.ref:p@ss!#word$@aws-0-us-east-1.pooler.supabase.com:6543/postgres';
  const normalized = normalizeConnectionString(raw);
  assert.equal(
    normalized,
    'postgresql://postgres.ref:p%40ss!%23word%24@aws-0-us-east-1.pooler.supabase.com:6543/postgres'
  );
  // Idempotent on already-encoded passwords
  assert.equal(normalizeConnectionString(normalized), normalized);
});

test('createPgClientConfig disables SSL for localhost and enables SSL for remote Supabase hosts', () => {
  const localCfg = createPgClientConfig('postgresql://postgres:postgres@127.0.0.1:54322/postgres');
  assert.equal(localCfg.ssl, false);

  const remoteCfg = createPgClientConfig('postgresql://postgres.abc:pass@aws-0-us-east-1.pooler.supabase.com:6543/postgres');
  assert.deepEqual(remoteCfg.ssl, { rejectUnauthorized: false });

  const strictCfg = createPgClientConfig('postgresql://postgres.abc:pass@db.abc.supabase.co:5432/postgres?sslmode=verify-full');
  assert.deepEqual(strictCfg.ssl, { rejectUnauthorized: true });
});

test('formatPgConnectionError explains IPv6-only Supabase direct hosts on EHOSTUNREACH', () => {
  const err = Object.assign(
    new Error('connect EHOSTUNREACH 2406:da14:1d62:b400::1:5432 - Local (:::61417)'),
    { code: 'EHOSTUNREACH' }
  );
  const formatted = formatPgConnectionError(err, 'postgresql://postgres:secret@db.abc123.supabase.co:5432/postgres');
  assert.match(formatted.message, /IPv6-only/i);
  assert.match(formatted.message, /Supavisor Pooler/i);
});

test('CLI demo --format json outputs valid report with findings', () => {
  const res = spawnSync(process.execPath, [CLI_BIN, 'demo', '--format', 'json'], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
  });
  assert.equal(res.status, 0);
  const report = JSON.parse(res.stdout);
  assert.equal(report.source, 'demo');
  assert.ok(Array.isArray(report.findings));
  assert.ok(report.findings.length >= 10);
});

test('CLI analyze --fail-on critical exits non-zero on planted issues and zero on healthy baseline', () => {
  const failRes = spawnSync(
    process.execPath,
    [CLI_BIN, 'analyze', '--schema', 'testproject/supabase/migrations', '--fail-on', 'critical'],
    { cwd: REPO_ROOT, encoding: 'utf-8' }
  );
  assert.equal(failRes.status, 1);

  const passRes = spawnSync(
    process.execPath,
    [
      CLI_BIN,
      'analyze',
      '--schema',
      'testproject/supabase/migrations/20261113000000_baseline.sql',
      '--fail-on',
      'critical',
    ],
    { cwd: REPO_ROOT, encoding: 'utf-8' }
  );
  assert.equal(passRes.status, 0);
});

test('CLI rejects invalid --format and --fail-on values cleanly', () => {
  const badFmt = spawnSync(
    process.execPath,
    [CLI_BIN, 'analyze', '--schema', 'sample/schema_dump_broken.sql', '--format', 'xml'],
    { cwd: REPO_ROOT, encoding: 'utf-8' }
  );
  assert.equal(badFmt.status, 1);
  assert.ok(badFmt.stderr.includes('Unsupported format'));

  const badFailOn = spawnSync(
    process.execPath,
    [CLI_BIN, 'analyze', '--schema', 'sample/schema_dump_broken.sql', '--fail-on', 'blocker'],
    { cwd: REPO_ROOT, encoding: 'utf-8' }
  );
  assert.equal(badFailOn.status, 1);
  assert.ok(badFailOn.stderr.includes('Invalid --fail-on'));
});

test('CLI fix --dry-run emits CONCURRENTLY SQL', () => {
  const res = spawnSync(
    process.execPath,
    [CLI_BIN, 'fix', '--schema', 'sample/schema_dump_broken.sql', '--dry-run'],
    { cwd: REPO_ROOT, encoding: 'utf-8' }
  );
  assert.equal(res.status, 0);
  assert.ok(res.stdout.includes('CREATE INDEX CONCURRENTLY IF NOT EXISTS'));
});

async function invokeBridge(
  handler: ReturnType<typeof createLiveBridgeHandler>,
  opts: { method: string; url: string; headers?: Record<string, string>; body?: string }
): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  const req = Readable.from(opts.body ? [Buffer.from(opts.body, 'utf-8')] : []) as any;
  req.method = opts.method;
  req.url = opts.url;
  req.headers = { host: '127.0.0.1:3001', ...(opts.headers || {}) };

  const outHeaders: Record<string, string> = {};
  const chunks: Buffer[] = [];
  let statusCode = 200;

  return new Promise((resolve) => {
    const res: any = {
      setHeader(k: string, v: string) {
        outHeaders[k.toLowerCase()] = String(v);
      },
      writeHead(code: number, hdrs?: Record<string, string | number>) {
        statusCode = code;
        if (hdrs) {
          for (const [k, v] of Object.entries(hdrs)) {
            outHeaders[k.toLowerCase()] = String(v);
          }
        }
      },
      end(data?: string | Buffer) {
        if (data) chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
        resolve({ status: statusCode, headers: outHeaders, body: Buffer.concat(chunks).toString('utf-8') });
      },
    };
    handler(req, res);
  });
}

test('Live Bridge Server restricts CORS, blocks path traversal, and validates payloads', async () => {
  const handler = createLiveBridgeHandler({ port: 3001, host: '127.0.0.1', openBrowser: false });

  // 1. /api/status with allowed localhost Origin
  const statusRes = await invokeBridge(handler, {
    method: 'GET',
    url: '/api/status',
    headers: { origin: 'http://localhost:3000' },
  });
  assert.equal(statusRes.status, 200);
  assert.equal(statusRes.headers['access-control-allow-origin'], 'http://localhost:3000');
  const statusJson = JSON.parse(statusRes.body);
  assert.equal(statusJson.status, 'online');
  assert.equal(statusJson.hasActiveConnection, false);

  // 2. Non-localhost Origin must not receive ACAO header
  const evilCorsRes = await invokeBridge(handler, {
    method: 'GET',
    url: '/api/status',
    headers: { origin: 'https://evil.example.com' },
  });
  assert.equal(evilCorsRes.headers['access-control-allow-origin'], undefined);

  // 3. Path traversal must be rejected (both raw and URL-encoded)
  const traversalRes = await invokeBridge(handler, {
    method: 'GET',
    url: '/../../package.json',
  });
  assert.equal(traversalRes.status, 403);

  const encodedTraversalRes = await invokeBridge(handler, {
    method: 'GET',
    url: '/%2e%2e/%2e%2e/package.json',
  });
  assert.equal(encodedTraversalRes.status, 403);

  // 4. /api/connect without payload returns 400
  const connectRes = await invokeBridge(handler, {
    method: 'POST',
    url: '/api/connect',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(connectRes.status, 400);

  // 5. /api/terminate-session without active connection returns 400
  const termRes = await invokeBridge(handler, {
    method: 'POST',
    url: '/api/terminate-session',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pid: -1 }),
  });
  assert.equal(termRes.status, 400);
});

test('MCP server responds to initialize, tools/list, and tools/call over stdio', async () => {
  const proc = spawn(process.execPath, [CLI_BIN, 'mcp'], { cwd: REPO_ROOT });
  const lines: any[] = [];
  let buffer = '';

  proc.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf-8');
    let idx: number;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line) lines.push(JSON.parse(line));
    }
  });

  const send = (msg: any) => proc.stdin.write(JSON.stringify(msg) + '\n');
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  send({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'analyze_schema',
      arguments: { schemaSql: 'CREATE TABLE public.leak (id int PRIMARY KEY);' },
    },
  });

  await new Promise<void>((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error('MCP timeout')), 5000);
    const check = setInterval(() => {
      if (lines.length >= 3) {
        clearTimeout(deadline);
        clearInterval(check);
        resolve();
      }
    }, 50);
  });

  proc.kill();

  assert.equal(lines[0].result.serverInfo.name, 'sb-sniffer');
  assert.equal(lines[1].result.tools.length, 3);
  const report = JSON.parse(lines[2].result.content[0].text);
  assert.ok(report.findings.some((f: any) => f.id === 'RLS_DISABLED_OR_LOCKED_OUT'));
});
