import { useState, useEffect, useCallback } from 'react';
import { BarChart3, RefreshCw, ChevronDown, ChevronRight, Activity } from 'lucide-react';
import { motion } from 'motion/react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  BarChart, Bar, ResponsiveContainer, Legend,
} from 'recharts';
import { GlassCard, LoadingSpinner, EmptyState, StatusBadge } from '../components/ui';
import { apiGet } from '../lib/api';
import { useSSEEvent } from '../hooks';

interface MetricsSummary {
  active_sessions: number;
  cron_errors: number;
  delivery_failures: number;
  events_per_kind: Record<string, number>;
}

interface EventItem {
  id: number;
  ts_ms: number;
  kind: string;
  payload: unknown;
}

interface EventsResponse {
  events: EventItem[];
  count: number;
}

interface DispatchIncident {
  agent_id?: string;
  reason?: string;
  suggestion?: string;
  severity?: string;
}

interface DispatchResponse {
  incidents: DispatchIncident[];
  count: number;
  disclaimer?: string;
}

export default function ObservatoryPage() {
  const [metrics, setMetrics] = useState<MetricsSummary | null>(null);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [incidents, setIncidents] = useState<DispatchIncident[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedEvents, setExpandedEvents] = useState<Set<number>>(new Set());

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [m, e, d] = await Promise.allSettled([
        apiGet<MetricsSummary>('/api/v1/metrics/summary'),
        apiGet<EventsResponse>('/api/v1/events?limit=50'),
        apiGet<DispatchResponse>('/api/v1/dispatch/incidents'),
      ]);
      if (m.status === 'fulfilled') setMetrics(m.value);
      if (e.status === 'fulfilled') setEvents(e.value.events ?? []);
      if (d.status === 'fulfilled') setIncidents(d.value.incidents ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);
  useSSEEvent('metrics_update', fetchAll);
  useSSEEvent('event_index_updated', () => {
    apiGet<EventsResponse>('/api/v1/events?limit=50')
      .then(data => setEvents(data.events ?? []))
      .catch(() => {});
  });

  function toggleEvent(id: number) {
    setExpandedEvents(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Prepare chart data from events_per_kind
  const kindChartData = metrics
    ? Object.entries(metrics.events_per_kind).map(([kind, count]) => ({ kind: kind.replace(/_/g, ' '), count }))
    : [];

  // Events timeline chart data (by hour buckets)
  const now = Date.now();
  const hourBuckets: Record<string, number> = {};
  events.forEach(e => {
    const hoursAgo = Math.floor((now - e.ts_ms) / 3600000);
    const label = `${hoursAgo}h ago`;
    hourBuckets[label] = (hourBuckets[label] ?? 0) + 1;
  });
  const timelineData = Object.entries(hourBuckets)
    .slice(0, 12)
    .reverse()
    .map(([time, count]) => ({ time, count }));

  if (loading) return <div className="flex items-center justify-center py-24"><LoadingSpinner /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-emerald-100 rounded-2xl">
            <BarChart3 className="w-6 h-6 text-emerald-500" />
          </div>
          <div>
            <h2 className="text-3xl font-black text-gray-800">Observatory</h2>
            <p className="text-gray-500 font-medium mt-0.5">Metrics · Events · Diagnostics</p>
          </div>
        </div>
        <button
          onClick={fetchAll}
          className="p-3 bg-white/60 rounded-2xl shadow-sm hover:shadow-md transition-all duration-300 text-gray-500 hover:text-emerald-500 border border-white/80"
        >
          <RefreshCw className="w-5 h-5" />
        </button>
      </div>

      {/* Health metric cards */}
      {metrics && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Active Sessions', value: metrics.active_sessions, color: 'emerald', ok: metrics.active_sessions >= 0 },
            { label: 'Cron Errors', value: metrics.cron_errors, color: 'amber', ok: metrics.cron_errors === 0 },
            { label: 'Delivery Failures', value: metrics.delivery_failures, color: 'red', ok: metrics.delivery_failures === 0 },
            { label: 'Event Kinds', value: Object.keys(metrics.events_per_kind).length, color: 'blue', ok: true },
          ].map(({ label, value, color, ok }) => (
            <motion.div
              key={label}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              className={`bg-white/40 backdrop-blur-xl border border-white/60 rounded-2xl p-5 hover:shadow-md transition-all duration-300`}
            >
              <p className="text-xs font-bold text-gray-500 mb-2">{label}</p>
              <p className={`text-3xl font-black text-${color}-600`}>{value}</p>
              <div className="mt-2">
                <StatusBadge
                  status={ok ? 'OK' : 'Alert'}
                  variant={ok ? 'success' : 'warning'}
                />
              </div>
            </motion.div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Event timeline chart */}
        <GlassCard title="Event Activity (last 12h buckets)" color="emerald">
          {timelineData.length === 0 ? (
            <EmptyState icon={<Activity className="w-8 h-8" />} message="No event data available." />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={timelineData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="emeraldGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" />
                <XAxis dataKey="time" tick={{ fontSize: 11, fill: '#6b7280' }} />
                <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} />
                <Tooltip
                  contentStyle={{ background: 'rgba(255,255,255,0.8)', backdropFilter: 'blur(8px)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.6)' }}
                />
                <Area type="monotone" dataKey="count" stroke="#10b981" fill="url(#emeraldGrad)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </GlassCard>

        {/* Events per kind bar chart */}
        <GlassCard title="Events by Kind (24h)" color="emerald">
          {kindChartData.length === 0 ? (
            <EmptyState icon={<BarChart3 className="w-8 h-8" />} message="No event kind data." />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={kindChartData} margin={{ top: 10, right: 10, left: -20, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" />
                <XAxis dataKey="kind" tick={{ fontSize: 10, fill: '#6b7280' }} angle={-30} textAnchor="end" />
                <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} />
                <Tooltip
                  contentStyle={{ background: 'rgba(255,255,255,0.8)', backdropFilter: 'blur(8px)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.6)' }}
                />
                <Bar dataKey="count" fill="#10b981" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </GlassCard>
      </div>

      {/* Event timeline list */}
      <GlassCard title="Event Timeline" color="emerald">
        {events.length === 0 ? (
          <EmptyState icon={<Activity className="w-8 h-8" />} message="No events recorded." />
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
            {events.map(event => {
              const expanded = expandedEvents.has(event.id);
              return (
                <motion.div
                  key={event.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="bg-white/50 rounded-2xl border border-white/70 overflow-hidden"
                >
                  <button
                    onClick={() => toggleEvent(event.id)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/40 transition-colors"
                  >
                    {expanded ? <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />}
                    <span className="text-xs font-mono text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-lg shrink-0">
                      {event.kind}
                    </span>
                    <span className="text-xs text-gray-500 ml-auto whitespace-nowrap">
                      {new Date(event.ts_ms).toLocaleTimeString()}
                    </span>
                  </button>
                  {expanded && (
                    <div className="px-4 pb-3">
                      <pre className="text-xs font-mono text-gray-600 bg-white/60 rounded-xl p-3 overflow-x-auto whitespace-pre-wrap break-all">
                        {JSON.stringify(event.payload, null, 2)}
                      </pre>
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        )}
      </GlassCard>

      {/* Dispatch diagnostics */}
      <GlassCard title="Dispatch Diagnostics" color="emerald">
        {incidents.length === 0 ? (
          <EmptyState icon={<BarChart3 className="w-8 h-8" />} message="No dispatch incidents." />
        ) : (
          <div className="space-y-3">
            {incidents.slice(0, 10).map((inc, i) => (
              <div key={i} className="bg-white/50 rounded-2xl p-4 border border-white/70">
                <div className="flex items-center gap-2 mb-1">
                  {inc.agent_id && <span className="text-xs font-bold text-gray-700">{inc.agent_id}</span>}
                  {inc.severity && (
                    <StatusBadge
                      status={inc.severity}
                      variant={inc.severity === 'high' ? 'error' : inc.severity === 'medium' ? 'warning' : 'neutral'}
                    />
                  )}
                </div>
                {inc.reason && <p className="text-sm text-gray-600">{inc.reason}</p>}
                {inc.suggestion && <p className="text-xs text-emerald-600 mt-1">💡 {inc.suggestion}</p>}
              </div>
            ))}
            {incidents.length > 10 && (
              <p className="text-xs text-gray-400 text-center">+{incidents.length - 10} more incidents</p>
            )}
          </div>
        )}
      </GlassCard>
    </div>
  );
}
