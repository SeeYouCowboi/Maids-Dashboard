import { useState, useEffect, useCallback } from 'react';
import { Flower2, RefreshCw, ToggleLeft, ToggleRight, Save, Settings } from 'lucide-react';
import { motion } from 'motion/react';
import { GlassCard, StatusBadge, EmptyState, LoadingSpinner } from '../components/ui';
import { ConfirmModal } from '../components/ui';
import { apiGet, apiPost } from '../lib/api';
import { useConfirmSecret } from '../contexts/ConfirmSecretContext';
import type { CronJob, CronSchedule } from '../lib/types';

interface CronResponse {
  jobs: (CronJob & { schedule?: CronSchedule | string; last_run?: string; enabled?: boolean; state_json?: string })[];
  last_run_summary?: Record<string, unknown>;
}

interface HeartbeatWorkspace {
  id: string;
  name: string;
  content?: string;
}

type GardenTab = 'cron' | 'heartbeat' | 'settings';

export default function GardenPage() {
  const [activeTab, setActiveTab] = useState<GardenTab>('cron');
  const [cronJobs, setCronJobs] = useState<CronJob[]>([]);
  const [cronLoading, setCronLoading] = useState(true);
  const [heartbeatContent, setHeartbeatContent] = useState('');
  const [heartbeatSaving, setHeartbeatSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingToggle, setPendingToggle] = useState<string | null>(null);
  const [toggleResult, setToggleResult] = useState<{ id: string; ok: boolean } | null>(null);
  const { secret, setSecret } = useConfirmSecret();

  const fetchCron = useCallback(async () => {
    setCronLoading(true);
    try {
      const data = await apiGet<CronResponse>('/api/v1/cron/jobs');
      const jobs = (data.jobs ?? []).map(j => ({
        id: j.id,
        name: j.name ?? j.id,
        enabled: j.enabled ?? true,
        schedule: j.schedule,
        last_run: j.last_run,
        next_run: j.next_run,
      }));
      setCronJobs(jobs);
    } catch {
      setCronJobs([]);
    } finally {
      setCronLoading(false);
    }
  }, []);

  useEffect(() => { fetchCron(); }, [fetchCron]);

  function handleToggleClick(jobId: string) {
    setPendingToggle(jobId);
    setConfirmOpen(true);
  }

  async function handleToggleConfirm(enteredSecret: string) {
    setSecret(enteredSecret);
    setConfirmOpen(false);
    if (!pendingToggle) return;
    const jobId = pendingToggle;
    setPendingToggle(null);
    try {
      await apiPost(`/api/v1/cron/jobs/${encodeURIComponent(jobId)}/toggle`, {});
      setToggleResult({ id: jobId, ok: true });
      fetchCron();
    } catch {
      setToggleResult({ id: jobId, ok: false });
    }
  }

  async function handleHeartbeatSave() {
    setHeartbeatSaving(true);
    try {
      await apiPost('/api/v1/heartbeat/update', { content: heartbeatContent });
    } finally {
      setHeartbeatSaving(false);
    }
  }

  const GARDEN_TABS: Array<{ id: GardenTab; label: string }> = [
    { id: 'cron', label: 'Cron Jobs' },
    { id: 'heartbeat', label: 'Heartbeat Editor' },
    { id: 'settings', label: 'Settings' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-3 bg-green-100 rounded-2xl">
          <Flower2 className="w-6 h-6 text-green-500" />
        </div>
        <div>
          <h2 className="text-3xl font-black text-gray-800">Garden</h2>
          <p className="text-gray-500 font-medium mt-0.5">Cron Jobs · Heartbeat · Settings</p>
        </div>
      </div>

      {/* Internal tabs */}
      <div className="flex gap-2 bg-white/40 backdrop-blur-xl border border-white/60 rounded-2xl p-1.5">
        {GARDEN_TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 py-2 px-4 rounded-xl text-sm font-semibold transition-all duration-200 ${activeTab === tab.id
                ? 'bg-white shadow-sm text-green-600'
                : 'text-gray-500 hover:text-gray-700'
              }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Cron Jobs tab */}
      {activeTab === 'cron' && (
        <GlassCard title="Cron Jobs" color="emerald">
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm text-gray-500">{cronJobs.length} job(s)</span>
            <button
              onClick={fetchCron}
              className="p-2 rounded-xl hover:bg-white/60 transition-colors text-gray-500 hover:text-green-500"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
          {cronLoading ? (
            <div className="flex justify-center py-6"><LoadingSpinner /></div>
          ) : cronJobs.length === 0 ? (
            <EmptyState icon={<Flower2 className="w-8 h-8" />} message="No cron jobs configured." />
          ) : (
            <div className="space-y-3">
              {cronJobs.map((job, i) => (
                <motion.div
                  key={job.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="flex items-center gap-4 bg-white/50 rounded-2xl p-4 border border-white/70"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-gray-800 truncate">{job.name}</p>
                    <div className="flex items-center gap-2 mt-1">
                      {job.schedule && (
                        <code className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-lg">
                          {typeof job.schedule === 'string'
                            ? job.schedule
                            : `${(job.schedule as CronSchedule).expr}${(job.schedule as CronSchedule).tz ? ` (${(job.schedule as CronSchedule).tz})` : ''}`}
                        </code>
                      )}
                      {job.last_run && (
                        <span className="text-xs text-gray-400">
                          Last: {new Date(job.last_run).toLocaleString()}
                        </span>
                      )}
                    </div>
                    {toggleResult?.id === job.id && (
                      <p className={`text-xs mt-1 ${toggleResult.ok ? 'text-emerald-600' : 'text-red-500'}`}>
                        {toggleResult.ok ? 'Toggled successfully' : 'Toggle failed'}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <StatusBadge
                      status={job.enabled ? 'enabled' : 'disabled'}
                      variant={job.enabled ? 'success' : 'neutral'}
                    />
                    <button
                      onClick={() => handleToggleClick(job.id)}
                      className={`p-1 rounded-xl transition-colors ${job.enabled ? 'text-green-500 hover:text-green-600' : 'text-gray-400 hover:text-gray-600'
                        }`}
                      title="Toggle job"
                    >
                      {job.enabled ? <ToggleRight className="w-8 h-8" /> : <ToggleLeft className="w-8 h-8" />}
                    </button>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </GlassCard>
      )}

      {/* Heartbeat Editor tab */}
      {activeTab === 'heartbeat' && (
        <GlassCard title="Heartbeat Editor" color="emerald">
          <div className="space-y-4">
            <p className="text-sm text-gray-500">Edit the heartbeat definition for proactive agent check-ins.</p>
            <textarea
              value={heartbeatContent}
              onChange={e => setHeartbeatContent(e.target.value)}
              rows={16}
              placeholder="# HEARTBEAT.md&#10;# Define periodic check intervals..."
              className="w-full bg-white/80 border-2 border-green-50 rounded-2xl px-4 py-3 font-mono text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:border-green-300 focus:ring-2 focus:ring-green-100 transition-all duration-300 resize-none"
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">
                {heartbeatContent.length.toLocaleString()} / 102,400 chars
              </span>
              <button
                onClick={handleHeartbeatSave}
                disabled={heartbeatSaving || heartbeatContent.length > 102400}
                className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-green-500 to-emerald-500 text-white font-semibold rounded-2xl hover:shadow-md hover:shadow-green-500/25 transition-all duration-300 disabled:opacity-60"
              >
                <Save className="w-4 h-4" />
                {heartbeatSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </GlassCard>
      )}

      {/* Settings tab */}
      {activeTab === 'settings' && (
        <div className="space-y-4">
          <GlassCard title="Work Settings" color="emerald">
            <div className="space-y-3">
              {[
                { label: 'Primary Model', value: 'deepseek-chat' },
                { label: 'Max Tokens', value: '32768' },
                { label: 'Temperature', value: '0.7' },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between py-2.5 border-b border-white/60 last:border-0">
                  <span className="text-sm font-semibold text-gray-700">{label}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-500 font-mono">{value}</span>
                    <StatusBadge status="View Only" variant="neutral" />
                  </div>
                </div>
              ))}
            </div>
          </GlassCard>

          <GlassCard title="Quick Actions" color="emerald">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                { label: 'Backup', icon: Save, color: 'text-green-600' },
                { label: 'Settings', icon: Settings, color: 'text-blue-600' },
                { label: 'Refresh', icon: RefreshCw, color: 'text-purple-600' },
              ].map(({ label, icon: Icon, color }) => (
                <button
                  key={label}
                  className="flex flex-col items-center gap-2 bg-white/60 rounded-2xl p-4 border border-white/80 hover:shadow-md hover:border-green-200 transition-all duration-300"
                >
                  <Icon className={`w-6 h-6 ${color}`} />
                  <span className="text-sm font-semibold text-gray-700">{label}</span>
                </button>
              ))}
            </div>
          </GlassCard>
        </div>
      )}

      <ConfirmModal
        isOpen={confirmOpen}
        title="Toggle Cron Job"
        onConfirm={handleToggleConfirm}
        onCancel={() => { setConfirmOpen(false); setPendingToggle(null); }}
      />
    </div>
  );
}
