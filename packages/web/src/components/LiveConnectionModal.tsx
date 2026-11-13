import React, { useState } from 'react';
import {
  DiagnosticReport,
  DiagnosticSnapshot,
} from '@sb-sniffer/core';
import {
  X,
  Radio,
  KeyRound,
  Server,
  Zap,
  Check,
  AlertCircle,
  Database,
  RefreshCw,
} from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onLiveConnected: (snapshot: DiagnosticSnapshot, report: DiagnosticReport) => void;
  isStreaming: boolean;
  setIsStreaming: (val: boolean) => void;
}

export const LiveConnectionModal: React.FC<Props> = ({
  isOpen,
  onClose,
  onLiveConnected,
  isStreaming,
  setIsStreaming,
}) => {
  const [connectMethod, setConnectMethod] = useState<'creds' | 'uri'>('creds');
  const [projectRef, setProjectRef] = useState('');
  const [password, setPassword] = useState('');
  const [region, setRegion] = useState('aws-0-ap-northeast-1');
  const [customRegion, setCustomRegion] = useState('');
  const [poolerMode, setPoolerMode] = useState<'pooler' | 'direct'>('pooler');
  const [connectionUri, setConnectionUri] = useState('');
  const [bridgeUrl, setBridgeUrl] = useState('http://localhost:3001');

  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  if (!isOpen) return null;

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setStatusMsg(null);

    try {
      const payload: any = {
        mode: poolerMode,
      };

      if (connectMethod === 'creds') {
        if (!projectRef.trim() || !password.trim()) {
          throw new Error('Please fill in both Project Reference and Database Password.');
        }
        payload.projectRef = projectRef.trim();
        payload.password = password.trim();
        payload.region = region === 'custom' ? customRegion.trim() : region;
      } else {
        if (!connectionUri.trim()) {
          throw new Error('Please enter your database connection URI.');
        }
        payload.connectionString = connectionUri.trim();
      }

      const res = await fetch(`${bridgeUrl}/api/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Connection failed.');
      }

      setStatusMsg({ type: 'success', text: 'Connected to live Supabase instance! Telemetry is active.' });
      onLiveConnected(data.snapshot, data.report);
      setIsStreaming(true);
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err: any) {
      setStatusMsg({
        type: 'error',
        text: `${err.message} (Tip: Run 'sb-sniffer serve' in terminal to run the local live bridge)`,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#18181b] border border-zinc-700/80 rounded-2xl max-w-lg w-full p-6 shadow-2xl relative flex flex-col font-sans">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-zinc-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Zap className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-zinc-100 flex items-center gap-2">
                Connect Live Supabase Workspace
              </h2>
              <p className="text-xs text-zinc-400">
                Real-time continuous analysis of ongoing database events
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-200 p-1.5 rounded-lg hover:bg-zinc-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleConnect} className="py-4 space-y-4 text-xs">
          {/* Method Selector */}
          <div className="flex bg-[#121214] p-1 rounded-xl border border-zinc-800 font-semibold">
            <button
              type="button"
              onClick={() => setConnectMethod('creds')}
              className={`flex-1 py-1.5 rounded-lg transition ${
                connectMethod === 'creds'
                  ? 'bg-emerald-500 text-black shadow-md'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Project Ref + Password
            </button>
            <button
              type="button"
              onClick={() => setConnectMethod('uri')}
              className={`flex-1 py-1.5 rounded-lg transition ${
                connectMethod === 'uri'
                  ? 'bg-emerald-500 text-black shadow-md'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Direct Postgres URI
            </button>
          </div>

          {connectMethod === 'creds' ? (
            <div className="space-y-3">
              <div>
                <label className="block text-zinc-400 font-medium mb-1">
                  Supabase Project Reference
                </label>
                <input
                  type="text"
                  value={projectRef}
                  onChange={(e) => setProjectRef(e.target.value)}
                  placeholder="e.g. abcdefghijklmnopqrst"
                  className="w-full bg-[#121214] border border-zinc-700/60 rounded-lg px-3 py-2 text-zinc-200 font-mono text-xs focus:outline-none focus:border-emerald-500"
                />
                <span className="text-[10px] text-zinc-500">
                  Find in Supabase Dashboard URL: <code className="text-zinc-400">app.supabase.com/project/[ref]</code>
                </span>
              </div>

              <div>
                <label className="block text-zinc-400 font-medium mb-1">
                  Database Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Your database password"
                  className="w-full bg-[#121214] border border-zinc-700/60 rounded-lg px-3 py-2 text-zinc-200 font-mono text-xs focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-zinc-400 font-medium mb-1">AWS Region</label>
                  <select
                    value={region}
                    onChange={(e) => setRegion(e.target.value)}
                    className="w-full bg-[#121214] border border-zinc-700/60 rounded-lg px-2.5 py-2 text-zinc-300 text-xs focus:outline-none focus:border-emerald-500 font-mono"
                  >
                    <optgroup label="Asia Pacific">
                      <option value="aws-0-ap-northeast-1">aws-0-ap-northeast-1 (Tokyo)</option>
                      <option value="aws-0-ap-northeast-2">aws-0-ap-northeast-2 (Seoul)</option>
                      <option value="aws-0-ap-south-1">aws-0-ap-south-1 (Mumbai)</option>
                      <option value="aws-0-ap-southeast-1">aws-0-ap-southeast-1 (Singapore)</option>
                      <option value="aws-0-ap-southeast-2">aws-0-ap-southeast-2 (Sydney)</option>
                    </optgroup>
                    <optgroup label="North America">
                      <option value="aws-0-us-east-1">aws-0-us-east-1 (N. Virginia)</option>
                      <option value="aws-0-us-east-2">aws-0-us-east-2 (Ohio)</option>
                      <option value="aws-0-us-west-1">aws-0-us-west-1 (N. California)</option>
                      <option value="aws-0-us-west-2">aws-0-us-west-2 (Oregon)</option>
                      <option value="aws-0-ca-central-1">aws-0-ca-central-1 (Canada Central)</option>
                    </optgroup>
                    <optgroup label="Europe">
                      <option value="aws-0-eu-central-1">aws-0-eu-central-1 (Frankfurt)</option>
                      <option value="aws-0-eu-west-1">aws-0-eu-west-1 (Ireland)</option>
                      <option value="aws-0-eu-west-2">aws-0-eu-west-2 (London)</option>
                      <option value="aws-0-eu-west-3">aws-0-eu-west-3 (Paris)</option>
                      <option value="aws-0-eu-north-1">aws-0-eu-north-1 (Stockholm)</option>
                    </optgroup>
                    <optgroup label="South America">
                      <option value="aws-0-sa-east-1">aws-0-sa-east-1 (São Paulo)</option>
                    </optgroup>
                    <optgroup label="Custom">
                      <option value="custom">Custom Region Host...</option>
                    </optgroup>
                  </select>

                  {region === 'custom' && (
                    <div className="mt-2">
                      <input
                        type="text"
                        value={customRegion}
                        onChange={(e) => setCustomRegion(e.target.value)}
                        placeholder="e.g. ap-northeast-1 or aws-0-ap-northeast-1"
                        className="w-full bg-[#121214] border border-zinc-700/60 rounded-lg px-2.5 py-1.5 text-zinc-200 font-mono text-xs focus:outline-none focus:border-emerald-500"
                      />
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-zinc-400 font-medium mb-1">Port &amp; Pooler</label>
                  <select
                    value={poolerMode}
                    onChange={(e) => setPoolerMode(e.target.value as any)}
                    className="w-full bg-[#121214] border border-zinc-700/60 rounded-lg px-3 py-2 text-zinc-300 text-xs focus:outline-none focus:border-emerald-500"
                  >
                    <option value="pooler">Port 6543 (Supavisor Tx Mode)</option>
                    <option value="direct">Port 5432 (Direct Session Mode)</option>
                  </select>
                </div>
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-zinc-400 font-medium mb-1">
                PostgreSQL Connection URI
              </label>
              <textarea
                value={connectionUri}
                onChange={(e) => setConnectionUri(e.target.value)}
                placeholder="postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres"
                rows={3}
                className="w-full bg-[#121214] border border-zinc-700/60 rounded-lg p-3 text-zinc-200 font-mono text-xs focus:outline-none focus:border-emerald-500 resize-none"
              />
            </div>
          )}

          {/* Bridge URL Configuration */}
          <div className="pt-2 border-t border-zinc-800 flex items-center justify-between text-[11px] text-zinc-500">
            <span>Live Bridge Server:</span>
            <input
              type="text"
              value={bridgeUrl}
              onChange={(e) => setBridgeUrl(e.target.value)}
              className="bg-zinc-900 border border-zinc-800 rounded px-2 py-0.5 text-zinc-400 font-mono text-[10px] w-48 text-right focus:outline-none"
            />
          </div>

          {/* Status Message */}
          {statusMsg && (
            <div
              className={`p-3 rounded-lg text-xs flex items-start gap-2 ${
                statusMsg.type === 'success'
                  ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300'
                  : 'bg-rose-500/15 border border-rose-500/30 text-rose-300'
              }`}
            >
              {statusMsg.type === 'success' ? (
                <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              )}
              <span className="leading-relaxed">{statusMsg.text}</span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="pt-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[11px] text-zinc-400">Strict 10s Read-Only Timeout</span>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-black font-bold px-4 py-2 rounded-lg transition"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Connecting...</span>
                </>
              ) : (
                <>
                  <Zap className="w-3.5 h-3.5" />
                  <span>Start Live Analysis</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
