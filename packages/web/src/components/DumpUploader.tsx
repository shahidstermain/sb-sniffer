import React, { useState } from 'react';
import {
  parseSchemaDump,
  parseStatStatements,
  parseStudioJson,
  DiagnosticSnapshot,
} from '@sb-sniffer/core';
import { UploadCloud, FileText, Database, Check } from 'lucide-react';

interface Props {
  onSnapshotLoaded: (snapshot: DiagnosticSnapshot) => void;
}

export const DumpUploader: React.FC<Props> = ({ onSnapshotLoaded }) => {
  const [activeTab, setActiveTab] = useState<'studio' | 'schema' | 'stats'>('studio');
  const [textInput, setTextInput] = useState('');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const handleProcessText = () => {
    if (!textInput.trim()) return;

    try {
      if (activeTab === 'studio') {
        const snapshot = parseStudioJson(textInput);
        setStatusMsg('Loaded Studio Introspection JSON successfully!');
        onSnapshotLoaded(snapshot);
      } else if (activeTab === 'schema') {
        const snapshot = parseSchemaDump(textInput);
        setStatusMsg(`Parsed schema dump: found ${snapshot.tables.length} tables, ${snapshot.policies.length} policies.`);
        onSnapshotLoaded(snapshot);
      } else if (activeTab === 'stats') {
        const stats = parseStatStatements(textInput);
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
      alert(`Error parsing input: ${err.message}`);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setTextInput(content);
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
            onClick={() => setActiveTab('studio')}
            className={`px-3 py-1.5 rounded-md transition-all ${
              activeTab === 'studio'
                ? 'bg-emerald-500 text-black font-semibold'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Studio Introspection JSON
          </button>
          <button
            onClick={() => setActiveTab('schema')}
            className={`px-3 py-1.5 rounded-md transition-all ${
              activeTab === 'schema'
                ? 'bg-emerald-500 text-black font-semibold'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            pg_dump Schema SQL
          </button>
          <button
            onClick={() => setActiveTab('stats')}
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
          onChange={(e) => setTextInput(e.target.value)}
          placeholder={
            activeTab === 'studio'
              ? 'Paste the JSON result from the read-only Supabase Studio Introspection Query here...'
              : activeTab === 'schema'
              ? 'Paste your schema.sql / pg_dump --schema-only output here...'
              : 'Paste your pg_stat_statements CSV or JSON export here...'
          }
          className="w-full h-44 bg-[#121212] border border-zinc-800 rounded-xl p-4 font-mono text-xs text-zinc-300 focus:outline-none focus:border-emerald-500/50 resize-y"
        />
      </div>

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
