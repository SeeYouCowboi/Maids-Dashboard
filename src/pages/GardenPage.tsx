import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Bot, Briefcase, Cpu, Server, Settings, Trash2 } from 'lucide-react'
import { motion } from 'motion/react'
import { useState } from 'react'

import { listAgents } from '../api/agents'
import { listJobs } from '../api/jobs'
import { listProviders } from '../api/providers'
import { getRuntimeSnapshot } from '../api/runtime'
import { EmptyState } from '../components/ui/EmptyState'
import { GlassCard } from '../components/ui/GlassCard'
import { GlassSelect } from '../components/ui/GlassSelect'
import { LoadingSpinner } from '../components/ui/LoadingSpinner'
import { PageHeader } from '../components/ui/PageHeader'
import { StatusBadge } from '../components/ui/StatusBadge'
import type {
  AgentItem,
  AgentListResponse,
  JobListResponse,
  ProviderItem,
  ProviderListResponse,
  RuntimeSnapshot,
} from '../contracts'
import { useOffline } from '../hooks/OfflineContext'
import type { PollingInterval, ThemePref } from '../hooks/usePrefs'
import { usePrefs } from '../hooks/usePrefs'
import { queryKeys } from '../query/keys'

type GardenTab = 'jobs' | 'runtime' | 'providers' | 'agents' | 'prefs'

const TABS: readonly { id: GardenTab; label: string; icon: typeof Briefcase }[] = [
  { id: 'jobs', label: 'Jobs', icon: Briefcase },
  { id: 'runtime', label: 'Runtime', icon: Cpu },
  { id: 'providers', label: 'Providers', icon: Server },
  { id: 'agents', label: 'Agents', icon: Bot },
  { id: 'prefs', label: 'Preferences', icon: Settings },
] as const

const POLL_INTERVAL = 30_000

export default function GardenPage() {
  const [activeTab, setActiveTab] = useState<GardenTab>('jobs')
  const { isOffline } = useOffline()

  const jobsQuery = useQuery<JobListResponse, Error>({
    queryKey: queryKeys.jobs.list(),
    queryFn: listJobs,
    refetchInterval: POLL_INTERVAL,
    enabled: !isOffline,
  })

  const runtimeQuery = useQuery<RuntimeSnapshot, Error>({
    queryKey: queryKeys.runtime.snapshot(),
    queryFn: getRuntimeSnapshot,
    refetchInterval: POLL_INTERVAL,
    enabled: !isOffline,
  })

  const providersQuery = useQuery<ProviderListResponse, Error>({
    queryKey: queryKeys.providers.list(),
    queryFn: listProviders,
    refetchInterval: POLL_INTERVAL,
    enabled: !isOffline,
  })

  const agentsQuery = useQuery<AgentListResponse, Error>({
    queryKey: queryKeys.agents.list(),
    queryFn: listAgents,
    refetchInterval: POLL_INTERVAL,
    enabled: !isOffline,
  })

  return (
    <div className="space-y-6">
      <PageHeader title="Garden" subtitle="System data, runtime configuration, local preferences">
        {isOffline && <StatusBadge status="Offline — cached data" variant="warning" />}
      </PageHeader>

      {/* Tab bar */}
      <div className="flex items-center gap-1 bg-white/30 backdrop-blur-sm rounded-2xl p-1 border border-white/60 overflow-x-auto">
        {TABS.map((tab) => {
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl transition-all duration-200 whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-white/70 text-green-600 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-white/30'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      {activeTab === 'jobs' && <JobsTab query={jobsQuery} />}
      {activeTab === 'runtime' && <RuntimeTab query={runtimeQuery} />}
      {activeTab === 'providers' && <ProvidersTab query={providersQuery} />}
      {activeTab === 'agents' && <AgentsTab query={agentsQuery} />}
      {activeTab === 'prefs' && <PrefsTab />}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Jobs Tab                                                           */
/* ------------------------------------------------------------------ */

interface QueryProp<T> {
  query: ReturnType<typeof useQuery<T, Error>>
}

function JobsTab({ query }: QueryProp<JobListResponse>) {
  if (query.isLoading) return <Loading />
  if (query.isError) return <ErrorMsg message="Failed to load jobs" />

  const items = query.data?.items ?? []
  if (items.length === 0) {
    return (
      <GlassCard color="emerald">
        <EmptyState icon={<Briefcase className="w-8 h-8" />} message="No jobs in queue" />
      </GlassCard>
    )
  }

  return (
    <GlassCard title="Job Queue" color="emerald">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200/50 text-left">
              <th className="pb-2 pr-4 font-bold text-gray-500 text-xs uppercase tracking-wider">
                #
              </th>
              <th className="pb-2 pr-4 font-bold text-gray-500 text-xs uppercase tracking-wider">
                Job
              </th>
              <th className="pb-2 font-bold text-gray-500 text-xs uppercase tracking-wider">
                Data
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100/60">
            {items.map((item, i) => {
              const data = item as { id?: string | undefined } | null | undefined
              const jobId = data?.id
              return (
                <tr key={jobId ?? i} className="group">
                  <td className="py-2 pr-4 text-gray-400 font-mono text-xs">{i + 1}</td>
                  <td className="py-2 pr-4 font-medium text-gray-700 max-w-[200px] truncate">
                    {jobId ?? '—'}
                  </td>
                  <td className="py-2 text-gray-500 text-xs font-mono max-w-[400px] truncate">
                    {JSON.stringify(item)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </GlassCard>
  )
}

/* ------------------------------------------------------------------ */
/* Runtime Tab                                                        */
/* ------------------------------------------------------------------ */

function RuntimeTab({ query }: QueryProp<RuntimeSnapshot>) {
  if (query.isLoading) return <Loading />
  if (query.isError) return <ErrorMsg message="Failed to load runtime snapshot" />

  const rt = query.data
  if (!rt) return <ErrorMsg message="No runtime data" />

  return (
    <div className="space-y-4">
      <GlassCard title="Runtime Snapshot" color="emerald">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <KV label="Backend Type" value={rt.backend_type} />
          <KV label="Memory Pipeline Status" value={rt.memory_pipeline_status} />
          <KV
            label="Memory Pipeline Ready"
            value={rt.memory_pipeline_ready ? 'Yes' : 'No'}
            badge={rt.memory_pipeline_ready ? 'success' : 'warning'}
          />
          {rt.effective_organizer_embedding_model_id != null && (
            <KV label="Embedding Model" value={rt.effective_organizer_embedding_model_id} />
          )}
        </div>
      </GlassCard>

      <GlassCard title="Talker / Thinker" color="emerald">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <KV
            label="Enabled"
            value={rt.talker_thinker.enabled ? 'Yes' : 'No'}
            badge={rt.talker_thinker.enabled ? 'success' : 'neutral'}
          />
          <KV label="Staleness Threshold" value={String(rt.talker_thinker.staleness_threshold)} />
          <KV
            label="Soft Block Timeout"
            value={`${String(rt.talker_thinker.soft_block_timeout_ms)} ms`}
          />
          <KV
            label="Poll Interval"
            value={`${String(rt.talker_thinker.soft_block_poll_interval_ms)} ms`}
          />
          {rt.talker_thinker.global_concurrency_cap != null && (
            <KV label="Concurrency Cap" value={String(rt.talker_thinker.global_concurrency_cap)} />
          )}
        </div>
      </GlassCard>

      <GlassCard title="Orchestration" color="emerald">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <KV
            label="Enabled"
            value={rt.orchestration.enabled ? 'Yes' : 'No'}
            badge={rt.orchestration.enabled ? 'success' : 'neutral'}
          />
          <KV label="Role" value={rt.orchestration.role} />
          <KV
            label="Durable Mode"
            value={rt.orchestration.durable_mode ? 'Yes' : 'No'}
            badge={rt.orchestration.durable_mode ? 'info' : 'neutral'}
          />
          <KV
            label="Lease Reclaim"
            value={rt.orchestration.lease_reclaim_active ? 'Active' : 'Inactive'}
            badge={rt.orchestration.lease_reclaim_active ? 'success' : 'neutral'}
          />
        </div>
      </GlassCard>

      <GlassCard title="Gateway" color="emerald">
        <KV label="CORS Origins" value={rt.gateway.cors_allowed_origins.join(', ') || '(none)'} />
      </GlassCard>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Providers Tab                                                      */
/* ------------------------------------------------------------------ */

function ProvidersTab({ query }: QueryProp<ProviderListResponse>) {
  if (query.isLoading) return <Loading />
  if (query.isError) return <ErrorMsg message="Failed to load providers" />

  const providers = query.data?.providers ?? []
  if (providers.length === 0) {
    return (
      <GlassCard color="emerald">
        <EmptyState icon={<Server className="w-8 h-8" />} message="No providers configured" />
      </GlassCard>
    )
  }

  return (
    <div className="space-y-4">
      {providers.map((p, i) => (
        <ProviderCard key={p.id} provider={p} index={i} />
      ))}
    </div>
  )
}

function ProviderCard({ provider: p, index }: { provider: ProviderItem; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', bounce: 0.3, duration: 0.6, delay: index * 0.05 }}
    >
      <GlassCard color="emerald">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-green-200 to-emerald-200 flex items-center justify-center font-bold text-green-600 text-xs shrink-0">
              {p.display_name.charAt(0).toUpperCase()}
            </div>
            <div>
              <h4 className="text-sm font-bold text-gray-800">{p.display_name}</h4>
              <p className="text-[10px] text-gray-500 font-mono">{p.id}</p>
            </div>
          </div>
          <StatusBadge
            status={p.configured ? 'Configured' : 'Not Configured'}
            variant={p.configured ? 'success' : 'warning'}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <KV label="Transport" value={p.transport_family} />
          <KV label="API Kind" value={p.api_kind} />
          <KV label="Risk Tier" value={p.risk_tier} />
          <KV label="Base URL" value={p.base_url} />
          <KV label="Auth Modes" value={p.auth_modes.join(', ') || '(none)'} />
          <KV
            label="Enabled by Default"
            value={p.selection_policy.enabled_by_default ? 'Yes' : 'No'}
          />
          <KV
            label="Auto Fallback"
            value={p.selection_policy.eligible_for_auto_fallback ? 'Yes' : 'No'}
          />
          <KV label="Auto Default" value={p.selection_policy.is_auto_default ? 'Yes' : 'No'} />
          {p.default_chat_model_id != null && (
            <KV label="Default Chat Model" value={p.default_chat_model_id} />
          )}
          {p.default_embedding_model_id != null && (
            <KV label="Default Embedding Model" value={p.default_embedding_model_id} />
          )}
        </div>

        {p.models.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
              Models ({p.models.length})
            </p>
            <div className="space-y-1.5">
              {p.models.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center gap-2 bg-white/40 rounded-lg px-3 py-1.5 text-xs"
                >
                  <span className="font-medium text-gray-700 truncate flex-1">
                    {m.display_name}
                  </span>
                  <span className="text-gray-400 font-mono shrink-0">
                    ctx:{m.context_window.toLocaleString()}
                  </span>
                  {m.supports_tools && (
                    <span className="bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded text-[10px] font-semibold">
                      tools
                    </span>
                  )}
                  {m.supports_vision && (
                    <span className="bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded text-[10px] font-semibold">
                      vision
                    </span>
                  )}
                  {m.supports_embedding && (
                    <span className="bg-emerald-100 text-emerald-600 px-1.5 py-0.5 rounded text-[10px] font-semibold">
                      embed
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </GlassCard>
    </motion.div>
  )
}

/* ------------------------------------------------------------------ */
/* Agents Tab                                                         */
/* ------------------------------------------------------------------ */

function AgentsTab({ query }: QueryProp<AgentListResponse>) {
  if (query.isLoading) return <Loading />
  if (query.isError) return <ErrorMsg message="Failed to load agents" />

  const agents = query.data?.agents ?? []
  if (agents.length === 0) {
    return (
      <GlassCard color="emerald">
        <EmptyState icon={<Bot className="w-8 h-8" />} message="No agents configured" />
      </GlassCard>
    )
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {agents.map((agent, i) => (
        <AgentCard key={agent.id} agent={agent} index={i} />
      ))}
    </div>
  )
}

function AgentCard({ agent, index }: { agent: AgentItem; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', bounce: 0.3, duration: 0.6, delay: index * 0.05 }}
    >
      <GlassCard color="emerald">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-green-200 to-emerald-200 flex items-center justify-center font-bold text-green-600 text-xs shrink-0">
            {agent.display_name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <h4 className="text-sm font-bold text-gray-800 truncate">{agent.display_name}</h4>
            <p className="text-[10px] text-gray-500 font-mono truncate">{agent.id}</p>
          </div>
          <StatusBadge
            status={agent.lifecycle}
            variant={agent.lifecycle === 'active' ? 'success' : 'neutral'}
          />
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <KV label="Role" value={agent.role} />
          <KV label="Output Mode" value={agent.output_mode} />
          <KV label="Model" value={agent.model_id} />
          <KV label="User Facing" value={agent.user_facing ? 'Yes' : 'No'} />
          <KV label="Lorebook" value={agent.lorebook_enabled ? 'Enabled' : 'Disabled'} />
          <KV
            label="Narrative Ctx"
            value={agent.narrative_context_enabled ? 'Enabled' : 'Disabled'}
          />
          {agent.persona_id != null && <KV label="Persona" value={agent.persona_id} />}
          {agent.max_output_tokens != null && (
            <KV label="Max Output Tokens" value={agent.max_output_tokens.toLocaleString()} />
          )}
          {agent.context_budget != null && (
            <KV
              label="Context Budget"
              value={`${agent.context_budget.max_tokens.toLocaleString()} tokens`}
            />
          )}
        </div>

        {agent.tool_permissions.length > 0 && (
          <div className="mt-3">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">
              Tool Permissions
            </p>
            <div className="flex flex-wrap gap-1">
              {agent.tool_permissions.map((tp) => (
                <span
                  key={tp.tool_name}
                  className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                    tp.allowed ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-500'
                  }`}
                >
                  {tp.tool_name}
                </span>
              ))}
            </div>
          </div>
        )}
      </GlassCard>
    </motion.div>
  )
}

/* ------------------------------------------------------------------ */
/* Local Preferences Tab                                              */
/* ------------------------------------------------------------------ */

function PrefsTab() {
  const prefs = usePrefs()
  const [draftApiBase, setDraftApiBase] = useState(prefs.apiBaseOverride)

  const handleSaveApiBase = () => {
    prefs.setApiBaseOverride(draftApiBase.trim())
  }

  return (
    <div className="space-y-4">
      {/* Theme */}
      <GlassCard title="Theme" color="emerald">
        <label htmlFor="theme-select" className="block text-xs font-semibold text-gray-500 mb-1.5">
          Appearance
        </label>
        <GlassSelect
          id="theme-select"
          color="emerald"
          className="w-full sm:w-64"
          value={prefs.theme}
          onChange={(v) => prefs.setTheme(v as ThemePref)}
          options={[
            { value: 'system', label: 'System', description: 'Follow OS preference' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
        <p className="text-[10px] text-gray-400 mt-1">
          Visual theme preference. Changes may require a page reload to fully apply.
        </p>
      </GlassCard>

      {/* Polling Interval */}
      <GlassCard title="Polling Interval" color="emerald">
        <label
          htmlFor="polling-select"
          className="block text-xs font-semibold text-gray-500 mb-1.5"
        >
          Refresh frequency for system data
        </label>
        <GlassSelect
          id="polling-select"
          color="emerald"
          className="w-full sm:w-64"
          value={String(prefs.pollingInterval)}
          onChange={(v) => prefs.setPollingInterval(Number(v) as PollingInterval)}
          options={[
            { value: '15', label: '15 seconds' },
            { value: '30', label: '30 seconds' },
            { value: '60', label: '60 seconds' },
          ]}
        />
      </GlassCard>

      {/* API Base Override */}
      <GlassCard title="API Base Override" color="emerald">
        <label
          htmlFor="api-base-input"
          className="block text-xs font-semibold text-gray-500 mb-1.5"
        >
          Override the default gateway URL (advanced)
        </label>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            id="api-base-input"
            type="text"
            value={draftApiBase}
            onChange={(e) => setDraftApiBase(e.target.value)}
            placeholder="(using default)"
            className="flex-1 bg-white/60 backdrop-blur-sm border border-white/80 rounded-xl px-3 py-2 text-sm text-gray-700 font-mono focus:outline-none focus:border-green-300 focus:ring-2 focus:ring-green-100 transition-all"
          />
          <button
            type="button"
            onClick={handleSaveApiBase}
            className="px-5 py-2 text-sm font-bold text-white bg-gradient-to-r from-green-400 to-emerald-500 rounded-xl shadow-sm hover:shadow-md transition-all"
          >
            Save
          </button>
        </div>
        <p className="text-[10px] text-gray-400 mt-1">
          {prefs.apiBaseOverride.length > 0
            ? `Current override: ${prefs.apiBaseOverride}`
            : 'No override set — using VITE_API_BASE or default.'}
        </p>
      </GlassCard>

      {/* Reset */}
      <GlassCard color="red">
        <div className="flex items-start gap-3">
          <div className="shrink-0 mt-0.5 p-2 rounded-lg bg-red-100 text-red-500">
            <AlertTriangle className="w-4 h-4" />
          </div>
          <div className="flex-1">
            <h4 className="text-sm font-bold text-red-600 mb-1">Danger Zone</h4>
            <p className="text-xs text-gray-500 mb-3">
              Clear all local dashboard state (mc: keys). This will remove your saved preferences
              and reload the page.
            </p>
            <button
              type="button"
              onClick={prefs.resetAll}
              className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-white bg-gradient-to-r from-red-400 to-red-500 rounded-xl shadow-sm hover:shadow-md hover:from-red-500 hover:to-red-600 transition-all"
            >
              <Trash2 className="w-4 h-4" />
              Reset Local State
            </button>
          </div>
        </div>
      </GlassCard>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Shared Helpers                                                     */
/* ------------------------------------------------------------------ */

function KV({
  label,
  value,
  badge,
}: {
  label: string
  value: string
  badge?: 'success' | 'warning' | 'error' | 'info' | 'neutral' | undefined
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{label}</span>
      {badge != null ? (
        <StatusBadge status={value} variant={badge} />
      ) : (
        <span className="text-sm font-medium text-gray-700 break-all">{value}</span>
      )}
    </div>
  )
}

function Loading() {
  return (
    <GlassCard color="emerald">
      <div className="py-12">
        <LoadingSpinner />
      </div>
    </GlassCard>
  )
}

function ErrorMsg({ message }: { message: string }) {
  return (
    <GlassCard color="red">
      <div className="flex items-center gap-2 text-sm text-red-600">
        <AlertTriangle className="w-4 h-4" />
        {message}
      </div>
    </GlassCard>
  )
}
