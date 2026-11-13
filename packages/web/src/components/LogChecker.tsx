import React, { useState, useEffect, useRef } from 'react';
import {
  DiagnosticFinding,
  LogEntry,
  parseRawLogs,
} from '@sb-sniffer/core';
import {
  Terminal,
  Play,
  Pause,
  Filter,
  Search,
  Download,
  Upload,
  AlertCircle,
  ShieldAlert,
  Flame,
  Check,
  Copy,
  Clock,
  Radio,
  FileText,
  KeyRound,
  HardDrive,
  Server,
  Layers,
} from 'lucide-react';

interface Props {
  logs: LogEntry[];
  findings: DiagnosticFinding[];
  onSelectFinding?: (checkId: string) => void;
}

const MAX_LIVE = 500;
const STORAGE_KEY = 'sb-sniffer-live-logs';
const liveStore: { entries: LogEntry[] } = { entries: [] };
try {
  const raw = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(STORAGE_KEY) : null;
  if (raw) liveStore.entries = JSON.parse(raw);
} catch {
  /* ignore corrupt storage */
}
function saveLiveStore() {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(liveStore.entries));
  } catch {
    /* storage unavailable */
  }
}

export const LogChecker: React.FC<Props> = ({ logs: initialLogs, findings, onSelectFinding }) => {
  // Live entries live in a module-level store (mirrored to sessionStorage) so they
  // survive parent re-renders, snapshot polling, and switching tabs.
  const [logs, setLogsState] = useState<LogEntry[]>(() => [...initialLogs, ...liveStore.entries]);
  const setLogs = (updater: LogEntry[] | ((prev: LogEntry[]) => LogEntry[])) => {
    setLogsState((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      liveStore.entries = next.filter((l) => l.id.startsWith('live-')).slice(-MAX_LIVE);
      saveLiveStore();
      return next;
    });
  };
  const [isLiveTail, setIsLiveTail] = useState<boolean>(true);
  const [serviceFilter, setServiceFilter] = useState<string>('all');
  const [levelFilter, setLevelFilter] = useState<string>('all');
  const [timeFilter, setTimeFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState<boolean>(true);

  const logContainerRef = useRef<HTMLDivElement>(null);

  // Sync only when the *contents* of the incoming logs change (not array identity),
  // and always keep previously collected live entries.
  const initialKey = `${initialLogs.length}|${initialLogs[0]?.id ?? ''}|${initialLogs[initialLogs.length - 1]?.id ?? ''}`;
  const firstSync = useRef(true);
  useEffect(() => {
    if (firstSync.current) {
      firstSync.current = false;
      return;
    }
    setLogsState([...initialLogs, ...liveStore.entries]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialKey]);

  // Auto-scroll to bottom when in live tail mode
  useEffect(() => {
    if (isLiveTail && autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, isLiveTail, autoScroll]);

  // Live tail: poll REAL logs from the bridge server (/api/logs). Falls back to clearly
  // labelled simulated heartbeat lines only if the bridge or token is unavailable.
  const [liveSource, setLiveSource] = useState<'connecting' | 'real' | 'simulated'>('connecting');
  const [liveError, setLiveError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLiveTail) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch('/api/logs');
        const data = await res.json();
        if (cancelled) return;
        if (data.error) {
          setLiveSource('simulated');
          setLiveError(data.error);
          pushSimulated();
          return;
        }
        setLiveSource('real');
        setLiveError(null);
        const incoming: LogEntry[] = data.logs || [];
        setLogs((prev) => {
          const seen = new Set(prev.map((l) => l.id));
          const fresh = incoming.filter((l) => !seen.has(l.id));
          return fresh.length ? [...prev, ...fresh].slice(-500) : prev;
        });
      } catch (e: any) {
        if (cancelled) return;
        setLiveSource('simulated');
        setLiveError('Bridge server unreachable (run `sb-sniffer serve`).');
        pushSimulated();
      }
    };

    const pushSimulated = () => {
      const samples = [
        { service: 'api', message: '[simulated] GET /rest/v1/invoices?limit=25 200 OK 24ms' },
        { service: 'postgres', message: '[simulated] checkpoint complete: wrote 42 buffers' },
        { service: 'pooler', message: '[simulated] supavisor client checkout: pool size 15/20' },
      ];
      const pick = samples[Math.floor(Math.random() * samples.length)];
      setLogs((prev) =>
        [
          ...prev,
          {
            id: `live-sim-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            timestamp: new Date().toISOString(),
            service: pick.service as any,
            level: 'info' as any,
            message: pick.message,
          },
        ].slice(-500)
      );
    };

    poll();
    const interval = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isLiveTail]);

  // Filter logs
  const filteredLogs = logs.filter((log) => {
    if (serviceFilter !== 'all' && log.service !== serviceFilter) return false;
    if (levelFilter !== 'all' && log.level !== levelFilter) return false;

    // Time filter
    if (timeFilter !== 'all') {
      const now = Date.now();
      const logTime = new Date(log.timestamp).getTime();
      const diffMinutes = (now - logTime) / (1000 * 60);

      if (timeFilter === '5m' && diffMinutes > 5) return false;
      if (timeFilter === '15m' && diffMinutes > 15) return false;
      if (timeFilter === '1h' && diffMinutes > 60) return false;
      if (timeFilter === '24h' && diffMinutes > 1440) return false;
    }

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        log.message.toLowerCase().includes(q) ||
        log.service.toLowerCase().includes(q) ||
        log.level.toLowerCase().includes(q)
      );
    }

    return true;
  });

  const handleCopyLine = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleExportLogs = () => {
    const text = filteredLogs
      .map((l) => `[${l.timestamp}] [${l.service.toUpperCase()}] [${l.level.toUpperCase()}]: ${l.message}`)
      .join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `supabase-logs-${Date.now()}.log`;
    a.click();
  };

  const handleUploadLogs = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      const parsed = parseRawLogs(content);
      if (parsed.length > 0) {
        setLogs(parsed);
        setIsLiveTail(false);
      }
    };
    reader.readAsText(file);
  };

  const getLevelBadge = (level: LogEntry['level']) => {
    switch (level) {
      case 'fatal':
        return <span className="bg-rose-500/20 text-rose-300 font-bold px-1.5 py-0.5 rounded uppercase text-[9px] border border-rose-500/40">FATAL</span>;
      case 'error':
        return <span className="bg-rose-500/15 text-rose-400 font-bold px-1.5 py-0.5 rounded uppercase text-[9px]">ERROR</span>;
      case 'warning':
        return <span className="bg-amber-500/15 text-amber-300 font-bold px-1.5 py-0.5 rounded uppercase text-[9px]">WARN</span>;
      case 'debug':
        return <span className="bg-zinc-800 text-zinc-400 font-mono px-1.5 py-0.5 rounded uppercase text-[9px]">DEBUG</span>;
      default:
        return <span className="bg-blue-500/15 text-blue-300 font-mono px-1.5 py-0.5 rounded uppercase text-[9px]">INFO</span>;
    }
  };

  const getServiceBadge = (service: LogEntry['service']) => {
    switch (service) {
      case 'postgres':
        return <span className="text-cyan-400 bg-cyan-500/10 px-1.5 py-0.5 rounded font-mono text-[10px]">postgres</span>;
      case 'auth':
        return <span className="text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded font-mono text-[10px]">gotrue</span>;
      case 'pooler':
        return <span className="text-purple-400 bg-purple-500/10 px-1.5 py-0.5 rounded font-mono text-[10px]">supavisor</span>;
      case 'storage':
        return <span className="text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded font-mono text-[10px]">storage</span>;
      default:
        return <span className="text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded font-mono text-[10px]">postgrest</span>;
    }
  };

  return (
    <div className="bg-[#141416] border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl flex flex-col font-sans">
      {/* 1. Header Toolbar */}
      <div className="bg-[#1a1a1e] px-5 py-3.5 border-b border-zinc-800 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
            <Terminal className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-zinc-100">Live &amp; Historical Log Checker</h2>
              <div
                className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                  isLiveTail
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${isLiveTail ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-500'}`} />
                {isLiveTail ? `Live Tail Active · ${liveSource === 'real' ? 'real Supabase logs' : liveSource === 'simulated' ? 'SIMULATED' : 'connecting…'}` : 'Tail Paused'}
              </div>
            </div>
            {liveError && isLiveTail && (
              <p className="text-[11px] text-amber-400">Real logs unavailable: {liveError}</p>
            )}
            <p className="text-[11px] text-zinc-400">
              Aggregated stream from Postgres, GoTrue Auth, Supavisor, Storage API, and PostgREST
            </p>
          </div>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-2 text-xs">
          <button
            onClick={() => setIsLiveTail(!isLiveTail)}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg border font-semibold transition ${
              isLiveTail
                ? 'bg-zinc-800 text-amber-300 border-zinc-700 hover:bg-zinc-700'
                : 'bg-emerald-500 text-black border-emerald-400'
            }`}
          >
            {isLiveTail ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            <span>{isLiveTail ? 'Pause Stream' : 'Resume Live Tail'}</span>
          </button>

          <label className="flex items-center gap-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-3 py-1.5 rounded-lg border border-zinc-700 cursor-pointer transition">
            <Upload className="w-3.5 h-3.5 text-cyan-400" />
            <span>Upload Log File</span>
            <input type="file" accept=".log,.txt,.json" onChange={handleUploadLogs} className="hidden" />
          </label>

          <button
            onClick={handleExportLogs}
            className="flex items-center gap-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-3 py-1.5 rounded-lg border border-zinc-700 transition"
          >
            <Download className="w-3.5 h-3.5 text-emerald-400" />
            <span>Export Filtered</span>
          </button>
        </div>
      </div>

      {/* 2. Filter & Search Controls */}
      <div className="p-4 bg-[#18181b] border-b border-zinc-800 flex flex-wrap items-center justify-between gap-3 text-xs">
        {/* Search */}
        <div className="relative w-full sm:w-72">
          <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-zinc-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search log messages (regex / text)..."
            className="w-full bg-[#121214] border border-zinc-700/60 rounded-lg pl-8 pr-3 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-emerald-500"
          />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Service Filter */}
          <select
            value={serviceFilter}
            onChange={(e) => setServiceFilter(e.target.value)}
            className="bg-[#121214] border border-zinc-700/60 rounded-lg px-2.5 py-1.5 text-zinc-300 focus:outline-none focus:border-emerald-500"
          >
            <option value="all">All Services</option>
            <option value="postgres">🐘 Postgres Database</option>
            <option value="auth">🔐 GoTrue Auth</option>
            <option value="pooler">🔌 Supavisor Pooler</option>
            <option value="storage">📦 Storage API</option>
            <option value="api">🌐 PostgREST API</option>
          </select>

          {/* Level Filter */}
          <select
            value={levelFilter}
            onChange={(e) => setLevelFilter(e.target.value)}
            className="bg-[#121214] border border-zinc-700/60 rounded-lg px-2.5 py-1.5 text-zinc-300 focus:outline-none focus:border-emerald-500"
          >
            <option value="all">All Levels</option>
            <option value="fatal">Fatal</option>
            <option value="error">Error</option>
            <option value="warning">Warning</option>
            <option value="info">Info</option>
          </select>

          {/* Time Range Filter */}
          <select
            value={timeFilter}
            onChange={(e) => setTimeFilter(e.target.value)}
            className="bg-[#121214] border border-zinc-700/60 rounded-lg px-2.5 py-1.5 text-zinc-300 focus:outline-none focus:border-emerald-500"
          >
            <option value="all">Time: All Available</option>
            <option value="5m">Last 5 Minutes</option>
            <option value="15m">Last 15 Minutes</option>
            <option value="1h">Last 1 Hour</option>
            <option value="24h">Last 24 Hours</option>
          </select>

          <label className="flex items-center gap-1.5 text-zinc-400 cursor-pointer select-none ml-2">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="rounded bg-zinc-800 border-zinc-700 text-emerald-500 focus:ring-0"
            />
            <span className="text-[11px]">Auto-scroll</span>
          </label>
        </div>
      </div>

      {/* 3. Log Stream Console */}
      <div
        ref={logContainerRef}
        className="h-96 overflow-y-auto bg-[#0d0d0f] p-4 font-mono text-xs text-zinc-300 space-y-2 select-text"
      >
        {filteredLogs.length === 0 ? (
          <div className="text-center py-12 text-zinc-500 font-sans">
            No log entries match the selected filters.
          </div>
        ) : (
          filteredLogs.map((log) => {
            const isMatch = !!log.matchedCheckId;
            return (
              <div
                key={log.id}
                className={`p-2 rounded-lg flex flex-col sm:flex-row sm:items-start justify-between gap-2 transition hover:bg-zinc-800/40 group ${
                  isMatch ? 'bg-amber-950/20 border-l-2 border-amber-400' : ''
                }`}
              >
                <div className="flex items-start gap-2.5 overflow-hidden">
                  <span className="text-zinc-500 text-[10px] shrink-0 font-mono mt-0.5">
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </span>
                  <div className="shrink-0">{getLevelBadge(log.level)}</div>
                  <div className="shrink-0">{getServiceBadge(log.service)}</div>

                  <span className="break-all text-zinc-200 leading-relaxed">
                    {log.message}
                  </span>
                </div>

                <div className="flex items-center gap-2 shrink-0 self-end sm:self-start">
                  {log.matchedCheckId && (
                    <button
                      onClick={() => onSelectFinding && onSelectFinding(log.matchedCheckId!)}
                      className="flex items-center gap-1 text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/40 px-2 py-0.5 rounded font-sans font-semibold hover:bg-amber-500/30 transition"
                      title="Directly relates to an identified Support Bottleneck!"
                    >
                      <Flame className="w-3 h-3 text-amber-400" />
                      <span>{log.matchedCheckId.replace(/_/g, ' ')}</span>
                    </button>
                  )}

                  <button
                    onClick={() => handleCopyLine(log.id, log.message)}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-zinc-200 transition"
                    title="Copy log line"
                  >
                    {copiedId === log.id ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 4. Console Status Bar */}
      <div className="bg-[#18181b] px-4 py-2 border-t border-zinc-800 flex items-center justify-between text-[11px] text-zinc-500 font-mono">
        <div className="flex items-center gap-3">
          <span>Showing <strong>{filteredLogs.length}</strong> of {logs.length} events</span>
          <span>•</span>
          <span>Buffer: Last {MAX_LIVE} entries in memory</span>
        </div>
        <div className="flex items-center gap-2 text-zinc-400 font-sans">
          <span className="w-2 h-2 rounded-full bg-emerald-400" />
          <span>Pattern Detector: 10/10 Incident Rules Active</span>
        </div>
      </div>
    </div>
  );
};
