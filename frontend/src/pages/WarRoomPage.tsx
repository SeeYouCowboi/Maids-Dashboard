import { useState, useEffect, useCallback } from 'react';
import { Shield, RefreshCw, AlertTriangle, Package, Truck, Stethoscope } from 'lucide-react';
import { motion } from 'motion/react';
import { GlassCard, StatusBadge, EmptyState, LoadingSpinner } from '../components/ui';
import { apiGet, apiPost } from '../lib/api';
import type { Conflict } from '../lib/types';
import { useSSEEvent } from '../hooks';

interface DeliveryFailure {
  id: string;
  channel?: string;
  retry_count?: number;
  enqueued_at?: string;
}

interface ConflictsResponse { conflicts: Conflict[] }
interface FailuresResponse { failures: DeliveryFailure[] }

interface DispatchIncident {
  agent_id?: string;
  reason?: string;
  suggestion?: string;
  severity?: string;
}
interface DispatchResponse { incidents: DispatchIncident[]; count: number; disclaimer?: string }

const SEVERITY_VARIANT = {
  high: 'error',
  medium: 'warning',
  low: 'neutral',
} as const;

const RESOLUTION_OPTIONS = [
  { value: 'manual', label: 'Manual Review' },
  { value: 'accept_theirs', label: 'Accept Theirs' },
  { value: 'accept_ours', label: 'Accept Ours' },
  { value: 'merge', label: 'Auto Merge' },
];

export default function WarRoomPage() {
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [failures, setFailures] = useState<DeliveryFailure[]>([]);
  const [incidents, setIncidents] = useState<DispatchIncident[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedConflict, setSelectedConflict] = useState<Conflict | null>(null);
  const [resolution, setResolution] = useState('manual');
  const [resolving, setResolving] = useState(false);
  const [resolveResult, setResolveResult] = useState<{ ok: boolean; message?: string } | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [c, f, d] = await Promise.allSettled([
        apiGet<ConflictsResponse>('/api/v1/conflicts'),
        apiGet<FailuresResponse>('/api/v1/delivery/failures'),
        apiGet<DispatchResponse>('/api/v1/dispatch/incidents'),
      ]);
      if (c.status === 'fulfilled') setConflicts(c.value.conflicts ?? []);
      if (f.status === 'fulfilled') setFailures(f.value.failures ?? []);
      if (d.status === 'fulfilled') setIncidents(d.value.incidents ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);
  useSSEEvent('conflict_created', fetchAll);
  useSSEEvent('conflict_resolved', fetchAll);

  async function handleResolve() {
    if (!selectedConflict) return;
    setResolving(true);
    setResolveResult(null);
    try {
      await apiPost(`/api/v1/conflicts/${encodeURIComponent(selectedConflict.id)}/resolve`, {
        resolution,
      });
      setResolveResult({ ok: true, message: 'Conflict resolved successfully.' });
      fetchAll();
    } catch {
      setResolveResult({ ok: false, message: 'Failed to resolve conflict.' });
    } finally {
      setResolving(false);
    }
  }

  if (loading) return <div className="flex items-center justify-center py-24"><LoadingSpinner /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-red-100 rounded-2xl">
            <Shield className="w-6 h-6 text-red-500" />
          </div>
          <div>
            <h2 className="text-3xl font-black text-gray-800">War Room</h2>
            <p className="text-gray-500 font-medium mt-0.5">Conflicts · Failures · Diagnostics</p>
          </div>
        </div>
        <button
          onClick={fetchAll}
          className="p-3 bg-white/60 rounded-2xl shadow-sm hover:shadow-md transition-all duration-300 text-gray-500 hover:text-red-500 border border-white/80"
        >
          <RefreshCw className="w-5 h-5" />
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Conflicts */}
        <GlassCard title="Conflicts" color="red">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="w-4 h-4 text-red-500" />
            <span className="text-sm text-gray-500">{conflicts.length} conflict(s)</span>
          </div>
          {conflicts.length === 0 ? (
            <EmptyState icon={<AlertTriangle className="w-8 h-8" />} message="No conflicts. All clear!" />
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {conflicts.map((c, i) => (
                <motion.button
                  key={c.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04 }}
                  onClick={() => setSelectedConflict(prev => prev?.id === c.id ? null : c)}
                  className={`w-full text-left bg-white/50 rounded-2xl p-3 border transition-all duration-200 ${
                    selectedConflict?.id === c.id
                      ? 'border-red-300 shadow-md shadow-red-200/30'
                      : 'border-white/70 hover:border-red-200'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <StatusBadge
                      status={c.severity}
                      variant={SEVERITY_VARIANT[c.severity as keyof typeof SEVERITY_VARIANT] ?? 'neutral'}
                    />
                    {c.status && <StatusBadge status={c.status} variant="info" />}
                  </div>
                  {c.description && <p className="text-sm text-gray-700 line-clamp-2">{c.description}</p>}
                  <p className="text-xs text-gray-400 mt-1 font-mono">
                    {c.world_id}{c.branch_id ? `/${c.branch_id}` : ''}
                  </p>
                </motion.button>
              ))}
            </div>
          )}
        </GlassCard>

        {/* Delivery Failures */}
        <GlassCard title="Delivery Failures" color="red">
          <div className="flex items-center gap-2 mb-4">
            <Truck className="w-4 h-4 text-red-500" />
            <span className="text-sm text-gray-500">{failures.length} failure(s)</span>
          </div>
          {failures.length === 0 ? (
            <EmptyState icon={<Package className="w-8 h-8" />} message="No delivery failures." />
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {failures.map((f, i) => (
                <motion.div
                  key={f.id}
                  initial={{ opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="bg-white/50 rounded-2xl p-3 border border-white/70"
                >
                  <div className="flex items-center gap-2">
                    {f.channel && (
                      <span className="text-xs font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                        {f.channel}
                      </span>
                    )}
                    {f.retry_count !== undefined && f.retry_count > 0 && (
                      <span className="text-xs text-gray-500">retry #{f.retry_count}</span>
                    )}
                  </div>
                  <p className="text-xs font-mono text-gray-600 mt-1 truncate">{f.id}</p>
                  {f.enqueued_at && (
                    <p className="text-xs text-gray-400 mt-0.5">
                      {new Date(f.enqueued_at).toLocaleString()}
                    </p>
                  )}
                </motion.div>
              ))}
            </div>
          )}
        </GlassCard>

        {/* Diagnostics */}
        <GlassCard title="Dispatch Diagnostics" color="red">
          <div className="flex items-center gap-2 mb-4">
            <Stethoscope className="w-4 h-4 text-red-500" />
            <span className="text-sm text-gray-500">{incidents.length} incident(s)</span>
          </div>
          {incidents.length === 0 ? (
            <EmptyState icon={<Stethoscope className="w-8 h-8" />} message="No dispatch incidents." />
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {incidents.map((inc, i) => (
                <div key={i} className="bg-white/50 rounded-2xl p-3 border border-white/70">
                  <div className="flex items-center gap-2 mb-1">
                    {inc.agent_id && <span className="text-xs font-bold text-gray-700">{inc.agent_id}</span>}
                    {inc.severity && (
                      <StatusBadge
                        status={inc.severity}
                        variant={SEVERITY_VARIANT[inc.severity as keyof typeof SEVERITY_VARIANT] ?? 'neutral'}
                      />
                    )}
                  </div>
                  {inc.reason && <p className="text-sm text-gray-600">{inc.reason}</p>}
                  {inc.suggestion && <p className="text-xs text-red-600 mt-1">→ {inc.suggestion}</p>}
                </div>
              ))}
            </div>
          )}
        </GlassCard>

        {/* Merge Queue placeholder */}
        <GlassCard title="Merge Queue" color="red">
          <EmptyState icon={<Package className="w-8 h-8" />} message="No pending merges." />
        </GlassCard>
      </div>

      {/* Resolution panel */}
      <GlassCard title="Resolution Panel" color="red">
        {!selectedConflict ? (
          <p className="text-sm text-gray-500 italic">Select a conflict above to resolve it.</p>
        ) : (
          <div className="space-y-4">
            <div className="bg-white/60 rounded-2xl p-4 border border-red-100">
              <p className="text-sm font-bold text-gray-800">Selected Conflict</p>
              <p className="text-xs font-mono text-gray-600 mt-1">{selectedConflict.id}</p>
              {selectedConflict.description && (
                <p className="text-sm text-gray-600 mt-2">{selectedConflict.description}</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-600 mb-2">Resolution Method</label>
              <div className="grid grid-cols-2 gap-2">
                {RESOLUTION_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setResolution(opt.value)}
                    className={`py-2.5 px-4 rounded-2xl text-sm font-semibold transition-all duration-200 border ${
                      resolution === opt.value
                        ? 'bg-red-500 text-white border-red-500 shadow-md shadow-red-500/20'
                        : 'bg-white/60 text-gray-600 border-white/80 hover:border-red-200'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {resolveResult && (
              <div className={`rounded-2xl p-3 text-sm ${
                resolveResult.ok
                  ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
                  : 'bg-red-50 border border-red-200 text-red-600'
              }`}>
                {resolveResult.message}
              </div>
            )}

            <button
              onClick={handleResolve}
              disabled={resolving}
              className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-red-500 to-amber-500 text-white font-bold rounded-2xl hover:shadow-lg hover:shadow-red-500/25 transition-all duration-300 disabled:opacity-60"
            >
              <Shield className="w-4 h-4" />
              {resolving ? 'Resolving...' : 'Resolve Conflict'}
            </button>
          </div>
        )}
      </GlassCard>
    </div>
  );
}
