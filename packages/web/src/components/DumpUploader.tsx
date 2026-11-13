import React, { useState } from 'react';
import {
  parseSchemaDump,
  parseStatStatements,
  parseStudioJson,
  DiagnosticSnapshot,
} from '@sb-sniffer/core';
import { UploadCloud, FileText, Database, Check, AlertCircle } from 'lucide-react';

interface Props {
  onSnapshotLoaded: (snapshot: DiagnosticSnapshot) => void;
}

function looksLikeSql(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed || trimmed.startsWith('{') || trimmed.startsWith('[')) return false;
  return (
    trimmed.startsWith('--') ||
    /^\s*(CREATE|ALTER|DROP|BEGIN|SET|COMMENT|GRANT|REVOKE|INSERT|SELECT|WITH)\b/im.test(trimmed)
  );
}

function looksLikeIntrospectionQuery(input: string): boolean {
  return /supabase_diagnostics/i.test(input) && /pg_constraint|pg_class|tables_info/i.test(input);
}

export const DumpUploader: React.FC<Props> = ({ onSnapshotLoaded }) => {
  const [activeTab, setActiveTab] = useState<'studio' | 'schema' | 'stats'>('studio');
  const [textInput, setTextInput] = useState('');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const runAnalysisForTab = (tab: 'studio' | 'schema' | 'stats', rawText: string) => {
    const trimmed = rawText.trim();
    if (!trimmed) return;

    setErrorMsg(null);
    setStatusMsg(null);

    try {
      // Helpful UX: auto-detect SQL pasted into Studio JSON tab (except the introspection query itself)
      if (tab === 'studio' && looksLikeSql(trimmed)) {
        if (looksLikeIntrospectionQuery(trimmed)) {
          setErrorMsg(
            'This looks like the read-only Introspection SQL query itself. Run it in the Supabase Studio SQL Editor first, then paste the returned JSON result here.'
          );
          return;
        }
        setActiveTab('schema');
        const snapshot = parseSchemaDump(trimmed);
        setStatusMsg(
          `Auto-detected SQL (switched to pg_dump Schema SQL): parsed ${snapshot.tables.length} tables, ${snapshot.policies.length} policies.`
        );
        onSnapshotLoaded(snapshot);
        return;
      }

      // Helpful UX: auto-detect JSON pasted into Schema SQL tab
      if (tab === 'schema' && (trimmed.startsWith('{') || trimmed.startsWith('['))) {
        const snapshot = parseStudioJson(trimmed);
        setActiveTab('studio');
        setStatusMsg('Auto-detected Studio Introspection JSON (switched tab) and loaded snapshot!');
        onSnapshotLoaded(snapshot);
        return;
      }

      if (tab === 'studio') {
        const snapshot = parseStudioJson(trimmed);
        setStatusMsg('Loaded Studio Introspection JSON successfully!');
        onSnapshotLoaded(snapshot);
      } else if (tab === 'schema') {
        const snapshot = parseSchemaDump(trimmed);
        setStatusMsg(`Parsed schema dump: found ${snapshot.tables.length} tables, ${snapshot.policies.length} policies.`);
        onSnapshotLoaded(snapshot);
      } else if (tab === 'stats') {
        const stats = parseStatStatements(trimmed);
        setStatusMsg(`Parsed ${stats.length} statements from pg_stat_statements.`);
        const snapshot: DiagnosticSnapshot = {
          timestamp: new Date().toISOString(),
          projectName: 'Custom pg_stat_statements dump',
          source: 'schema_dump',
          tables: [],
          policies: [],
          indexes: [],
          foreignKeys: [],
          triggers: [],
          extensions: [],
          statStatements: stats,
        };
        onSnapshotLoaded(snapshot);
      }
    } catch (err: any) {
      setErrorMsg(`Error parsing input: ${err?.message || String(err)}`);
    }
  };

  const handleProcessText = () => {
    runAnalysisForTab(activeTab, textInput);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const lower = file.name.toLowerCase();
    let targetTab = activeTab;
    if (lower.endsWith('.sql')) {
      targetTab = 'schema';
      setActiveTab('schema');
    } else if (lower.endsWith('.csv')) {
      targetTab = 'stats';
      setActiveTab('stats');
    } else if (lower.endsWith('.json')) {
      targetTab = 'studio';
      setActiveTab('studio');
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = (event.target?.result as string) || '';
      setTextInput(content);
      setErrorMsg(null);
      setStatusMsg(null);
      if (content.trim()) {
        runAnalysisForTab(targetTab, content);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="bg-[#181818] border border-zinc-800 rounded-2xl p-6 shadow-xl space-y-4">
      <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
        <div>
          <h2 className="text-base font-semibold text-zinc-100 flex items-center gap-2">
            <UploadCloud className="w-5 h-5 text-emerald-400" />
            100% Client-Side Health Analysis
          </h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Zero database credentials shared. Paste or upload exported dumps directly in your browser.
          </p>
        </div>

        {/* Format tabs */}
        <div className="flex bg-[#121212] p-1 rounded-lg border border-zinc-800 text-xs font-medium">
          <button
            onClick={() => {
              setActiveTab('studio');
              setErrorMsg(null);
            }}
            className={`px-3 py-1.5 rounded-md transition-all ${
              activeTab === 'studio'
                ? 'bg-emerald-500 text-black font-semibold'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Studio Introspection JSON
          </button>
          <button
            onClick={() => {
              setActiveTab('schema');
              setErrorMsg(null);
            }}
            className={`px-3 py-1.5 rounded-md transition-all ${
              activeTab === 'schema'
                ? 'bg-emerald-500 text-black font-semibold'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            pg_dump Schema SQL
          </button>
          <button
            onClick={() => {
              setActiveTab('stats');
              setErrorMsg(null);
            }}
            className={`px-3 py-1.5 rounded-md transition-all ${
              activeTab === 'stats'
                ? 'bg-emerald-500 text-black font-semibold'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            pg_stat_statements
          </button>
        </div>
      </div>

      <div>
        <textarea
          value={textInput}
          onChange={(e) => {
            setTextInput(e.target.value);
            if (errorMsg) setErrorMsg(null);
          }}
          placeholder={
            activeTab === 'studio'
              ? 'Paste the JSON result from the read-only Supabase Studio Introspection Query (or SQL schema) here...'
              : activeTab === 'schema'
              ? 'Paste your schema.sql / pg_dump --schema-only output here...'
              : 'Paste your pg_stat_statements CSV or JSON export here...'
          }
          className="w-full h-44 bg-[#121212] border border-zinc-800 rounded-xl p-4 font-mono text-xs text-zinc-300 focus:outline-none focus:border-emerald-500/50 resize-y"
        />
      </div>

      {errorMsg && (
        <div className="flex items-start gap-2.5 bg-red-500/10 border border-red-500/30 text-red-300 text-xs rounded-xl px-3.5 py-2.5">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      <div className="flex items-center justify-between text-xs pt-1">
        <label className="cursor-pointer flex items-center gap-2 text-zinc-400 hover:text-zinc-200 bg-zinc-800/60 hover:bg-zinc-800 px-3.5 py-2 rounded-lg border border-zinc-700/50 transition-colors">
          <FileText className="w-4 h-4 text-emerald-400" />
          <span>Upload File (.sql, .json, .csv)</span>
          <input
            type="file"
            accept=".sql,.json,.csv,.txt"
            onChange={handleFileUpload}
            className="hidden"
          />
        </label>

        <div className="flex items-center gap-3">
          {statusMsg && (
            <span className="text-emerald-400 flex items-center gap-1 font-medium">
              <Check className="w-3.5 h-3.5" /> {statusMsg}
            </span>
          )}
          <button
            onClick={handleProcessText}
            disabled={!textInput.trim()}
            className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed text-black font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            <Database className="w-4 h-4" /> Run Diagnostics
          </button>
        </div>
      </div>
    </div>
  );
};
