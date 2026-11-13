import React, { useState } from 'react';
import { DiagnosticFinding } from '@sb-sniffer/core';
import {
  ShieldAlert,
  AlertTriangle,
  AlertCircle,
  Info,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  ExternalLink,
  Flame,
  Wrench,
  Layers,
} from 'lucide-react';

interface Props {
  finding: DiagnosticFinding;
  index: number;
}

export const FindingCard: React.FC<Props> = ({ finding, index }) => {
  const [expanded, setExpanded] = useState<boolean>(index === 0);
  const [copied, setCopied] = useState<boolean>(false);

  const copySql = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (finding.fixSql) {
      navigator.clipboard.writeText(finding.fixSql);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const severityBadge = () => {
    switch (finding.severity) {
      case 'critical':
        return (
          <span className="flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full bg-rose-500/15 text-rose-400 border border-rose-500/30">
            <ShieldAlert className="w-3.5 h-3.5" /> CRITICAL
          </span>
        );
      case 'high':
        return (
          <span className="flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30">
            <AlertTriangle className="w-3.5 h-3.5" /> HIGH
          </span>
        );
      case 'medium':
        return (
          <span className="flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full bg-yellow-500/15 text-yellow-300 border border-yellow-500/30">
            <AlertCircle className="w-3.5 h-3.5" /> MEDIUM
          </span>
        );
      default:
        return (
          <span className="flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full bg-blue-500/15 text-blue-300 border border-blue-500/30">
            <Info className="w-3.5 h-3.5" /> INFO
          </span>
        );
    }
  };

  return (
    <div className="bg-[#181818] border border-zinc-800 rounded-2xl overflow-hidden transition-all duration-200 hover:border-zinc-700 shadow-md">
      {/* Header bar (Clickable to collapse/expand) */}
      <div
        onClick={() => setExpanded(!expanded)}
        className="p-5 flex items-start justify-between cursor-pointer select-none bg-[#1c1c1c] hover:bg-[#202020] transition-colors"
      >
        <div className="flex items-start gap-3.5">
          <div className="mt-0.5">{severityBadge()}</div>
          <div>
            <h3 className="text-base font-semibold text-zinc-100 flex items-center gap-2">
              {finding.title}
            </h3>
            <p className="text-xs text-zinc-400 mt-1 line-clamp-1">{finding.summary}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-zinc-400 ml-4 shrink-0">
          <span className="text-xs bg-zinc-800/80 px-2.5 py-1 rounded-md text-zinc-300 font-mono">
            {finding.category}
          </span>
          {expanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="p-6 space-y-5 border-t border-zinc-800 text-sm">
          {/* Why It Clogs Supabase Support Callout */}
          <div className="bg-amber-950/20 border border-amber-600/30 rounded-xl p-4 text-amber-200">
            <div className="flex items-center gap-2 text-amber-400 font-semibold mb-1 text-xs uppercase tracking-wider">
              <Flame className="w-4 h-4 text-amber-400" /> Why This Clogs the Supabase Support Queue
            </div>
            <p className="text-xs leading-relaxed text-amber-100/90">{finding.whyItClogsSupport}</p>
          </div>

          {/* Affected Database Objects */}
          {finding.affectedObjects.length > 0 && (
            <div>
              <div className="text-xs uppercase tracking-wider font-semibold text-zinc-400 mb-2 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5" /> Affected Database Objects (
                {finding.affectedObjects.length})
              </div>
              <div className="bg-[#121212] border border-zinc-800/80 rounded-xl overflow-hidden divide-y divide-zinc-800/60 max-h-60 overflow-y-auto">
                {finding.affectedObjects.map((obj, i) => (
                  <div key={i} className="p-3 text-xs flex items-start justify-between gap-4">
                    <div className="font-mono text-emerald-400 font-medium shrink-0">
                      {obj.name}
                      <span className="ml-2 text-[10px] text-zinc-500 uppercase px-1.5 py-0.5 rounded bg-zinc-800 font-sans">
                        {obj.type}
                      </span>
                    </div>
                    <div className="text-zinc-400 text-right">{obj.detail}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Remediation Explanation */}
          <div>
            <div className="text-xs uppercase tracking-wider font-semibold text-zinc-400 mb-1.5 flex items-center gap-1.5">
              <Wrench className="w-3.5 h-3.5" /> Recommended Remediation
            </div>
            <p className="text-xs text-zinc-300 leading-relaxed whitespace-pre-line">
              {finding.remediationExplanation}
            </p>
          </div>

          {/* Fix SQL Code Snippet */}
          {finding.fixSql && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs uppercase tracking-wider font-semibold text-zinc-400">
                  Remediation SQL (Copy & Run in Supabase SQL Editor)
                </span>
                <button
                  onClick={copySql}
                  className="flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 px-2.5 py-1 rounded-md transition-colors border border-emerald-500/20"
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? 'Copied!' : 'Copy SQL'}
                </button>
              </div>
              <pre className="p-4 bg-[#121212] border border-zinc-800 rounded-xl font-mono text-xs text-zinc-300 overflow-x-auto leading-relaxed">
                <code>{finding.fixSql}</code>
              </pre>
            </div>
          )}

          {/* Documentation Link */}
          {finding.documentationUrl && (
            <div className="pt-2">
              <a
                href={finding.documentationUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 hover:underline"
              >
                Official Supabase Documentation <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
