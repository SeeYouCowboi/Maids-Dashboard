import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { RefreshCw, Users, Clock, Cpu } from 'lucide-react';
import { GlassCard, StatusBadge, EmptyState, LoadingSpinner } from '../components/ui';
import TranscriptDrawer from '../components/TranscriptDrawer';
import { apiGet } from '../lib/api';
import type { Maid, Session } from '../lib/types';
import { useSSEEvent } from '../hooks';

interface MaidsResponse { maids: Maid[] }
interface SessionsResponse { sessions: Session[] }

const STATUS_VARIANT = {
  work: 'info',
  rp: 'success',
  unknown: 'neutral',
} as const;

export default function GrandHallPage() {
  const [maids, setMaids] = useState<Maid[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMaid, setSelectedMaid] = useState<string | null>(null);
  const [openSession, setOpenSession] = useState<Session | null>(null);

  async function fetchData() {
    setLoading(true);
    setError(null);
    try {
      const [maidsData, sessionsData] = await Promise.all([
        apiGet<MaidsResponse>('/api/v1/maids'),
        apiGet<SessionsResponse>('/api/v1/sessions'),
      ]);
      setMaids(maidsData.maids ?? []);
      setSessions(sessionsData.sessions ?? []);
    } catch {
      setError('Failed to load data. Is the backend running?');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchData(); }, []);

  useSSEEvent('maid_update', () => { fetchData(); });
  useSSEEvent('session_update', () => { fetchData(); });

  const filteredSessions = selectedMaid
    ? sessions.filter(s => s.maid_id === selectedMaid)
    : sessions;

  if (loading) return <div className="flex items-center justify-center py-24"><LoadingSpinner /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-black text-gray-800">Grand Hall</h2>
          <p className="text-gray-500 font-medium mt-1">Manage your maids and sessions</p>
        </div>
        <button
          onClick={fetchData}
          className="p-3 bg-white/60 rounded-2xl shadow-sm hover:shadow-md transition-all duration-300 text-gray-500 hover:text-pink-500 border border-white/80"
        >
          <RefreshCw className="w-5 h-5" />
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-red-600 text-sm flex items-center gap-3">
          {error}
          <button onClick={fetchData} className="ml-auto text-red-500 hover:text-red-700 font-bold text-xs">Retry</button>
        </div>
      )}

      {/* Maids grid */}
      <GlassCard title="Maids" color="pink">
        <div className="flex items-center gap-2 mb-4">
          <Users className="w-4 h-4 text-pink-500" />
          <span className="text-sm text-gray-500">{maids.length} maid(s)</span>
          {selectedMaid && (
            <button
              onClick={() => setSelectedMaid(null)}
              className="ml-auto text-xs text-pink-500 hover:text-pink-700 font-semibold"
            >
              Show All Sessions
            </button>
          )}
        </div>
        {maids.length === 0 ? (
          <EmptyState icon={<Users className="w-8 h-8" />} message="No maids registered yet." />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {maids.map((maid, i) => (
              <motion.button
                key={maid.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05, type: 'spring', stiffness: 260, damping: 20 }}
                onClick={() => setSelectedMaid(prev => prev === maid.id ? null : maid.id)}
                className={`text-left bg-white/60 rounded-2xl p-4 border transition-all duration-300 hover:shadow-md ${selectedMaid === maid.id
                    ? 'border-pink-300 shadow-md shadow-pink-200/30'
                    : 'border-white/80 hover:border-pink-200'
                  }`}
              >
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-pink-200 to-purple-200 flex items-center justify-center font-bold text-pink-600 text-lg shrink-0">
                    {(maid.displayName ?? maid.name ?? maid.id).charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold text-gray-800 truncate">{maid.displayName ?? maid.name ?? maid.id}</p>
                    {maid.role && <p className="text-xs text-gray-500 truncate">{maid.role}</p>}
                  </div>
                </div>
                {maid.status && (
                  <StatusBadge
                    status={maid.status}
                    variant={STATUS_VARIANT[maid.status as keyof typeof STATUS_VARIANT] ?? 'neutral'}
                  />
                )}
              </motion.button>
            ))}
          </div>
        )}
      </GlassCard>

      {/* Sessions table */}
      <GlassCard title="Sessions" color="blue">
        <div className="flex items-center gap-2 mb-4">
          <Clock className="w-4 h-4 text-blue-500" />
          <span className="text-sm text-gray-500">
            {filteredSessions.length} session(s)
            {selectedMaid && ` for ${maids.find(m => m.id === selectedMaid)?.displayName ?? maids.find(m => m.id === selectedMaid)?.name ?? selectedMaid}`}
          </span>
        </div>
        {filteredSessions.length === 0 ? (
          <EmptyState icon={<Clock className="w-8 h-8" />} message="No sessions found." />
        ) : (
          <div className="overflow-x-auto rounded-2xl">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-white/60">
                  <th className="pb-3 pr-4 font-bold">Session Key</th>
                  <th className="pb-3 pr-4 font-bold">Maid</th>
                  <th className="pb-3 pr-4 font-bold">Updated</th>
                  <th className="pb-3 pr-4 font-bold">Model</th>
                  <th className="pb-3 font-bold">Tokens</th>
                </tr>
              </thead>
              <tbody>
                {filteredSessions.map((s, i) => (
                  <motion.tr
                    key={s.key}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.02 }}
                    onClick={() => setOpenSession(s)}
                    className="border-b border-white/40 hover:bg-white/40 cursor-pointer transition-colors duration-200"
                  >
                    <td className="py-3 pr-4">
                      <code className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-lg max-w-[180px] truncate block">
                        {s.key}
                      </code>
                    </td>
                    <td className="py-3 pr-4 text-gray-700 text-xs">
                      {maids.find(m => m.id === s.maid_id)?.displayName ?? maids.find(m => m.id === s.maid_id)?.name ?? s.maid_id ?? '—'}
                    </td>
                    <td className="py-3 pr-4 text-gray-500 text-xs whitespace-nowrap">
                      {s.updated_at ? new Date(s.updated_at).toLocaleString() : '—'}
                    </td>
                    <td className="py-3 pr-4">
                      {s.model ? (
                        <span className="flex items-center gap-1 text-xs text-gray-600">
                          <Cpu className="w-3 h-3" />
                          {s.model}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="py-3">
                      {s.has_tokens ? (
                        <StatusBadge status={`${s.token_count ?? '✓'}`} variant="success" />
                      ) : (
                        <span className="text-gray-400 text-xs">—</span>
                      )}
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      <TranscriptDrawer session={openSession} onClose={() => setOpenSession(null)} />
    </div>
  );
}
