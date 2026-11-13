import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { collectLiveSnapshot, createPgClientConfig } from './pgCollector.js';
import { analyzeSnapshot, matchSupportIssue } from '@sb-sniffer/core';
import pg from 'pg';

const MAX_BODY_BYTES = 1024 * 1024; // 1 MB cap on JSON request bodies
const LOCAL_ORIGIN_REGEX = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

export function openBrowserUrl(url: string): void {
  if (process.platform === 'darwin') {
    execFile('open', [url], () => {});
  } else if (process.platform === 'win32') {
    execFile('cmd', ['/c', 'start', '', url], () => {});
  } else {
    execFile('xdg-open', [url], () => {});
  }
}

function readJsonBody(req: http.IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        req.destroy();
        reject(new Error('Request body too large.'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8').trim();
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Invalid JSON payload.'));
      }
    });
    req.on('error', (err) => reject(err));
  });
}


const LOG_SOURCES: Array<{ table: string; service: 'postgres' | 'auth' | 'pooler' | 'storage' | 'api' }> = [
  { table: 'postgres_logs', service: 'postgres' },
  { table: 'auth_logs', service: 'auth' },
  { table: 'edge_logs', service: 'api' },
  { table: 'supavisor_logs', service: 'pooler' },
];

function resolveProjectRef(dbUri: string | null): string | null {
  if (process.env.SUPABASE_PROJECT_REF) return process.env.SUPABASE_PROJECT_REF;
  try {
    const f = path.join(process.cwd(), 'supabase', '.temp', 'project-ref');
    if (fs.existsSync(f)) return fs.readFileSync(f, 'utf-8').trim();
  } catch {
    /* ignore */
  }
  if (dbUri) {
    const m = dbUri.match(/db\.([a-z0-9]{20})\.supabase\.co/) || dbUri.match(/postgres\.([a-z0-9]{20})[:@]/);
    if (m) return m[1];
  }
  return null;
}

function inferLevel(msg: string, sev?: string): 'fatal' | 'error' | 'warning' | 'info' | 'debug' {
  const s = (sev || '').toLowerCase();
  if (s === 'fatal' || s === 'panic') return 'fatal';
  if (s === 'error') return 'error';
  if (s === 'warning') return 'warning';
  if (s === 'debug') return 'debug';
  if (/\b(fatal|panic)\b/i.test(msg)) return 'fatal';
  if (/\berror\b|failed|violates/i.test(msg)) return 'error';
  if (/\bwarn/i.test(msg)) return 'warning';
  return s ? 'info' : 'info';
}

/** Fetches real logs from the Supabase Management API (token stays server-side). */
async function fetchRealLogs(dbUri: string | null): Promise<{ logs: any[]; error?: string }> {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = resolveProjectRef(dbUri);
  if (!token) return { logs: [], error: 'SUPABASE_ACCESS_TOKEN is not set on the bridge server (create one at supabase.com/dashboard/account/tokens).' };
  if (!ref) return { logs: [], error: 'Could not determine project ref (set SUPABASE_PROJECT_REF).' };

  const end = new Date();
  const start = new Date(end.getTime() - 60 * 60 * 1000);
  const results = await Promise.all(
    LOG_SOURCES.map(async ({ table, service }) => {
      const sql = `select id, timestamp, event_message from ${table} order by timestamp desc limit 50`;
      const qs = new URLSearchParams({ sql, iso_timestamp_start: start.toISOString(), iso_timestamp_end: end.toISOString() });
      const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/analytics/endpoints/logs.all?${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) throw new Error(`${table}: HTTP ${r.status}`);
      const body: any = await r.json();
      if (body.error) throw new Error(`${table}: ${typeof body.error === 'string' ? body.error : body.error.message || 'query error'}`);
      return (body.result || []).map((row: any) => {
        const message = String(row.event_message ?? '');
        const ts = typeof row.timestamp === 'number' ? new Date(row.timestamp / 1000).toISOString() : String(row.timestamp);
        return {
          id: `live-${table}-${row.id}`,
          timestamp: ts,
          service,
          level: inferLevel(message),
          message,
          matchedCheckId: matchSupportIssue(message),
        };
      });
    })
  );
  const logs = results.flat().sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return { logs };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WEB_DIST_PATH = path.resolve(__dirname, '../../web/dist');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

function serveStaticFile(reqPath: string, res: http.ServerResponse): boolean {
  if (!fs.existsSync(WEB_DIST_PATH)) {
    return false;
  }

  let cleanPath = reqPath.split('?')[0];
  try {
    cleanPath = decodeURIComponent(cleanPath);
  } catch {
    return false;
  }

  const relativePath = cleanPath === '/' ? 'index.html' : cleanPath.replace(/^\/+/, '');
  const webRootWithSep = WEB_DIST_PATH.endsWith(path.sep) ? WEB_DIST_PATH : `${WEB_DIST_PATH}${path.sep}`;
  let filePath = path.resolve(WEB_DIST_PATH, relativePath);

  // Prevent path traversal outside WEB_DIST_PATH
  if (filePath !== WEB_DIST_PATH && !filePath.startsWith(webRootWithSep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return true;
  }

  // If path has no extension or is a directory, fallback to index.html (SPA client routing)
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(WEB_DIST_PATH, 'index.html');
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    const content = fs.readFileSync(filePath);
    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': content.length,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'max-age=31536000, immutable',
    });
    res.end(content);
    return true;
  }

  return false;
}

export interface LiveServerOptions {
  port?: number;
  host?: string;
  initialDbUri?: string;
  openBrowser?: boolean;
}

export function createLiveBridgeHandler(options: LiveServerOptions = {}): http.RequestListener {
  const port = options.port ?? 3001;
  const host = options.host || '127.0.0.1';
  let activeDbUri: string | null = options.initialDbUri || null;

  return async (req, res) => {
    // Restrict CORS to local browser origins (never wildcard *)
    const requestOrigin = req.headers.origin;
    if (requestOrigin && LOCAL_ORIGIN_REGEX.test(requestOrigin)) {
      res.setHeader('Access-Control-Allow-Origin', requestOrigin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const rawUrlPath = (req.url || '/').split('?')[0];
    if (/(^|[\\/])\.\.([\\/]|$)/i.test(rawUrlPath) || /%2e%2e/i.test(rawUrlPath)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host || `${host}:${port}`}`);

    // Route: real logs via Supabase Management API
    if (url.pathname === '/api/logs' && req.method === 'GET') {
      try {
        const out = await fetchRealLogs(activeDbUri);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(out));
      } catch (e: any) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ logs: [], error: e.message }));
      }
      return;
    }

    // Route 1: Status
    if (url.pathname === '/api/status' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'online',
          hasActiveConnection: !!activeDbUri,
          maskedUri: activeDbUri ? activeDbUri.replace(/:[^:@]+@/, ':****@') : null,
        })
      );
      return;
    }

    // Route 2: Connect (accepts connection string or project ref + password)
    if (url.pathname === '/api/connect' && req.method === 'POST') {
      try {
        const payload = await readJsonBody(req);
        let connectionString = payload.connectionString;

        // If user provided projectRef + password + region
        if (!connectionString && payload.projectRef && payload.password) {
          const mode = payload.mode || 'pooler'; // pooler (6543) or direct (5432)
          let formattedRegion = String(payload.region || 'aws-0-us-east-1').trim();
          if (!formattedRegion.startsWith('aws-0-') && !formattedRegion.startsWith('aws-1-') && !formattedRegion.includes('.')) {
            formattedRegion = `aws-0-${formattedRegion}`;
          }
          const encodedPassword = encodeURIComponent(String(payload.password));
          const cleanRef = String(payload.projectRef).trim();

          if (mode === 'pooler') {
            connectionString = `postgresql://postgres.${cleanRef}:${encodedPassword}@${formattedRegion}.pooler.supabase.com:6543/postgres`;
          } else {
            connectionString = `postgresql://postgres:${encodedPassword}@db.${cleanRef}.supabase.co:5432/postgres`;
          }
        }

        if (!connectionString) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing connectionString or projectRef + password.' }));
          return;
        }

        // Test connection
        const snapshot = await collectLiveSnapshot({
          connectionString,
          timeoutMs: 8000,
        });

        // Store as active connection
        activeDbUri = connectionString;
        const report = analyzeSnapshot(snapshot);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: true,
            message: 'Connected to live Supabase instance successfully!',
            snapshot,
            report,
          })
        );
      } catch (err: any) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: false,
            error: err.message || 'Failed to connect to database.',
          })
        );
      }
      return;
    }

    // Route 3: Live Snapshot Poll
    if (url.pathname === '/api/snapshot' && req.method === 'GET') {
      if (!activeDbUri) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No active database connected yet. Call /api/connect first.' }));
        return;
      }

      try {
        const snapshot = await collectLiveSnapshot({
          connectionString: activeDbUri,
          timeoutMs: 8000,
        });
        const report = analyzeSnapshot(snapshot);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ snapshot, report }));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // Route 4: Realtime Server-Sent Events (SSE) Stream
    if (url.pathname === '/api/stream' && req.method === 'GET') {
      if (!activeDbUri) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No active connection. Connect first.' }));
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      res.write(`data: ${JSON.stringify({ type: 'connected', time: new Date() })}\n\n`);

      const intervalSeconds = Math.max(2, Number(url.searchParams.get('interval') || 3));
      const timer = setInterval(async () => {
        if (!activeDbUri) return;
        try {
          const snapshot = await collectLiveSnapshot({
            connectionString: activeDbUri,
            timeoutMs: 6000,
          });
          const report = analyzeSnapshot(snapshot);
          res.write(`data: ${JSON.stringify({ type: 'snapshot', snapshot, report })}\n\n`);
        } catch (err: any) {
          res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
        }
      }, intervalSeconds * 1000);

      req.on('close', () => {
        clearInterval(timer);
      });
      return;
    }

    // Route 5: Kill blocking connection
    if (url.pathname === '/api/terminate-session' && req.method === 'POST') {
      if (!activeDbUri) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No active connection.' }));
        return;
      }

      try {
        const { pid } = await readJsonBody(req);
        const numericPid = typeof pid === 'number' ? pid : Number(pid);
        if (!Number.isInteger(numericPid) || numericPid <= 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid pid: expected a positive integer.' }));
          return;
        }

        const client = new pg.Client(createPgClientConfig(activeDbUri, 5000));
        try {
          await client.connect();
          await client.query('SELECT pg_terminate_backend($1);', [numericPid]);
        } finally {
          await client.end().catch(() => {});
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, terminatedPid: numericPid }));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // Route 6: Disconnect
    if (url.pathname === '/api/disconnect' && req.method === 'POST') {
      activeDbUri = null;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: 'Disconnected.' }));
      return;
    }

    // Static Web App Serving for browser clients (handles /, /assets/*, and SPA routes)
    if (!url.pathname.startsWith('/api')) {
      const served = serveStaticFile(url.pathname, res);
      if (served) return;

      // Clean HTML fallback if web/dist was not built yet
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Supabase Sniffer Live Bridge</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f1012; color: #f1f5f9; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; }
    .card { background: #17181c; border: 1px solid #2b2f38; border-radius: 20px; padding: 36px; max-width: 540px; box-shadow: 0 24px 48px rgba(0,0,0,0.6); }
    h1 { color: #3ecf8e; margin: 0 0 12px 0; font-size: 22px; display: flex; align-items: center; gap: 10px; }
    p { font-size: 14px; line-height: 1.6; color: #94a3b8; margin: 8px 0; }
    code { background: #0a0b0d; padding: 3px 8px; border-radius: 6px; color: #38bdf8; font-family: monospace; font-size: 13px; border: 1px solid #1e2229; }
    .endpoints { background: #0a0b0d; border-radius: 12px; padding: 14px; margin: 16px 0; border: 1px solid #1e2229; font-size: 12px; font-family: monospace; color: #cbd5e1; }
    .status-badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 9999px; font-size: 11px; font-weight: 700; background: rgba(62, 207, 142, 0.15); color: #3ecf8e; border: 1px solid rgba(62, 207, 142, 0.3); }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #3ecf8e; animation: pulse 2s infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
  </style>
</head>
<body>
  <div class="card">
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 16px;">
      <h1>🔌 Supabase Sniffer Bridge</h1>
      <span class="status-badge"><span class="dot"></span> ONLINE</span>
    </div>
    <p>The companion bridge server is running and actively listening on port <code>:${port}</code>.</p>
    <div class="endpoints">
      <div>GET  /api/status            → Server status</div>
      <div>POST /api/connect           → Connect to Supabase instance</div>
      <div>GET  /api/snapshot          → Real-time telemetry dump</div>
      <div>GET  /api/stream            → Server-Sent Events stream</div>
    </div>
    <p>To launch the full interactive web application, run <code>npm run build</code> in the project root, then reload this page or visit <code>http://localhost:3000</code>.</p>
  </div>
</body>
</html>`);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: 'API endpoint not found.',
        availableEndpoints: [
          'GET /api/status',
          'POST /api/connect',
          'GET /api/snapshot',
          'GET /api/logs',
          'GET /api/stream',
          'POST /api/terminate-session',
          'POST /api/disconnect',
        ],
      })
    );
  };
}

export function startLiveBridgeServer(options: LiveServerOptions = {}): http.Server {
  const port = options.port ?? 3001;
  const host = options.host || '127.0.0.1';
  const server = http.createServer(createLiveBridgeHandler(options));

  server.listen(port, host, () => {
    const addr = server.address();
    const actualPort = typeof addr === 'object' && addr ? addr.port : port;
    console.log(`🔌 Supabase Sniffer Web Server running on http://${host}:${actualPort}`);
    console.log(`🖥️  Open in your browser: http://${host}:${actualPort} (Web UI & Telemetry API)`);
    if (options.openBrowser) {
      openBrowserUrl(`http://${host}:${actualPort}`);
    }
  });

  return server;
}
