import { StatStatementInfo } from '../types.js';

function parseCsvRow(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

function mapStatRow(item: Record<string, any>): StatStatementInfo {
  const calls = Number(item.calls || 0);
  const totalTime = Number(item.total_exec_time || item.total_time || 0);
  const meanTime = Number(item.mean_exec_time || (calls > 0 ? totalTime / calls : 0));
  const sharedHit = Number(item.shared_blks_hit || 0);
  const sharedRead = Number(item.shared_blks_read || 0);
  const totalBlocks = sharedHit + sharedRead;
  const cacheHitRatio = totalBlocks > 0 ? sharedHit / totalBlocks : 1;

  return {
    queryId: item.queryid || item.query_id ? String(item.queryid || item.query_id) : undefined,
    query: String(item.query || ''),
    calls,
    totalExecTimeMs: totalTime,
    meanExecTimeMs: meanTime,
    rows: Number(item.rows || 0),
    sharedBlksHit: sharedHit,
    sharedBlksRead: sharedRead,
    cacheHitRatio,
  };
}

export function parseStatStatements(content: string): StatStatementInfo[] {
  const trimmed = content.trim();

  // Try JSON first
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      return list.map((item: any) => mapStatRow(item));
    } catch {
      // fallback to CSV
    }
  }

  // Fallback: Parse CSV
  const lines = trimmed.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = parseCsvRow(lines[0]).map((h) => h.toLowerCase());
  const results: StatStatementInfo[] = [];

  for (let i = 1; i < lines.length; i++) {
    const row = parseCsvRow(lines[i]);
    const item: Record<string, string> = {};
    headers.forEach((h, idx) => {
      item[h] = (row[idx] || '').trim();
    });
    results.push(mapStatRow(item));
  }

  return results;
}
