import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'motion/react'
import {
  BookOpen,
  Brain,
  Clock,
  FileText,
  GraduationCap,
  Layers,
  MapPin,
  Pin,
  RefreshCw,
  Search,
} from 'lucide-react'

import { listAgents } from '../api/agents'
import {
  listCoreMemoryBlocks,
  listEpisodes,
  listNarratives,
  listPinnedSummaries,
  listSettlements,
} from '../api/memory'
import { getRetrievalTrace } from '../api/requests'
import { GlassCard } from '../components/ui/GlassCard'
import { EmptyState } from '../components/ui/EmptyState'
import { LoadingSpinner } from '../components/ui/LoadingSpinner'
import { PageHeader } from '../components/ui/PageHeader'
import { StatusBadge } from '../components/ui/StatusBadge'
import type {
  AgentItem,
  CoreMemoryBlock,
  EpisodeItem,
  NarrativeItem,
  PinnedSummary,
  SettlementItem,
} from '../contracts'
import { useOffline } from '../hooks/OfflineContext'
import { queryKeys } from '../query/keys'

/* ── Facet definitions ─────────────────────────────────────────────────── */

const FACETS = [
  { key: 'core-blocks', label: 'Core Blocks', icon: Brain },
  { key: 'episodes', label: 'Episodes', icon: Clock },
  { key: 'narratives', label: 'Narratives', icon: BookOpen },
  { key: 'settlements', label: 'Settlements', icon: Layers },
  { key: 'pinned-summaries', label: 'Pinned Summaries', icon: Pin },
  { key: 'retrieval-trace', label: 'Retrieval Trace', icon: Search },
] as const

type FacetKey = (typeof FACETS)[number]['key']

const VALID_FACETS = new Set<string>(FACETS.map((f) => f.key))

function isFacetKey(v: string | undefined): v is FacetKey {
  return v != null && VALID_FACETS.has(v)
}

/* ── Timestamp formatting ──────────────────────────────────────────────── */

function formatTs(unix: number): string {
  return new Date(unix * 1000).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/* ── Main component ────────────────────────────────────────────────────── */

export default function StudyPage() {
  const { agentId, facet: rawFacet } = useParams<{ agentId: string; facet: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { isOffline } = useOffline()

  const activeFacet: FacetKey = isFacetKey(rawFacet) ? rawFacet : 'core-blocks'
  const requestId = searchParams.get('request_id')

  /* ── Agent list ──────────────────────────────────────────────────────── */

  const agentsQuery = useQuery({
    queryKey: queryKeys.agents.list(),
    queryFn: listAgents,
    refetchInterval: 30_000,
  })

  const agents: readonly AgentItem[] = agentsQuery.data?.agents ?? []

  /* ── Navigate helpers ────────────────────────────────────────────────── */

  function selectAgent(id: string) {
    navigate(`/study/${encodeURIComponent(id)}/${activeFacet}`)
  }

  function selectFacet(key: FacetKey) {
    if (!agentId) return
    const base = `/study/${encodeURIComponent(agentId)}/${key}`
    if (key === 'retrieval-trace' && requestId) {
      navigate(`${base}?request_id=${encodeURIComponent(requestId)}`)
    } else {
      navigate(base)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Study" subtitle="Memory inspection — core memory, episodes, narratives" />

      <div className="flex flex-col lg:flex-row gap-6">
        <div className="w-full lg:w-64 shrink-0">
          <GlassCard color="emerald">
            <div className="flex items-center gap-2 mb-4">
              <GraduationCap className="w-4 h-4 text-emerald-500" />
              <span className="text-sm font-bold text-emerald-600">
                {agents.length} Agent{agents.length === 1 ? '' : 's'}
              </span>
            </div>

            {agentsQuery.isLoading && (
              <div className="py-8">
                <LoadingSpinner />
              </div>
            )}

            {agentsQuery.isError && (
              <div className="text-xs text-red-500 py-4">Failed to load agents</div>
            )}

            {agentsQuery.isSuccess && agents.length === 0 && (
              <EmptyState
                icon={<GraduationCap className="w-6 h-6" />}
                message="No agents registered."
              />
            )}

            <div className="space-y-2 max-h-[60vh] lg:max-h-[70vh] overflow-y-auto">
              {agents.map((agent, i) => {
                const isActive = agentId === agent.id
                return (
                  <motion.button
                    key={agent.id}
                    type="button"
                    onClick={() => selectAgent(agent.id)}
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.04 }}
                    className={`w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all duration-200 cursor-pointer ${
                      isActive
                        ? 'bg-emerald-50/80 border-emerald-200 shadow-sm'
                        : 'bg-white/40 border-white/60 hover:bg-white/60 hover:border-emerald-100'
                    }`}
                  >
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm shrink-0 ${
                        isActive
                          ? 'bg-gradient-to-br from-emerald-300 to-teal-300 text-emerald-800'
                          : 'bg-gradient-to-br from-emerald-100 to-teal-100 text-emerald-600'
                      }`}
                    >
                      {agent.display_name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p
                        className={`text-xs font-bold truncate ${isActive ? 'text-emerald-700' : 'text-gray-700'}`}
                      >
                        {agent.display_name}
                      </p>
                      <p className="text-[10px] text-gray-400 truncate">{agent.role}</p>
                    </div>
                  </motion.button>
                )
              })}
            </div>
          </GlassCard>
        </div>

        <div className="flex-1 min-w-0 space-y-4">
          <div className="flex items-center gap-1 bg-white/30 backdrop-blur-sm rounded-2xl p-1 border border-white/60 overflow-x-auto">
            {FACETS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => selectFacet(tab.key)}
                disabled={!agentId}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl transition-all duration-200 whitespace-nowrap ${
                  activeFacet === tab.key
                    ? 'bg-white/70 text-emerald-600 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-white/30'
                } disabled:opacity-40 disabled:cursor-not-allowed`}
              >
                <tab.icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            ))}
          </div>

          {!agentId ? (
            <GlassCard color="emerald">
              <EmptyState
                icon={<GraduationCap className="w-8 h-8" />}
                message="Select an agent from the left to browse their memory."
              />
            </GlassCard>
          ) : (
            <AnimatePresence mode="wait">
              <motion.div
                key={`${agentId}-${activeFacet}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ type: 'spring', bounce: 0.2, duration: 0.35 }}
              >
                <FacetContent
                  agentId={agentId}
                  facet={activeFacet}
                  requestId={requestId}
                  isOffline={isOffline}
                />
              </motion.div>
            </AnimatePresence>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── Facet content dispatcher ──────────────────────────────────────────── */

function FacetContent({
  agentId,
  facet,
  requestId,
  isOffline,
}: {
  agentId: string
  facet: FacetKey
  requestId: string | null
  isOffline: boolean
}) {
  switch (facet) {
    case 'core-blocks':
      return <CoreBlocksFacet agentId={agentId} isOffline={isOffline} />
    case 'episodes':
      return <EpisodesFacet agentId={agentId} isOffline={isOffline} />
    case 'narratives':
      return <NarrativesFacet agentId={agentId} isOffline={isOffline} />
    case 'settlements':
      return <SettlementsFacet agentId={agentId} isOffline={isOffline} />
    case 'pinned-summaries':
      return <PinnedSummariesFacet agentId={agentId} isOffline={isOffline} />
    case 'retrieval-trace':
      return <RetrievalTraceFacet requestId={requestId} isOffline={isOffline} />
  }
}

/* ── Refresh button ────────────────────────────────────────────────────── */

function RefreshButton({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="p-1.5 rounded-xl text-gray-400 hover:text-emerald-500 hover:bg-emerald-50/50 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
      aria-label="Refresh"
    >
      <RefreshCw className="w-3.5 h-3.5" />
    </button>
  )
}

/* ── Core Blocks facet ─────────────────────────────────────────────────── */

function CoreBlocksFacet({ agentId, isOffline }: { agentId: string; isOffline: boolean }) {
  const query = useQuery({
    queryKey: queryKeys.memory.coreBlocks(agentId),
    queryFn: () => listCoreMemoryBlocks(agentId),
    refetchInterval: 30_000,
  })

  const blocks: readonly CoreMemoryBlock[] = query.data?.blocks ?? []

  return (
    <GlassCard color="emerald">
      <FacetHeader
        icon={<Brain className="w-4 h-4" />}
        label="Core Blocks"
        count={blocks.length}
        onRefresh={() => void query.refetch()}
        isOffline={isOffline}
      />

      {query.isLoading && <FacetLoading />}
      {query.isError && <FacetError />}
      {query.isSuccess && blocks.length === 0 && (
        <EmptyState icon={<Brain className="w-6 h-6" />} message="No core memory blocks." />
      )}

      {query.isSuccess && blocks.length > 0 && (
        <div className="space-y-3">
          {blocks.map((block, i) => (
            <motion.div
              key={block.label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="bg-white/50 border border-emerald-100/60 rounded-xl p-4"
            >
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-bold text-emerald-600 uppercase tracking-wider">
                  {block.label}
                </h4>
                <div className="flex items-center gap-2">
                  {block.read_only && <StatusBadge status="read-only" variant="neutral" />}
                  <span className="text-[10px] text-gray-400">
                    {String(block.chars_current)} / {String(block.chars_limit)} chars
                  </span>
                </div>
              </div>
              <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                {block.content}
              </p>
              <p className="text-[10px] text-gray-400 mt-2">{formatTs(block.updated_at)}</p>
            </motion.div>
          ))}
        </div>
      )}
    </GlassCard>
  )
}

/* ── Episodes facet ────────────────────────────────────────────────────── */

function EpisodesFacet({ agentId, isOffline }: { agentId: string; isOffline: boolean }) {
  const query = useQuery({
    queryKey: queryKeys.memory.episodes(agentId),
    queryFn: () => listEpisodes(agentId),
    refetchInterval: 30_000,
  })

  const items: readonly EpisodeItem[] = query.data?.items ?? []

  return (
    <GlassCard color="emerald">
      <FacetHeader
        icon={<Clock className="w-4 h-4" />}
        label="Episodes"
        count={items.length}
        onRefresh={() => void query.refetch()}
        isOffline={isOffline}
      />

      {query.isLoading && <FacetLoading />}
      {query.isError && <FacetError />}
      {query.isSuccess && items.length === 0 && (
        <EmptyState icon={<Clock className="w-6 h-6" />} message="No episodes recorded." />
      )}

      {query.isSuccess && items.length > 0 && (
        <div className="space-y-3">
          {items.map((ep, i) => (
            <motion.div
              key={`${String(ep.episode_id)}-${String(i)}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              className="bg-white/50 border border-emerald-100/60 rounded-xl p-4"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <StatusBadge status={ep.category} variant="info" />
                  {ep.location_text != null && (
                    <span className="text-[10px] text-gray-400 flex items-center gap-0.5">
                      <MapPin className="w-3 h-3" />
                      {ep.location_text}
                    </span>
                  )}
                </div>
                <span className="text-[10px] text-gray-400">{formatTs(ep.committed_time)}</span>
              </div>
              <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                {ep.summary}
              </p>
              {ep.private_notes != null && (
                <p className="text-xs text-gray-400 italic mt-2">{ep.private_notes}</p>
              )}
              <div className="flex items-center gap-3 mt-2 text-[10px] text-gray-400">
                <span>Settlement: {ep.settlement_id.slice(0, 12)}…</span>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </GlassCard>
  )
}

/* ── Narratives facet ──────────────────────────────────────────────────── */

function NarrativesFacet({ agentId, isOffline }: { agentId: string; isOffline: boolean }) {
  const query = useQuery({
    queryKey: queryKeys.memory.narratives(agentId),
    queryFn: () => listNarratives(agentId),
    refetchInterval: 30_000,
  })

  const items: readonly NarrativeItem[] = query.data?.items ?? []

  return (
    <GlassCard color="emerald">
      <FacetHeader
        icon={<BookOpen className="w-4 h-4" />}
        label="Narratives"
        count={items.length}
        onRefresh={() => void query.refetch()}
        isOffline={isOffline}
      />

      {query.isLoading && <FacetLoading />}
      {query.isError && <FacetError />}
      {query.isSuccess && items.length === 0 && (
        <EmptyState icon={<BookOpen className="w-6 h-6" />} message="No narratives." />
      )}

      {query.isSuccess && items.length > 0 && (
        <div className="space-y-3">
          {items.map((nar, i) => (
            <motion.div
              key={`${nar.scope}-${nar.scope_id}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="bg-white/50 border border-emerald-100/60 rounded-xl p-4"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <StatusBadge
                    status={nar.scope}
                    variant={nar.scope === 'world' ? 'success' : 'info'}
                  />
                  <span className="text-xs font-semibold text-gray-600">{nar.scope_id}</span>
                </div>
                <span className="text-[10px] text-gray-400">{formatTs(nar.updated_at)}</span>
              </div>
              <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                {nar.summary_text}
              </p>
            </motion.div>
          ))}
        </div>
      )}
    </GlassCard>
  )
}

/* ── Settlements facet ─────────────────────────────────────────────────── */

const SETTLEMENT_STATUS_VARIANT: Record<
  string,
  'success' | 'warning' | 'error' | 'info' | 'neutral'
> = {
  applied: 'success',
  pending: 'info',
  failed: 'error',
  claimed: 'warning',
}

function SettlementsFacet({ agentId, isOffline }: { agentId: string; isOffline: boolean }) {
  const query = useQuery({
    queryKey: queryKeys.memory.settlements(agentId),
    queryFn: () => listSettlements(agentId),
    refetchInterval: 30_000,
  })

  const items: readonly SettlementItem[] = query.data?.items ?? []

  return (
    <GlassCard color="emerald">
      <FacetHeader
        icon={<Layers className="w-4 h-4" />}
        label="Settlements"
        count={items.length}
        onRefresh={() => void query.refetch()}
        isOffline={isOffline}
      />

      {query.isLoading && <FacetLoading />}
      {query.isError && <FacetError />}
      {query.isSuccess && items.length === 0 && (
        <EmptyState icon={<Layers className="w-6 h-6" />} message="No settlements." />
      )}

      {query.isSuccess && items.length > 0 && (
        <div className="space-y-3">
          {items.map((s, i) => (
            <motion.div
              key={s.settlement_id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              className="bg-white/50 border border-emerald-100/60 rounded-xl p-4"
            >
              <div className="flex items-center justify-between mb-2">
                <code className="text-xs text-emerald-600/80 bg-emerald-50/60 px-2 py-0.5 rounded-lg">
                  {s.settlement_id.slice(0, 16)}…
                </code>
                <StatusBadge
                  status={s.status}
                  variant={SETTLEMENT_STATUS_VARIANT[s.status] ?? 'neutral'}
                />
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-gray-500">
                <span>Attempts: {String(s.attempt_count)}</span>
                <span>Created: {formatTs(s.created_at)}</span>
                {s.claimed_by != null && <span>Claimed by: {s.claimed_by}</span>}
                {s.claimed_at != null && <span>Claimed: {formatTs(s.claimed_at)}</span>}
                {s.applied_at != null && <span>Applied: {formatTs(s.applied_at)}</span>}
                {s.error_message != null && (
                  <span className="col-span-2 text-red-500">{s.error_message}</span>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </GlassCard>
  )
}

/* ── Pinned Summaries facet ────────────────────────────────────────────── */

function PinnedSummariesFacet({ agentId, isOffline }: { agentId: string; isOffline: boolean }) {
  const query = useQuery({
    queryKey: queryKeys.memory.pinnedSummaries(agentId),
    queryFn: () => listPinnedSummaries(agentId),
    refetchInterval: 30_000,
  })

  const summaries: readonly PinnedSummary[] = query.data?.summaries ?? []

  return (
    <GlassCard color="emerald">
      <FacetHeader
        icon={<Pin className="w-4 h-4" />}
        label="Pinned Summaries"
        count={summaries.length}
        onRefresh={() => void query.refetch()}
        isOffline={isOffline}
      />

      {query.isLoading && <FacetLoading />}
      {query.isError && <FacetError />}
      {query.isSuccess && summaries.length === 0 && (
        <EmptyState icon={<Pin className="w-6 h-6" />} message="No pinned summaries." />
      )}

      {query.isSuccess && summaries.length > 0 && (
        <div className="space-y-3">
          {summaries.map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="bg-white/50 border border-emerald-100/60 rounded-xl p-4"
            >
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-bold text-emerald-600 uppercase tracking-wider">
                  {s.label}
                </h4>
                <span className="text-[10px] text-gray-400">
                  {String(s.chars_current)} chars • {formatTs(s.updated_at)}
                </span>
              </div>
              <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                {s.content}
              </p>
            </motion.div>
          ))}
        </div>
      )}
    </GlassCard>
  )
}

/* ── Retrieval Trace facet ─────────────────────────────────────────────── */

function RetrievalTraceFacet({
  requestId,
  isOffline,
}: {
  requestId: string | null
  isOffline: boolean
}) {
  const query = useQuery({
    queryKey: queryKeys.requests.retrievalTrace(requestId ?? ''),
    queryFn: () => getRetrievalTrace(requestId!),
    enabled: requestId != null && requestId.length > 0,
    refetchInterval: 30_000,
  })

  if (!requestId || requestId.length === 0) {
    return (
      <GlassCard color="emerald">
        <div className="flex items-center gap-2 mb-4">
          <Search className="w-4 h-4 text-emerald-500" />
          <span className="text-sm font-bold text-emerald-600">Retrieval Trace</span>
        </div>
        <EmptyState
          icon={<Search className="w-8 h-8" />}
          message="Navigate here from a request in War Room or Grand Hall with a ?request_id= query parameter."
        />
      </GlassCard>
    )
  }

  const retrieval = query.data?.retrieval ?? null

  return (
    <GlassCard color="emerald">
      <FacetHeader
        icon={<Search className="w-4 h-4" />}
        label="Retrieval Trace"
        onRefresh={() => void query.refetch()}
        isOffline={isOffline}
      />

      <div className="mb-3">
        <code className="text-xs text-emerald-600/80 bg-emerald-50/60 px-2 py-1 rounded-lg">
          {requestId}
        </code>
      </div>

      {query.isLoading && <FacetLoading />}
      {query.isError && <FacetError />}

      {query.isSuccess && retrieval == null && (
        <EmptyState
          icon={<Search className="w-6 h-6" />}
          message="No retrieval trace data for this request."
        />
      )}

      {query.isSuccess && retrieval != null && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white/50 border border-emerald-100/60 rounded-xl p-4 space-y-4"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider">
                Query
              </span>
              <p className="text-gray-700 mt-1">{retrieval.query_string}</p>
            </div>
            <div>
              <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider">
                Strategy
              </span>
              <p className="text-gray-700 mt-1">{retrieval.strategy}</p>
            </div>
          </div>

          <div>
            <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider">
              Segments: {String(retrieval.segment_count)}
            </span>
          </div>

          {retrieval.narrative_facets_used.length > 0 && (
            <div>
              <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider block mb-1">
                Narrative Facets
              </span>
              <div className="flex flex-wrap gap-1.5">
                {retrieval.narrative_facets_used.map((f) => (
                  <span
                    key={f}
                    className="text-xs bg-emerald-50/80 text-emerald-600 px-2 py-0.5 rounded-lg border border-emerald-100"
                  >
                    {f}
                  </span>
                ))}
              </div>
            </div>
          )}

          {retrieval.cognition_facets_used.length > 0 && (
            <div>
              <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider block mb-1">
                Cognition Facets
              </span>
              <div className="flex flex-wrap gap-1.5">
                {retrieval.cognition_facets_used.map((f) => (
                  <span
                    key={f}
                    className="text-xs bg-teal-50/80 text-teal-600 px-2 py-0.5 rounded-lg border border-teal-100"
                  >
                    {f}
                  </span>
                ))}
              </div>
            </div>
          )}
        </motion.div>
      )}
    </GlassCard>
  )
}

/* ── Shared helpers ────────────────────────────────────────────────────── */

function FacetHeader({
  icon,
  label,
  count,
  onRefresh,
  isOffline,
}: {
  icon: React.ReactNode
  label: string
  count?: number | undefined
  onRefresh: () => void
  isOffline: boolean
}) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-2">
        <span className="text-emerald-500">{icon}</span>
        <span className="text-sm font-bold text-emerald-600">{label}</span>
        {count != null && <span className="text-xs text-gray-400">({String(count)})</span>}
      </div>
      <RefreshButton onClick={onRefresh} disabled={isOffline} />
    </div>
  )
}

function FacetLoading() {
  return (
    <div className="py-8">
      <LoadingSpinner />
    </div>
  )
}

function FacetError() {
  return (
    <GlassCard>
      <div className="flex items-center gap-2 text-red-500 text-sm">
        <FileText className="w-4 h-4" />
        <span>Failed to load data. The gateway may be unreachable.</span>
      </div>
    </GlassCard>
  )
}
