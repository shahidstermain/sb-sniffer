import React, { useState } from 'react';
import {
  DiagnosticSnapshot,
  StatActivityInfo,
  StatStatementInfo,
  StatTableInfo,
  StatUserIndexInfo,
} from '@sb-sniffer/core';
import {
  Activity,
  Flame,
  Database,
  Layers,
  Search,
  Copy,
  Check,
  AlertTriangle,
  Clock,
  HardDrive,
  Cpu,
  Terminal,
  ShieldAlert,
} from 'lucide-react';

interface Props {
  snapshot: DiagnosticSnapshot;
  onOpenStudioModal: () => void;
}

export const PostgresDiagnosticsView: React.FC<Props> = ({ snapshot, onOpenStudioModal }) => {
  const [activeSubTab, setActiveSubTab] = useState<'statements' | 'activity' | 'tables' | 'indexes'>('statements');
  const [statementFilter, setStatementFilter] = useState('');
  const [sortBy, setSortBy] = useState<'mean' | 'total' | 'calls' | 'cache'>('mean');
  const [copiedQuery, setCopiedQuery] = useState<string | null>(null);

  const statements: StatStatementInfo[] = snapshot.statStatements || [];
  const activities: StatActivityInfo[] = snapshot.statActivity || [];
  const tables: StatTableInfo[] = snapshot.statTables || [];
  const indexes: StatUserIndexInfo[] = snapshot.statUserIndexes || [];

  // Sort statements
  const sortedStatements = [...statements].sort((a, b) => {
    if (sortBy === 'mean') return b.meanExecTimeMs - a.meanExecTimeMs;
    if (sortBy === 'total') return b.totalExecTimeMs - a.totalExecTimeMs;
    if (sortBy === 'calls') return b.calls - a.calls;
    if (sortBy === 'cache') return (a.cacheHitRatio || 0) - (b.cacheHitRatio || 0);
    return 0;
  }).filter((s) => s.query.toLowerCase().includes(statementFilter.toLowerCase()));

  const handleCopyExplain = (query: string) => {
    const clean = query.trim().replace(/;$/, '');
    const explainSql = `EXPLAIN (ANALYZE, BUFFERS, TIMING, VERBOSE)\n${clean};`;
    navigator.clipboard.writeText(explainSql);
    setCopiedQuery(query);
    setTimeout(() => setCopiedQuery(null), 2000);
  };

  const handleCopyTerminate = (pid: number) => {
    const sql = `SELECT pg_terminate_backend(${pid});`;
    navigator.clipboard.writeText(sql);
    setCopiedQuery(String(pid));
    setTimeout(() => setCopiedQuery(null), 2000);
  };

  const handleCopyDropIndex = (schema: string, indexName: string) => {
    const sql = `DROP INDEX CONCURRENTLY IF EXISTS "${schema}"."${indexName}";`;
    navigator.clipboard.writeText(sql);
    setCopiedQuery(indexName);
    setTimeout(() => setCopiedQuery(null), 2000);
  };

  const formatBytes = (bytes?: number) => {
    if (!bytes) return '0 B';
    const mb = bytes / (1024 * 1024);
    if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
    return `${mb.toFixed(1)} MB`;
  };

  return (
    <div className="bg-[#18181b] border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl flex flex-col font-sans">
      {/* Top Header & Sub-tab Bar */}
      <div className="bg-[#1e1e22] px-6 py-4 border-b border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-zinc-100 flex items-center gap-2">
            <Database className="w-5 h-5 text-cyan-400" />
            PostgreSQL Diagnostic View & Telemetry Explorer
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Deep dive into live Postgres internal stats: <code className="text-zinc-300 font-mono">pg_stat_statements</code>, <code className="text-zinc-300 font-mono">pg_stat_activity</code>, and table bloat.
          </p>
        </div>

        {/* View Switcher Pills */}
        <div className="flex bg-[#121214] p-1 rounded-xl border border-zinc-700/60 text-xs font-semibold shrink-0">
          <button
            onClick={() => setActiveSubTab('statements')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition ${
              activeSubTab === 'statements'
                ? 'bg-cyan-500 text-black shadow-md'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Flame className="w-3.5 h-3.5" />
            <span>Statements ({statements.length})</span>
          </button>
          <button
            onClick={() => setActiveSubTab('activity')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition ${
              activeSubTab === 'activity'
                ? 'bg-cyan-500 text-black shadow-md'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Activity ({activities.length})</span>
          </button>
          <button
            onClick={() => setActiveSubTab('tables')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition ${
              activeSubTab === 'tables'
                ? 'bg-cyan-500 text-black shadow-md'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Table Bloat ({tables.length})</span>
          </button>
          <button
            onClick={() => setActiveSubTab('indexes')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition ${
              activeSubTab === 'indexes'
                ? 'bg-cyan-500 text-black shadow-md'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <HardDrive className="w-3.5 h-3.5" />
            <span>Index Usage ({indexes.length})</span>
          </button>
        </div>
      </div>

      {/* Main View Area */}
      <div className="p-6">
        {/* ========================================================= */}
        {/* TAB 1: pg_stat_statements                                 */}
        {/* ========================================================= */}
        {activeSubTab === 'statements' && (
          <div className="space-y-4">
            {/* Search and Sort Toolbar */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-[#131315] p-3 rounded-xl border border-zinc-800">
              <div className="relative w-full sm:w-80">
                <Search className="w-4 h-4 absolute left-3 top-2.5 text-zinc-500" />
                <input
                  type="text"
                  value={statementFilter}
                  onChange={(e) => setStatementFilter(e.target.value)}
                  placeholder="Filter queries by keyword (e.g. invoices, SELECT)..."
                  className="w-full bg-[#18181b] border border-zinc-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="flex items-center gap-2 text-xs text-zinc-400 w-full sm:w-auto">
                <span>Sort by:</span>
                <button
                  onClick={() => setSortBy('mean')}
                  className={`px-2.5 py-1 rounded-md transition ${
                    sortBy === 'mean' ? 'bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/40' : 'bg-zinc-800 text-zinc-400'
                  }`}
                >
                  Mean Latency
                </button>
                <button
                  onClick={() => setSortBy('total')}
                  className={`px-2.5 py-1 rounded-md transition ${
                    sortBy === 'total' ? 'bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/40' : 'bg-zinc-800 text-zinc-400'
                  }`}
                >
                  Total Time
                </button>
                <button
                  onClick={() => setSortBy('calls')}
                  className={`px-2.5 py-1 rounded-md transition ${
                    sortBy === 'calls' ? 'bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/40' : 'bg-zinc-800 text-zinc-400'
                  }`}
                >
                  Call Count
                </button>
                <button
                  onClick={() => setSortBy('cache')}
                  className={`px-2.5 py-1 rounded-md transition ${
                    sortBy === 'cache' ? 'bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/40' : 'bg-zinc-800 text-zinc-400'
                  }`}
                >
                  Cache Misses
                </button>
              </div>
            </div>

            {/* Statements List */}
            {sortedStatements.length === 0 ? (
              <div className="text-center py-12 bg-[#141416] border border-zinc-800 rounded-xl p-8">
                <Flame className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
                <div className="text-sm font-semibold text-zinc-300">No pg_stat_statements telemetry available</div>
                <p className="text-xs text-zinc-500 mt-1 max-w-md mx-auto">
                  Ensure extension <code className="text-zinc-400 font-mono">pg_stat_statements</code> is enabled, or provide a CSV/JSON dump export.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {sortedStatements.map((s, idx) => {
                  const cacheHitPct = s.cacheHitRatio !== undefined ? Math.round(s.cacheHitRatio * 100) : null;
                  const isSlow = s.meanExecTimeMs > 250;
                  const isCacheCold = cacheHitPct !== null && cacheHitPct < 90;

                  return (
                    <div
                      key={idx}
                      className="bg-[#141416] border border-zinc-800 rounded-xl p-4 space-y-3 hover:border-zinc-700 transition"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-800/80 pb-2.5 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-zinc-500 font-semibold">#{idx + 1}</span>
                          <span className={`px-2 py-0.5 rounded font-mono font-bold ${
                            isSlow ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30' : 'bg-emerald-500/20 text-emerald-300'
                          }`}>
                            {s.meanExecTimeMs.toFixed(1)}ms mean
                          </span>
                          <span className="text-zinc-400">
                            <strong>{s.calls.toLocaleString()}</strong> calls
                          </span>
                          <span className="text-zinc-500">
                            (Total: {(s.totalExecTimeMs / 1000).toFixed(1)}s)
                          </span>
                        </div>

                        <div className="flex items-center gap-3">
                          {cacheHitPct !== null && (
                            <span className={`text-[11px] font-mono px-2 py-0.5 rounded ${
                              isCacheCold ? 'bg-amber-500/20 text-amber-300' : 'bg-zinc-800 text-zinc-300'
                            }`}>
                              Buffer Hit: {cacheHitPct}%
                            </span>
                          )}
                          <button
                            onClick={() => handleCopyExplain(s.query)}
                            className="flex items-center gap-1 text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-2 py-1 rounded transition border border-zinc-700"
                          >
                            {copiedQuery === s.query ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                            <span>{copiedQuery === s.query ? 'Copied EXPLAIN!' : 'Copy EXPLAIN ANALYZE'}</span>
                          </button>
                        </div>
                      </div>

                      <pre className="p-3 bg-[#0d0d0f] border border-zinc-800/80 rounded-lg font-mono text-xs text-zinc-300 overflow-x-auto leading-relaxed">
                        <code>{s.query}</code>
                      </pre>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 2: pg_stat_activity                                   */}
        {/* ========================================================= */}
        {activeSubTab === 'activity' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-[#141416] p-4 rounded-xl border border-zinc-800 flex items-center justify-between">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Active Queries</div>
                  <div className="text-xl font-bold text-zinc-100 mt-0.5">
                    {activities.filter((a) => a.state === 'active').length}
                  </div>
                </div>
                <Cpu className="w-6 h-6 text-emerald-400 opacity-60" />
              </div>
              <div className="bg-[#141416] p-4 rounded-xl border border-zinc-800 flex items-center justify-between">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Idle in Transaction</div>
                  <div className="text-xl font-bold text-rose-400 mt-0.5">
                    {activities.filter((a) => a.state === 'idle in transaction').length}
                  </div>
                </div>
                <AlertTriangle className="w-6 h-6 text-rose-400 opacity-60" />
              </div>
              <div className="bg-[#141416] p-4 rounded-xl border border-zinc-800 flex items-center justify-between">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Total Monitored PIDs</div>
                  <div className="text-xl font-bold text-cyan-400 mt-0.5">
                    {activities.length}
                  </div>
                </div>
                <Activity className="w-6 h-6 text-cyan-400 opacity-60" />
              </div>
            </div>

            <div className="bg-[#141416] border border-zinc-800 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#1a1a1e] text-zinc-400 uppercase font-mono text-[10px] border-b border-zinc-800">
                    <tr>
                      <th className="p-3">PID</th>
                      <th className="p-3">App Name</th>
                      <th className="p-3">User</th>
                      <th className="p-3">State</th>
                      <th className="p-3">Wait Event</th>
                      <th className="p-3">Duration</th>
                      <th className="p-3">Current Query</th>
                      <th className="p-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800 text-zinc-300">
                    {activities.map((a) => {
                      const isStuck = a.state === 'idle in transaction' && a.durationSeconds > 30;
                      return (
                        <tr key={a.pid} className="hover:bg-zinc-800/30">
                          <td className="p-3 font-mono text-zinc-400">{a.pid}</td>
                          <td className="p-3 font-medium text-zinc-200">{a.applicationName || 'client'}</td>
                          <td className="p-3 text-zinc-400">{a.user}</td>
                          <td className="p-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              a.state === 'active'
                                ? 'bg-emerald-500/20 text-emerald-300'
                                : a.state === 'idle in transaction'
                                ? 'bg-rose-500/20 text-rose-300 font-mono'
                                : 'bg-zinc-800 text-zinc-400'
                            }`}>
                              {a.state}
                            </span>
                          </td>
                          <td className="p-3 font-mono text-[11px] text-zinc-400">
                            {a.waitEvent || 'None'}
                          </td>
                          <td className="p-3 font-mono text-zinc-300">
                            {a.durationSeconds > 0 ? `${a.durationSeconds}s` : '0s'}
                          </td>
                          <td className="p-3 font-mono text-[11px] text-zinc-400 max-w-xs truncate" title={a.query}>
                            {a.query || 'idle'}
                          </td>
                          <td className="p-3 text-right">
                            <button
                              onClick={() => handleCopyTerminate(a.pid)}
                              className="text-[11px] text-rose-400 hover:text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 px-2 py-1 rounded border border-rose-500/20 transition"
                            >
                              {copiedQuery === String(a.pid) ? 'Copied Kill SQL!' : 'Kill Session'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 3: Table Bloat & Vacuum Stats                         */}
        {/* ========================================================= */}
        {activeSubTab === 'tables' && (
          <div className="space-y-4">
            <div className="text-xs text-zinc-400">
              Tables ordered by dead tuple bloat. Tables with high dead tuple percentage degrade sequential scans and require autovacuum tuning or manual <code className="text-zinc-300 font-mono">VACUUM ANALYZE</code>.
            </div>

            <div className="bg-[#141416] border border-zinc-800 rounded-xl overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#1a1a1e] text-zinc-400 uppercase font-mono text-[10px] border-b border-zinc-800">
                  <tr>
                    <th className="p-3">Schema & Table</th>
                    <th className="p-3">Live Rows</th>
                    <th className="p-3">Dead Tuples</th>
                    <th className="p-3">Bloat Ratio</th>
                    <th className="p-3">Seq Scans</th>
                    <th className="p-3">Index Scans</th>
                    <th className="p-3">Size</th>
                    <th className="p-3">Last Autovacuum</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800 text-zinc-300">
                  {tables.map((t, i) => {
                    const isBloated = t.deadTupleRatio > 15;
                    const seqHeavy = t.seqScan > 1000 && t.idxScan < 100;
                    return (
                      <tr key={i} className="hover:bg-zinc-800/30">
                        <td className="p-3 font-mono text-emerald-400 font-medium">
                          {t.schema}.{t.table}
                        </td>
                        <td className="p-3">{t.nLiveTup.toLocaleString()}</td>
                        <td className="p-3 font-mono text-zinc-400">{t.nDeadTup.toLocaleString()}</td>
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            <span className={`font-bold font-mono ${isBloated ? 'text-rose-400' : 'text-zinc-300'}`}>
                              {t.deadTupleRatio}%
                            </span>
                            <div className="w-16 bg-zinc-800 h-1.5 rounded-full overflow-hidden">
                              <div
                                className={`h-full ${isBloated ? 'bg-rose-500' : 'bg-emerald-400'}`}
                                style={{ width: `${Math.min(100, t.deadTupleRatio)}%` }}
                              />
                            </div>
                          </div>
                        </td>
                        <td className="p-3 font-mono text-zinc-400">
                          {t.seqScan.toLocaleString()}
                          {seqHeavy && <span className="ml-1 text-[10px] text-amber-400 font-sans">⚠️ Seq-heavy</span>}
                        </td>
                        <td className="p-3 font-mono text-zinc-400">{t.idxScan.toLocaleString()}</td>
                        <td className="p-3 font-mono text-zinc-400">{formatBytes(t.sizeBytes)}</td>
                        <td className="p-3 text-zinc-500 font-mono text-[11px]">
                          {t.lastAutovacuum ? new Date(t.lastAutovacuum).toLocaleDateString() : 'Never'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB 4: Index Usage & Waste                                */}
        {/* ========================================================= */}
        {activeSubTab === 'indexes' && (
          <div className="space-y-4">
            <div className="text-xs text-zinc-400">
              Scan counts on user indexes from <code className="text-zinc-300 font-mono">pg_stat_user_indexes</code>. Indexes with 0 scans waste disk IOPS during writes and can be dropped safely with <code className="text-zinc-300 font-mono">DROP INDEX CONCURRENTLY</code>.
            </div>

            <div className="bg-[#141416] border border-zinc-800 rounded-xl overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#1a1a1e] text-zinc-400 uppercase font-mono text-[10px] border-b border-zinc-800">
                  <tr>
                    <th className="p-3">Index Name</th>
                    <th className="p-3">Table</th>
                    <th className="p-3">Scan Count</th>
                    <th className="p-3">Tuples Read</th>
                    <th className="p-3">Size</th>
                    <th className="p-3">Status</th>
                    <th className="p-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800 text-zinc-300">
                  {indexes.map((idx, i) => (
                    <tr key={i} className="hover:bg-zinc-800/30">
                      <td className="p-3 font-mono text-zinc-200 font-medium">{idx.indexName}</td>
                      <td className="p-3 font-mono text-zinc-400">{idx.schema}.{idx.table}</td>
                      <td className="p-3 font-mono text-zinc-300">{idx.idxScan.toLocaleString()}</td>
                      <td className="p-3 font-mono text-zinc-400">{idx.idxTupRead.toLocaleString()}</td>
                      <td className="p-3 font-mono text-zinc-400">{formatBytes(idx.sizeBytes)}</td>
                      <td className="p-3">
                        {idx.isUnused ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30 uppercase">
                            Unused (0 Scans)
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 uppercase">
                            Active
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-right">
                        {idx.isUnused && (
                          <button
                            onClick={() => handleCopyDropIndex(idx.schema, idx.indexName)}
                            className="text-[11px] text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 px-2 py-1 rounded border border-amber-500/20 transition"
                          >
                            {copiedQuery === idx.indexName ? 'Copied Drop SQL!' : 'Copy Drop SQL'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
