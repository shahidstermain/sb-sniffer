import React, { useState } from 'react';
import { STUDIO_INTROSPECTION_SQL } from '@sb-sniffer/core';
import { X, Copy, Check, Terminal } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export const StudioSqlModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(STUDIO_INTROSPECTION_SQL);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#181818] border border-zinc-800 rounded-2xl max-w-3xl w-full p-6 shadow-2xl relative max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-zinc-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <Terminal className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-zinc-100">
                Supabase Studio Read-Only Introspection Query
              </h2>
              <p className="text-xs text-zinc-400">
                100% safe. Reads schema metadata & returns a single JSON object.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-200 p-1.5 rounded-lg hover:bg-zinc-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Instructions */}
        <div className="py-4 text-xs text-zinc-300 space-y-2">
          <p className="font-medium text-emerald-400">How to use:</p>
          <ol className="list-decimal list-inside space-y-1 text-zinc-400 pl-1">
            <li>Copy the read-only query below.</li>
            <li>
              Open your Supabase Project Dashboard → <span className="text-zinc-200">SQL Editor</span>.
            </li>
            <li>Paste and click <span className="text-zinc-200 font-medium">Run</span>.</li>
            <li>Copy the JSON cell result and paste it into the sniffer upload tab.</li>
          </ol>
        </div>

        {/* Query viewer */}
        <div className="flex-1 overflow-hidden flex flex-col">
          <div className="flex justify-end pb-2">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 text-xs bg-emerald-500 hover:bg-emerald-400 text-black font-semibold px-3 py-1.5 rounded-md transition-colors"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copied ? 'Copied to Clipboard!' : 'Copy Introspection SQL'}
            </button>
          </div>
          <pre className="p-4 bg-[#121212] border border-zinc-800 rounded-xl font-mono text-xs text-zinc-300 overflow-y-auto max-h-80 leading-relaxed">
            <code>{STUDIO_INTROSPECTION_SQL}</code>
          </pre>
        </div>
      </div>
    </div>
  );
};
