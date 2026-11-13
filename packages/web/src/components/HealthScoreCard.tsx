import React from 'react';
import { DiagnosticReport } from '@sb-sniffer/core';
import { ShieldAlert, ShieldCheck, AlertTriangle, AlertCircle, Info } from 'lucide-react';

interface Props {
  report: DiagnosticReport;
}

export const HealthScoreCard: React.FC<Props> = ({ report }) => {
  const { healthScore, grade, summary, categoryScores } = report;

  const getScoreColor = (score: number) => {
    if (score >= 90) return 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10';
    if (score >= 80) return 'text-cyan-400 border-cyan-500/30 bg-cyan-500/10';
    if (score >= 70) return 'text-yellow-400 border-yellow-500/30 bg-yellow-500/10';
    return 'text-rose-400 border-rose-500/30 bg-rose-500/10';
  };

  const categoryNames: Record<string, string> = {
    rls: 'RLS & Policies',
    connection_pooler: 'Connection Pooler',
    auth: 'Auth (GoTrue)',
    storage: 'Storage',
    realtime: 'Realtime & WAL',
    performance: 'Query Latency',
    hygiene: 'Schema Hygiene',
    app_code: 'App Code & Env',
    egress_cost: 'Egress & Cost',
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 bg-[#181818] border border-zinc-800 rounded-2xl p-6 shadow-xl">
      {/* Score and Grade */}
      <div className="flex flex-col items-center justify-center border-b md:border-b-0 md:border-r border-zinc-800 pb-6 md:pb-0 md:pr-6">
        <div className="text-xs uppercase tracking-widest text-zinc-400 mb-2 font-semibold">
          Database Health Score
        </div>
        <div
          className={`w-32 h-32 rounded-full border-4 flex flex-col items-center justify-center mb-3 ${getScoreColor(
            healthScore
          )}`}
        >
          <span className="text-4xl font-extrabold tracking-tight">{healthScore}</span>
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">/ 100</span>
        </div>
        <div className="text-sm font-medium text-zinc-300 flex items-center gap-2">
          Grade:{' '}
          <span className={`px-2.5 py-0.5 rounded-md font-bold text-base ${getScoreColor(healthScore)}`}>
            {grade}
          </span>
        </div>
      </div>

      {/* Severity Breakdown */}
      <div className="flex flex-col justify-center border-b md:border-b-0 md:border-r border-zinc-800 pb-6 md:pb-0 md:pr-6">
        <div className="text-xs uppercase tracking-widest text-zinc-400 mb-4 font-semibold">
          Findings Severity
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 text-rose-400 font-medium">
              <ShieldAlert className="w-4 h-4" /> Critical
            </span>
            <span className="bg-rose-500/10 text-rose-300 font-bold px-2 py-0.5 rounded border border-rose-500/20">
              {summary.criticalCount}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 text-amber-400 font-medium">
              <AlertTriangle className="w-4 h-4" /> High
            </span>
            <span className="bg-amber-500/10 text-amber-300 font-bold px-2 py-0.5 rounded border border-amber-500/20">
              {summary.highCount}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 text-yellow-400 font-medium">
              <AlertCircle className="w-4 h-4" /> Medium
            </span>
            <span className="bg-yellow-500/10 text-yellow-300 font-bold px-2 py-0.5 rounded border border-yellow-500/20">
              {summary.mediumCount}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 text-blue-400 font-medium">
              <Info className="w-4 h-4" /> Info
            </span>
            <span className="bg-blue-500/10 text-blue-300 font-bold px-2 py-0.5 rounded border border-blue-500/20">
              {summary.infoCount}
            </span>
          </div>
        </div>
      </div>

      {/* Category Bars */}
      <div className="flex flex-col justify-center">
        <div className="text-xs uppercase tracking-widest text-zinc-400 mb-3 font-semibold">
          Category Health
        </div>
        <div className="space-y-2.5">
          {Object.entries(categoryScores).map(([cat, info]) => (
            <div key={cat} className="space-y-1">
              <div className="flex justify-between text-xs text-zinc-400 font-medium">
                <span>{categoryNames[cat] || cat}</span>
                <span className={info.score >= 80 ? 'text-emerald-400' : 'text-rose-400'}>
                  {info.score}%
                </span>
              </div>
              <div className="w-full bg-zinc-800 h-1.5 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    info.score >= 80
                      ? 'bg-emerald-400'
                      : info.score >= 60
                      ? 'bg-amber-400'
                      : 'bg-rose-500'
                  }`}
                  style={{ width: `${Math.max(5, info.score)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
