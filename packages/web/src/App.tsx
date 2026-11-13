import React, { useState } from 'react';
import {
  analyzeSnapshot,
  BROKEN_SUPABASE_PROJECT_SNAPSHOT,
  DiagnosticReport,
  DiagnosticSnapshot,
  formatFixAllSql,
  formatReportMarkdown,
  formatReportForAI,
} from '@sb-sniffer/core';
import { HealthScoreCard } from './components/HealthScoreCard.js';
import { FindingCard } from './components/FindingCard.js';
import { DumpUploader } from './components/DumpUploader.js';
import { StudioSqlModal } from './components/StudioSqlModal.js';
import {
  Activity,
  Download,
  FileCode,
  FileText,
  Search,
  Sparkles,
  Terminal,
  ShieldAlert,
  Database,
} from 'lucide-react';

import { PostgresDiagnosticsView } from './components/PostgresDiagnosticsView.js';
import { LiveConnectionModal } from './components/LiveConnectionModal.js';
import { LogChecker } from './components/LogChecker.js';
import { Logo } from './components/Logo.js';

export default function App() {
  const [snapshot, setSnapshot] = useState<DiagnosticSnapshot>(BROKEN_SUPABASE_PROJECT_SNAPSHOT);
  const [report, setReport] = useState<DiagnosticReport>(() =>
    analyzeSnapshot(BROKEN_SUPABASE_PROJECT_SNAPSHOT)
  );

  const [activeTab, setActiveTab] = useState<'demo' | 'upload' | 'postgres' | 'logs'>('demo');
  const [filterSeverity, setFilterSeverity] = useState<string>('all');
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [isLiveModalOpen, setIsLiveModalOpen] = useState<boolean>(false);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [copiedAi, setCopiedAi] = useState<boolean>(false);

  // Auto-connect on mount if bridge server already has an active DB connection
  React.useEffect(() => {
    async function initCheck() {
      try {
        const res = await fetch('/api/status');
        if (res.ok) {
          const status = await res.json();
          if (status.hasActiveConnection) {
            const snapRes = await fetch('/api/snapshot');
            if (snapRes.ok) {
              const data = await snapRes.json();
              if (data.snapshot && data.report) {
                setSnapshot(data.snapshot);
                setReport(data.report);
                setIsStreaming(true);
              }
            }
          }
        }
      } catch (err) {
        // Bridge server not active or offline
      }
    }
    initCheck();
  }, []);

  // Live Realtime Polling
  React.useEffect(() => {
    if (!isStreaming) return;

    const timer = setInterval(async () => {
      try {
        const res = await fetch('/api/snapshot');
        if (res.ok) {
          const data = await res.json();
          if (data.snapshot && data.report) {
            setSnapshot(data.snapshot);
            setReport(data.report);
          }
        }
      } catch (err) {
        // bridge server might be paused
      }
    }, 3000);

    return () => clearInterval(timer);
  }, [isStreaming]);

  const handleSnapshotLoaded = (newSnapshot: DiagnosticSnapshot) => {
    setSnapshot(newSnapshot);
    setReport(analyzeSnapshot(newSnapshot));
  };

  const handleLoadDemo = () => {
    setActiveTab('demo');
    handleSnapshotLoaded(BROKEN_SUPABASE_PROJECT_SNAPSHOT);
  };

  const downloadBlob = (content: string, filename: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const downloadMarkdown = () => {
    downloadBlob(formatReportMarkdown(report), `supabase-health-report-${Date.now()}.md`, 'text/markdown');
  };

  const exportForAI = () => {
    downloadBlob(formatReportForAI(report, snapshot), `supabase-ai-export-${Date.now()}.md`, 'text/markdown');
  };

  const copyForAI = async () => {
    await navigator.clipboard.writeText(formatReportForAI(report, snapshot));
    setCopiedAi(true);
    setTimeout(() => setCopiedAi(false), 2500);
  };

  const downloadFixSql = () => {
    downloadBlob(formatFixAllSql(report.findings), `supabase-remediation-${Date.now()}.sql`, 'text/plain');
  };

  // Filter findings
  const filteredFindings = report.findings.filter((f) => {
    if (filterSeverity !== 'all' && f.severity !== filterSeverity) return false;
    if (filterCategory !== 'all' && f.category !== filterCategory) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchId = f.id.toLowerCase().includes(q);
      const matchTitle = f.title.toLowerCase().includes(q);
      const matchSummary = f.summary.toLowerCase().includes(q);
      const matchObj = f.affectedObjects.some((o) => o.name.toLowerCase().includes(q));
      if (!matchId && !matchTitle && !matchSummary && !matchObj) return false;
    }
    return true;
  });

  return (
    <div className="min-h-screen bg-[#101012] text-zinc-100 flex flex-col font-sans">
      {/* Top Application Bar */}
      <header className="border-b border-zinc-800 bg-[#161618]/90 backdrop-blur sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2.5 flex items-center justify-between">
          <Logo size="sm" />

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsLiveModalOpen(true)}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border font-semibold transition-all ${
                isStreaming
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-sm'
                  : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border-zinc-700'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${isStreaming ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-500'}`} />
              <span>{isStreaming ? 'Live Realtime Active' : 'Connect Live DB'}</span>
            </button>

            <button
              onClick={() => setIsModalOpen(true)}
              className="flex items-center gap-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-3 py-1.5 rounded-lg border border-zinc-700 transition-colors"
            >
              <Terminal className="w-3.5 h-3.5 text-emerald-400" />
              <span>Studio SQL</span>
            </button>

            <button
              onClick={downloadFixSql}
              className="flex items-center gap-1.5 text-xs bg-emerald-500 hover:bg-emerald-400 text-black font-semibold px-3 py-1.5 rounded-lg transition-colors"
            >
              <FileCode className="w-3.5 h-3.5" />
              <span>Fix SQL</span>
            </button>

            <button
              onClick={downloadMarkdown}
              className="hidden sm:flex items-center gap-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-3 py-1.5 rounded-lg border border-zinc-700 transition-colors"
            >
              <FileText className="w-3.5 h-3.5 text-cyan-400" />
              <span>Export Report</span>
            </button>

            <button
              onClick={exportForAI}
              title="Detailed export to attach to an AI chat"
              className="hidden sm:flex items-center gap-1.5 text-xs bg-violet-500 hover:bg-violet-400 text-black font-semibold px-3 py-1.5 rounded-lg transition-colors"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Export for AI</span>
            </button>

            <button
              onClick={copyForAI}
              className="hidden sm:flex items-center gap-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-3 py-1.5 rounded-lg border border-zinc-700 transition-colors"
            >
              <span>{copiedAi ? 'Copied for AI!' : 'Copy for AI'}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area: Single Standard GUI View */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 flex-1 space-y-6 w-full">
        {/* Navigation Tabs Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#181818] p-2 rounded-xl border border-zinc-800">
          <div className="flex flex-wrap items-center gap-2">
            {isStreaming ? (
              <button
                onClick={() => setActiveTab('demo')}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  activeTab === 'demo'
                    ? 'bg-emerald-500 text-black shadow-md'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Activity className="w-3.5 h-3.5 text-emerald-400" /> Live DB Audit
              </button>
            ) : null}

            <button
              onClick={handleLoadDemo}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'demo' && !isStreaming
                  ? 'bg-emerald-500 text-black shadow-md'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" /> Sample Demo App
            </button>

            <button
              onClick={() => setActiveTab('upload')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'upload'
                  ? 'bg-emerald-500 text-black shadow-md'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Download className="w-3.5 h-3.5" /> Analyze My Dump
            </button>

            <button
              onClick={() => setActiveTab('postgres')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'postgres'
                  ? 'bg-cyan-500 text-black shadow-md'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Database className="w-3.5 h-3.5" /> Postgres Telemetry
            </button>

            <button
              onClick={() => setActiveTab('logs')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'logs'
                  ? 'bg-amber-400 text-black shadow-md'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Terminal className="w-3.5 h-3.5" /> Live &amp; Historical Logs
            </button>
          </div>

          <div className="text-xs text-zinc-400 flex items-center gap-2">
            <span>Target:</span>
            <span className="font-mono text-zinc-200 px-2 py-0.5 bg-zinc-900 border border-zinc-800 rounded">
              {snapshot.projectName || snapshot.source}
            </span>
          </div>
        </div>

        {/* Upload Form if active */}
        {activeTab === 'upload' && <DumpUploader onSnapshotLoaded={handleSnapshotLoaded} />}

        {/* Postgres Diagnostic Telemetry View if active */}
        {activeTab === 'postgres' && (
          <PostgresDiagnosticsView
            snapshot={snapshot}
            onOpenStudioModal={() => setIsModalOpen(true)}
          />
        )}

        {/* Log Checker View if active */}
        {activeTab === 'logs' && (
          <LogChecker
            logs={snapshot.logs || []}
            findings={report.findings}
            onSelectFinding={(checkId) => {
              setActiveTab('demo');
              setFilterCategory('all');
              setFilterSeverity('all');
              setSearchQuery(checkId);
            }}
          />
        )}

        {/* Health Score Overview */}
        {activeTab !== 'postgres' && activeTab !== 'logs' && <HealthScoreCard report={report} />}

        {/* Search and Filters */}
        {activeTab !== 'postgres' && activeTab !== 'logs' && (
          <div className="flex flex-col sm:flex-row gap-3 items-center justify-between pt-2">
            <div className="relative w-full sm:w-80">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-zinc-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search findings, tables, policies..."
                className="w-full bg-[#181818] border border-zinc-800 rounded-xl pl-9 pr-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-emerald-500/50"
              />
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <select
                value={filterSeverity}
                onChange={(e) => setFilterSeverity(e.target.value)}
                className="bg-[#181818] border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-300 focus:outline-none focus:border-emerald-500/50"
              >
                <option value="all">All Severities</option>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
              </select>

              <select
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                className="bg-[#181818] border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-300 focus:outline-none focus:border-emerald-500/50"
              >
                <option value="all">All Categories</option>
                <option value="rls">RLS & Foreign Keys</option>
                <option value="connection_pooler">Connection Pooler (Supavisor)</option>
                <option value="auth">Auth Triggers</option>
                <option value="storage">Storage & Orphans</option>
                <option value="realtime">Realtime Publications</option>
                <option value="performance">Query Latency</option>
                <option value="hygiene">Schema Hygiene</option>
                <option value="app_code">App Code &amp; Env</option>
                <option value="egress_cost">Egress &amp; Cost</option>
              </select>
            </div>
          </div>
        )}

        {/* Findings List */}
        {activeTab !== 'postgres' && activeTab !== 'logs' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between text-xs text-zinc-400">
              <span>
                Showing <strong className="text-zinc-200">{filteredFindings.length}</strong> of{' '}
                {report.findings.length} findings
              </span>
            </div>

            {filteredFindings.map((finding, idx) => (
              <FindingCard key={finding.id} finding={finding} index={idx} />
            ))}

            {filteredFindings.length === 0 && (
              <div className="text-center py-12 bg-[#181818] border border-zinc-800 rounded-2xl p-8">
                <ShieldAlert className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
                <h3 className="text-sm font-semibold text-zinc-200">
                  No findings match your filters
                </h3>
                <p className="text-xs text-zinc-500 mt-1">
                  Try clearing the search or category filters.
                </p>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Standard Clean Footer */}
      <footer className="border-t border-zinc-800/80 py-4 text-center text-xs text-zinc-500 bg-[#141416]">
        <div className="max-w-7xl mx-auto px-4 flex items-center justify-between">
          <span>Supabase Diagnostic & Health Sniffer — Built for Support Engineers</span>
          <div className="flex items-center gap-4 text-zinc-400">
            <span>Web GUI + Terminal CLI</span>
            <span>•</span>
            <span>MIT License</span>
          </div>
        </div>
      </footer>

      {/* Studio Introspection Query Modal */}
      <StudioSqlModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />

      {/* Live Supabase Connection Modal */}
      <LiveConnectionModal
        isOpen={isLiveModalOpen}
        onClose={() => setIsLiveModalOpen(false)}
        onLiveConnected={(snap, rep) => {
          setSnapshot(snap);
          setReport(rep);
        }}
        isStreaming={isStreaming}
        setIsStreaming={setIsStreaming}
      />
    </div>
  );
}
