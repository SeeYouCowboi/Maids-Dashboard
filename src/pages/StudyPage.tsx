import { useCallback, useState } from 'react'
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'motion/react'
import {
  AlertTriangle,
  BookOpen,
  Brain,
  ChevronDown,
  ChevronRight,
  Clock,
  FileText,
  Filter,
  GraduationCap,
  Layers,
  Lightbulb,
  MapPin,
  Pin,
  RefreshCw,
  Search,
  Share2,
} from 'lucide-react'

import { listAgents } from '../api/agents'
import {
  listCognitionAssertions,
  listCognitionCommitments,
  listCognitionEvaluations,
} from '../api/cognition'
import type { CognitionListParams } from '../api/cognition'
import { listGraphNodes } from '../api/graph'
import {
  listCoreMemoryBlocks,
  listEpisodes,
  listNarratives,
  listPinnedSummaries,
  listSettlements,
} from '../api/memory'
import { getRetrievalTrace, listRecentRequests } from '../api/study'
import { CognitionHistoryDrawer } from '../components/CognitionHistoryDrawer'
import { GraphNodeDrawer } from '../components/GraphNodeDrawer'
import { GlassCard } from '../components/ui/GlassCard'
import { EmptyState } from '../components/ui/EmptyState'
import { LoadingSpinner } from '../components/ui/LoadingSpinner'
import { PageHeader } from '../components/ui/PageHeader'
import { StatusBadge } from '../components/ui/StatusBadge'
import type {
  AgentItem,
  AssertionItem,
  CommitmentItem,
  CoreMemoryBlock,
  EpisodeItem,
  EventNodeItem,
  EvaluationItem,
  NarrativeItem,
  PinnedSummary,
  RecentRequestItem,
  ResolvedEntityNode,
  SettlementItem,
} from '../contracts'
import { useOffline } from '../hooks/OfflineContext'
import { getLocal, setLocal } from '../lib/storage'
import { buildStudyUrl } from '../lib/studyUrls'
import type { FacetKey } from '../lib/studyUrls'
import { queryKeys } from '../query/keys'

/* ── Facet definitions ─────────────────────────────────────────────────── */

const FACETS = [
  { key: 'core-blocks', label: 'Core Blocks', icon: Brain },
  { key: 'episodes', label: 'Episodes', icon: Clock },
  { key: 'narratives', label: 'Narratives', icon: BookOpen },
  { key: 'settlements', label: 'Settlements', icon: Layers },
  { key: 'pinned-summaries', label: 'Pinned Summaries', icon: Pin },
  { key: 'retrieval-trace', label: 'Retrieval Trace', icon: Search },
  { key: 'cognition', label: 'Cognition', icon: Lightbulb },
  { key: 'graph', label: 'Graph', icon: Share2 },
] as const

const VALID_FACETS = new Set<string>(FACETS.map((f) => f.key))

function isFacetKey(v: string | undefined): v is FacetKey {
  return v != null && VALID_FACETS.has(v)
}

/* ── Timestamp formatting ──────────────────────────────────────────────── */

/** Format an epoch-ms timestamp into a short display string. */
function formatTs(epochMs: number): string {
  return new Date(epochMs).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Return ISO-8601 string for use in `dateTime` / `title` attributes. */
function toIso(epochMs: number): string {
  return new Date(epochMs).toISOString()
}

/* ── RP-only storage ───────────────────────────────────────────────────── */

const RP_ONLY_STORAGE_KEY = 'study:rp-only'
const RP_ONLY_STORAGE_VERSION = 1

interface VersionedBoolean {
  version: number
  data: boolean
}

function readRpOnly(): boolean {
  const raw = getLocal<VersionedBoolean>(RP_ONLY_STORAGE_KEY)
  if (
    raw !== null &&
    typeof raw === 'object' &&
    raw.version === RP_ONLY_STORAGE_VERSION &&
    typeof raw.data === 'boolean'
  ) {
    return raw.data
  }
  return false
}

function writeRpOnly(value: boolean): void {
  const payload: VersionedBoolean = { version: RP_ONLY_STORAGE_VERSION, data: value }
  setLocal(RP_ONLY_STORAGE_KEY, payload)
}

/* ── Main component ────────────────────────────────────────────────────── */

export default function StudyPage() {
  const { agentId, facet: rawFacet } = useParams<{ agentId: string; facet: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { isOffline } = useOffline()

  const activeFacet: FacetKey = isFacetKey(rawFacet) ? rawFacet : 'episodes'
  const requestId = searchParams.get('request_id')

  /* ── RP-only toggle state ────────────────────────────────────────────── */

  const [rpOnly, setRpOnlyRaw] = useState<boolean>(readRpOnly)

  const setRpOnly = useCallback((next: boolean) => {
    writeRpOnly(next)
    setRpOnlyRaw(next)
  }, [])

  /* ── Agent list ──────────────────────────────────────────────────────── */

  const agentsQuery = useQuery({
    queryKey: queryKeys.agents.list(),
    queryFn: listAgents,
    refetchInterval: 30_000,
  })

  const allAgents: readonly AgentItem[] = agentsQuery.data?.agents ?? []
  const agents: readonly AgentItem[] = rpOnly
    ? allAgents.filter((a) => a.role === 'rp_agent')
    : allAgents

  /* ── Navigate helpers ────────────────────────────────────────────────── */

  function selectAgent(id: string) {
    navigate(buildStudyUrl({ agentId: id, facet: activeFacet }))
  }

  function selectFacet(key: FacetKey) {
    if (!agentId) return
    navigate(
      buildStudyUrl({
        agentId,
        facet: key,
        request_id: key === 'retrieval-trace' ? requestId : null,
      }),
    )
  }

  const selectedAgentVisible = agentId != null && agents.some((a) => a.id === agentId)
  const effectiveAgentId = selectedAgentVisible ? agentId : undefined

  return (
    <div className="space-y-6">
      <PageHeader title="Study" subtitle="Memory inspection — core memory, episodes, narratives" />

      <div className="flex flex-col lg:flex-row gap-6">
        <div className="w-full lg:w-64 shrink-0">
          <GlassCard color="emerald">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <GraduationCap className="w-4 h-4 text-emerald-500" />
                <span className="text-sm font-bold text-emerald-600">
                  {agents.length} Agent{agents.length === 1 ? '' : 's'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setRpOnly(!rpOnly)}
                className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold transition-all duration-200 cursor-pointer ${
                  rpOnly
                    ? 'bg-emerald-100/80 text-emerald-700 border border-emerald-200'
                    : 'bg-white/40 text-gray-400 border border-white/60 hover:bg-white/60'
                }`}
                title="Show only RP agents"
              >
                <Filter className="w-3 h-3" />
                RP
              </button>
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
                const isActive = effectiveAgentId === agent.id
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
                disabled={!effectiveAgentId}
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

          {!effectiveAgentId ? (
            <GlassCard color="emerald">
              <EmptyState
                icon={<GraduationCap className="w-8 h-8" />}
                message="Select an agent from the left to browse their memory."
              />
            </GlassCard>
          ) : (
            <AnimatePresence mode="wait">
              <motion.div
                key={`${effectiveAgentId}-${activeFacet}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ type: 'spring', bounce: 0.2, duration: 0.35 }}
              >
                <FacetContent
                  agentId={effectiveAgentId}
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
  const [searchParams] = useSearchParams()
  const settlementId = searchParams.get('settlement_id')
  const tab = searchParams.get('tab')

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
      return <RetrievalTraceFacet agentId={agentId} requestId={requestId} isOffline={isOffline} />
    case 'cognition':
      return (
        <CognitionFacet
          agentId={agentId}
          requestId={requestId}
          settlementId={settlementId}
          tab={tab}
          isOffline={isOffline}
        />
      )
    case 'graph':
      return <GraphFacet agentId={agentId} isOffline={isOffline} />
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
              <div className="flex items-center gap-2 mt-2">
                <time
                  dateTime={toIso(block.updated_at)}
                  title={toIso(block.updated_at)}
                  className="text-[10px] text-gray-400"
                >
                  {formatTs(block.updated_at)}
                </time>
                {block.snapshot_source && (
                  <span
                    className="text-[10px] bg-emerald-50 text-emerald-600 border border-emerald-200/60 rounded px-1.5 py-0.5"
                    title={`Snapshot from ${block.snapshot_source}${block.snapshot_captured_at ? ` at ${toIso(block.snapshot_captured_at)}` : ''}`}
                  >
                    snapshot: {block.snapshot_source_id ?? block.snapshot_source}
                  </span>
                )}
              </div>
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
  const resolvedEntities = query.data?.entity_refs_resolved

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
                <time
                  dateTime={toIso(ep.committed_time)}
                  title={toIso(ep.committed_time)}
                  className="text-[10px] text-gray-400"
                >
                  {formatTs(ep.committed_time)}
                </time>
              </div>
              <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                {ep.summary}
              </p>
              {ep.private_notes != null && (
                <p className="text-xs text-gray-400 italic mt-2">{ep.private_notes}</p>
              )}
              <div className="flex items-center gap-3 mt-2 text-[10px] text-gray-400">
                <span>Settlement: {ep.settlement_id.slice(0, 12)}…</span>
                <EpisodeTraceChip agentId={agentId} requestId={ep.request_id} />
              </div>
              <EpisodeEntityChips episode={ep} resolvedEntities={resolvedEntities} />
            </motion.div>
          ))}
        </div>
      )}
    </GlassCard>
  )
}

function EpisodeEntityChips({
  episode,
  resolvedEntities,
}: {
  episode: EpisodeItem
  resolvedEntities?: Record<string, ResolvedEntityNode>
}) {
  const entityRefs = readEntityRefs(episode)
  if (entityRefs.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5 mt-2.5" data-testid="episode-entity-refs">
      {entityRefs.map((entityRef) => {
        const resolved = resolvedEntities?.[entityRef]
        const label = resolved?.display_name ?? entityRef
        const chipText =
          label.length > 28 ? `${label.slice(0, 16)}…${label.slice(-8)}` : label
        const titleText = resolved
          ? `${resolved.display_name} · ${entityRef} · ${resolved.entity_type}`
          : entityRef
        const chipClass = resolved
          ? 'inline-flex items-center text-[10px] font-medium text-emerald-700 bg-emerald-50/80 border border-emerald-200 rounded-full px-2 py-0.5'
          : 'inline-flex items-center text-[10px] font-medium text-teal-700 bg-teal-50/80 border border-teal-100 rounded-full px-2 py-0.5'
        return (
          <span
            key={`${String(episode.episode_id)}-${entityRef}`}
            className={chipClass}
            title={titleText}
            data-resolved={resolved ? 'true' : 'false'}
          >
            {chipText}
          </span>
        )
      })}
    </div>
  )
}

/** Compact request_id chip: teal link when present, gray disabled badge when legacy. */
function EpisodeTraceChip({
  agentId,
  requestId,
}: {
  agentId: string
  requestId: string | null | undefined
}) {
  if (requestId != null && requestId.length > 0) {
    return (
      <Link
        to={buildStudyUrl({ agentId, facet: 'retrieval-trace', request_id: requestId })}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-teal-50/80 text-teal-600 border border-teal-200/60 hover:bg-teal-100/80 hover:border-teal-300 transition-colors"
        data-testid="episode-trace-link"
        title={`Retrieval trace: ${requestId}`}
      >
        <Search className="w-2.5 h-2.5" />
        req: {requestId.slice(0, 8)}…
      </Link>
    )
  }

  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-gray-100/80 text-gray-400 border border-gray-200/60 cursor-not-allowed"
      data-testid="episode-trace-legacy"
      title="No request_id — legacy episode, trace unavailable"
    >
      legacy · no trace
    </span>
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
                <time
                  dateTime={toIso(nar.updated_at)}
                  title={toIso(nar.updated_at)}
                  className="text-[10px] text-gray-400"
                >
                  {formatTs(nar.updated_at)}
                </time>
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
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: queryKeys.memory.settlements(agentId),
    queryFn: () => listSettlements(agentId),
    refetchInterval: 30_000,
  })

  const items: readonly SettlementItem[] = query.data?.items ?? []

  const cachedEpisodes: readonly EpisodeItem[] =
    queryClient.getQueryData<{ items: EpisodeItem[] }>(queryKeys.memory.episodes(agentId))?.items ??
    []

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
            <SettlementRow
              key={s.settlement_id}
              settlement={s}
              agentId={agentId}
              index={i}
              cachedEpisodes={cachedEpisodes}
            />
          ))}
        </div>
      )}
    </GlassCard>
  )
}

function SettlementRow({
  settlement: s,
  agentId,
  index: i,
  cachedEpisodes,
}: {
  settlement: SettlementItem
  agentId: string
  index: number
  cachedEpisodes: readonly EpisodeItem[]
}) {
  const [expanded, setExpanded] = useState(false)

  const producedEpisodes = cachedEpisodes
    .filter((ep) => ep.settlement_id === s.settlement_id)
    .sort((a, b) => b.committed_time - a.committed_time)

  return (
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
        <StatusBadge status={s.status} variant={SETTLEMENT_STATUS_VARIANT[s.status] ?? 'neutral'} />
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs text-gray-500">
        <span>Attempts: {String(s.attempt_count)}</span>
        <span>
          Created:{' '}
          <time dateTime={toIso(s.created_at)} title={toIso(s.created_at)}>
            {formatTs(s.created_at)}
          </time>
        </span>
        {s.claimed_by != null && <span>Claimed by: {s.claimed_by}</span>}
        {s.claimed_at != null && (
          <span>
            Claimed:{' '}
            <time dateTime={toIso(s.claimed_at)} title={toIso(s.claimed_at)}>
              {formatTs(s.claimed_at)}
            </time>
          </span>
        )}
        {s.applied_at != null && (
          <span>
            Applied:{' '}
            <time dateTime={toIso(s.applied_at)} title={toIso(s.applied_at)}>
              {formatTs(s.applied_at)}
            </time>
          </span>
        )}
        {s.error_message != null && (
          <span className="col-span-2 text-red-500">{s.error_message}</span>
        )}
      </div>

      <div className="mt-3 border-t border-emerald-100/40 pt-2">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 text-[10px] font-semibold text-emerald-600/80 hover:text-emerald-700 transition-colors cursor-pointer"
          data-testid="settlement-episodes-toggle"
        >
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          Produced Episodes (current window)
          <span className="text-gray-400 font-normal">({String(producedEpisodes.length)})</span>
        </button>

        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              {producedEpisodes.length === 0 ? (
                <p className="text-[10px] text-gray-400 italic mt-2 pl-4">
                  No episodes in current window.
                </p>
              ) : (
                <div className="mt-2 space-y-2 pl-4" data-testid="settlement-episodes-list">
                  {producedEpisodes.map((ep) => (
                    <div
                      key={String(ep.episode_id)}
                      className="bg-white/40 border border-emerald-50/80 rounded-lg p-2.5"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <StatusBadge status={ep.category} variant="info" />
                        <time
                          dateTime={toIso(ep.committed_time)}
                          title={toIso(ep.committed_time)}
                          className="text-[10px] text-gray-400"
                        >
                          {formatTs(ep.committed_time)}
                        </time>
                      </div>
                      <p className="text-xs text-gray-600 leading-relaxed">{ep.summary}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <EpisodeTraceChip agentId={agentId} requestId={ep.request_id} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
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
                  {String(s.chars_current)} chars •{' '}
                  <time dateTime={toIso(s.updated_at)} title={toIso(s.updated_at)}>
                    {formatTs(s.updated_at)}
                  </time>
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
  agentId,
  requestId,
  isOffline,
}: {
  agentId: string
  requestId: string | null
  isOffline: boolean
}) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const retrievalSubtabRaw = searchParams.get('tab')
  const retrievalSubtab: 'summary' | 'walk' =
    retrievalSubtabRaw === 'walk' || retrievalSubtabRaw === 'summary'
      ? retrievalSubtabRaw
      : 'summary'

  /* Recent requests for this agent (shown when no request_id) */
  const recentQuery = useQuery({
    queryKey: queryKeys.study.recentRequests(agentId),
    queryFn: () => listRecentRequests(agentId),
    enabled: !requestId,
    refetchInterval: 30_000,
  })

  const recentItems: readonly RecentRequestItem[] = recentQuery.data?.items ?? []

  /* Retrieval trace for the selected request */
  const traceQuery = useQuery({
    queryKey: queryKeys.requests.retrievalTrace(requestId ?? ''),
    queryFn: () => getRetrievalTrace(requestId!),
    enabled: requestId != null && requestId.length > 0,
    refetchInterval: 30_000,
  })

  /* ── No request_id → show recent requests picker ───────────────────── */
  if (!requestId) {
    return (
      <GlassCard color="emerald">
        <FacetHeader
          icon={<Search className="w-4 h-4" />}
          label="Retrieval Trace"
          count={recentItems.length}
          onRefresh={() => void recentQuery.refetch()}
          isOffline={isOffline}
        />

        {recentQuery.isLoading && <FacetLoading />}
        {recentQuery.isError && <FacetError />}

        {recentQuery.isSuccess && recentItems.length === 0 && (
          <EmptyState
            icon={<Search className="w-6 h-6" />}
            message="No requests found for this agent"
          />
        )}

        {recentQuery.isSuccess && recentItems.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-gray-400 mb-2">
              Select a request to view its retrieval trace:
            </p>
            {recentItems.map((item, i) => (
              <motion.button
                key={item.request_id}
                type="button"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                onClick={() =>
                  navigate(
                    buildStudyUrl({
                      agentId,
                      facet: 'retrieval-trace',
                      request_id: item.request_id,
                    }),
                  )
                }
                className="w-full text-left bg-white/50 border border-emerald-100/60 rounded-xl p-3 hover:bg-emerald-50/40 hover:border-emerald-200/80 transition-all duration-200 cursor-pointer"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <code className="text-xs text-emerald-600/80 bg-emerald-50/60 px-2 py-0.5 rounded-lg">
                    {item.request_id.slice(0, 16)}…
                  </code>
                  <time
                    dateTime={toIso(item.captured_at)}
                    title={toIso(item.captured_at)}
                    className="text-[10px] text-gray-400"
                  >
                    {formatTs(item.captured_at)}
                  </time>
                </div>
                <div className="flex items-center gap-1.5">
                  {item.has_retrieval && <StatusBadge status="retrieval" variant="success" />}
                  {item.has_settlement && <StatusBadge status="settlement" variant="info" />}
                  {item.has_prompt && <StatusBadge status="prompt" variant="neutral" />}
                </div>
              </motion.button>
            ))}
          </div>
        )}
      </GlassCard>
    )
  }

  /* ── Has request_id → show trace detail ────────────────────────────── */
  const retrieval = traceQuery.data?.retrieval ?? null
  const navigator = retrieval?.navigator ?? null

  function selectRetrievalSubtab(nextTab: 'summary' | 'walk') {
    if (!requestId) return
    navigate(
      buildStudyUrl({
        agentId,
        facet: 'retrieval-trace',
        request_id: requestId,
        tab: nextTab,
      }),
    )
  }

  return (
    <GlassCard color="emerald">
      <FacetHeader
        icon={<Search className="w-4 h-4" />}
        label="Retrieval Trace"
        onRefresh={() => void traceQuery.refetch()}
        isOffline={isOffline}
      />

      <div className="flex items-center gap-2 mb-3">
        <button
          type="button"
          onClick={() => navigate(buildStudyUrl({ agentId, facet: 'retrieval-trace' }))}
          className="text-xs text-emerald-500 hover:text-emerald-700 transition-colors cursor-pointer"
        >
          ← Recent Requests
        </button>
        <code className="text-xs text-emerald-600/80 bg-emerald-50/60 px-2 py-0.5 rounded-lg">
          {requestId}
        </code>
      </div>

      <div className="flex items-center gap-1 bg-white/30 backdrop-blur-sm rounded-xl p-0.5 border border-white/50 w-fit mb-4">
        <button
          type="button"
          onClick={() => selectRetrievalSubtab('summary')}
          className={`px-3 py-1.5 text-xs font-semibold rounded-[10px] transition-all duration-200 ${
            retrievalSubtab === 'summary'
              ? 'bg-white/80 text-emerald-600 shadow-sm'
              : 'text-gray-500 hover:text-gray-700 hover:bg-white/30'
          }`}
          data-testid="retrieval-subtab-summary"
        >
          Summary
        </button>
        <button
          type="button"
          onClick={() => selectRetrievalSubtab('walk')}
          className={`px-3 py-1.5 text-xs font-semibold rounded-[10px] transition-all duration-200 ${
            retrievalSubtab === 'walk'
              ? 'bg-white/80 text-emerald-600 shadow-sm'
              : 'text-gray-500 hover:text-gray-700 hover:bg-white/30'
          }`}
          data-testid="retrieval-subtab-walk"
        >
          Walk
        </button>
      </div>

      {traceQuery.isLoading && <FacetLoading />}
      {traceQuery.isError && <FacetError />}

      {/* retrieval:null → dedicated empty state */}
      {traceQuery.isSuccess && retrieval == null && (
        <EmptyState
          icon={<Search className="w-6 h-6" />}
          message="No retrieval was captured for this request"
        />
      )}

      {traceQuery.isSuccess && retrieval != null && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white/50 border border-emerald-100/60 rounded-xl p-4 space-y-4"
        >
          {retrievalSubtab === 'summary' && (
            <>
              {/* Overview */}
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

              {/* Segments detail list */}
              {retrieval.segments != null && retrieval.segments.length > 0 && (
                <div>
                  <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider block mb-2">
                    Segment Details
                  </span>
                  <div className="space-y-2">
                    {retrieval.segments.map((seg, idx) => (
                      <div
                        key={`${seg.source}-${String(idx)}`}
                        className="bg-emerald-50/40 border border-emerald-100/50 rounded-lg p-3"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-semibold text-emerald-700">
                            {seg.source}
                          </span>
                          {seg.score != null && (
                            <span className="text-[10px] text-gray-400 tabular-nums">
                              score: {seg.score.toFixed(3)}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-600 leading-relaxed">
                          {seg.content.length > 200 ? `${seg.content.slice(0, 200)}…` : seg.content}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Narrative facets */}
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

              {/* Cognition facets */}
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

              {/* Navigator available indicator */}
              {navigator != null && (
                <div className="bg-teal-50/50 border border-teal-100/60 rounded-lg p-3">
                  <div className="flex items-center gap-2">
                    <MapPin className="w-3.5 h-3.5 text-teal-500" />
                    <span className="text-xs font-semibold text-teal-600">Navigator available</span>
                    <span className="text-[10px] text-gray-400">
                      {String(navigator.steps.length)} steps ·{' '}
                      {String(navigator.final_selection.length)} selected
                    </span>
                  </div>
                </div>
              )}
            </>
          )}

          {retrievalSubtab === 'walk' && (
            <>
              {navigator == null ? (
                <div className="py-4">
                  <EmptyState
                    icon={<MapPin className="w-5 h-5" />}
                    message="No navigator data available"
                  />
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider block mb-2">
                      Seeds
                    </span>
                    {navigator.seeds.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {navigator.seeds.map((seed) => (
                          <code
                            key={seed}
                            className="text-xs text-emerald-600 bg-emerald-50/80 px-2 py-0.5 rounded-lg border border-emerald-100"
                          >
                            {seed}
                          </code>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400">No seeds recorded.</p>
                    )}
                  </div>

                  <div>
                    <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider block mb-2">
                      Visited Steps
                    </span>
                    {navigator.steps.length > 0 ? (
                      <ol className="space-y-2 list-decimal list-inside">
                        {navigator.steps.map((step, idx) => (
                          <li
                            key={`${step.visited_ref}-${String(idx)}`}
                            className="bg-white/50 border border-emerald-100/60 rounded-lg p-3"
                          >
                            <div className="flex flex-wrap items-center gap-2 mb-1.5">
                              <span className="text-[10px] text-gray-400">
                                depth: {String(step.depth)}
                              </span>
                              <code className="text-xs text-emerald-700 bg-emerald-50/70 px-1.5 py-0.5 rounded">
                                {step.visited_ref}
                              </code>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 text-[10px] text-gray-500">
                              {step.via_ref && (
                                <span>
                                  via_ref:{' '}
                                  <code className="text-[10px] text-teal-600 bg-teal-50/70 px-1 py-0.5 rounded">
                                    {step.via_ref}
                                  </code>
                                </span>
                              )}
                              {step.via_relation && <span>via_relation: {step.via_relation}</span>}
                              {step.score != null && (
                                <span className="tabular-nums">score: {step.score.toFixed(3)}</span>
                              )}
                              {step.pruned !== undefined && (
                                <span>pruned: {step.pruned ?? 'null'}</span>
                              )}
                            </div>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="text-xs text-gray-400">No walk steps recorded.</p>
                    )}
                  </div>

                  <div>
                    <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider block mb-2">
                      Final Selection
                    </span>
                    {navigator.final_selection.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {navigator.final_selection.map((ref) => (
                          <code
                            key={ref}
                            className="text-xs text-white bg-gradient-to-r from-emerald-500 to-teal-500 px-2 py-0.5 rounded-lg"
                          >
                            {ref}
                          </code>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400">No final selections recorded.</p>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </motion.div>
      )}
    </GlassCard>
  )
}

/* ── Graph facet ───────────────────────────────────────────────────────── */

function GraphFacet({ agentId, isOffline }: { agentId: string; isOffline: boolean }) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const nodeRef = searchParams.get('node_ref')

  const query = useQuery({
    queryKey: queryKeys.graph.nodes(agentId, { limit: 50 }),
    queryFn: () => listGraphNodes(agentId, { limit: 50 }),
    refetchInterval: 30_000,
    retry: (failCount, error) => {
      if (error && 'status' in error && (error as { status: number }).status === 501) return false
      return failCount < 2
    },
  })

  const items: readonly EventNodeItem[] = query.data?.items ?? []
  const degraded = query.data?.viewer_context_degraded === true
  const sorted = [...items].sort((a, b) => b.timestamp - a.timestamp)

  const is501 =
    query.isError &&
    query.error &&
    'status' in query.error &&
    (query.error as { status: number }).status === 501

  function openNode(ref: string) {
    navigate(buildStudyUrl({ agentId, facet: 'graph', node_ref: ref }))
  }

  function closeDrawer() {
    navigate(buildStudyUrl({ agentId, facet: 'graph' }))
  }

  function drillIn(targetRef: string) {
    navigate(buildStudyUrl({ agentId, facet: 'graph', node_ref: targetRef }))
  }

  return (
    <>
      <GlassCard color="emerald">
        <FacetHeader
          icon={<Share2 className="w-4 h-4" />}
          label="Graph"
          count={items.length > 0 ? items.length : undefined}
          onRefresh={() => void query.refetch()}
          isOffline={isOffline}
        />

        {degraded && (
          <div
            className="flex items-center gap-2 mb-4 px-3 py-2 bg-amber-50/80 border border-amber-200/60 rounded-xl text-xs text-amber-700"
            data-testid="graph-degraded-banner"
          >
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>
              Viewer context degraded — visibility may be limited because session context is
              unavailable.
            </span>
          </div>
        )}

        {query.isLoading && <FacetLoading />}

        {is501 && (
          <EmptyState
            icon={<Share2 className="w-6 h-6" />}
            message="Graph inspection unavailable for this runtime mode."
          />
        )}

        {query.isError && !is501 && <FacetError />}

        {query.isSuccess && sorted.length === 0 && (
          <EmptyState icon={<Share2 className="w-6 h-6" />} message="No graph nodes recorded." />
        )}

        {query.isSuccess && sorted.length > 0 && (
          <div className="space-y-3" data-testid="graph-node-list">
            {sorted.map((node, i) => (
              <motion.button
                key={node.node_ref}
                type="button"
                onClick={() => openNode(node.node_ref)}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                className="w-full text-left bg-white/50 border border-emerald-100/60 rounded-xl p-4 hover:bg-emerald-50/40 hover:border-emerald-200/80 transition-all duration-200 cursor-pointer"
                data-testid="graph-node-card"
              >
                <div className="flex items-center justify-between mb-2">
                  <code className="text-xs text-emerald-600/80 bg-emerald-50/60 px-2 py-0.5 rounded-lg truncate max-w-[50%]">
                    {node.node_ref}
                  </code>
                  <div className="flex items-center gap-1.5">
                    <StatusBadge status={node.category} variant="info" />
                    <StatusBadge status={node.visibility_scope} variant="neutral" />
                  </div>
                </div>

                {node.summary && (
                  <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap line-clamp-3 mb-2">
                    {node.summary}
                  </p>
                )}

                <div className="flex items-center gap-3 text-[10px] text-gray-400 flex-wrap">
                  <time dateTime={toIso(node.timestamp)} title={toIso(node.timestamp)}>
                    {formatTs(node.timestamp)}
                  </time>
                  {node.participants && node.participants.length > 0 && (
                    <span>{node.participants.join(', ')}</span>
                  )}
                  {node.salience != null && (
                    <span className="tabular-nums">salience: {node.salience.toFixed(2)}</span>
                  )}
                  {node.centrality != null && (
                    <span className="tabular-nums">centrality: {node.centrality.toFixed(2)}</span>
                  )}
                  {node.bridge_score != null && (
                    <span className="tabular-nums">bridge: {node.bridge_score.toFixed(2)}</span>
                  )}
                </div>
              </motion.button>
            ))}
          </div>
        )}
      </GlassCard>

      {nodeRef != null && (
        <GraphNodeDrawer
          agentId={agentId}
          nodeRef={nodeRef}
          onClose={closeDrawer}
          onDrillIn={drillIn}
        />
      )}
    </>
  )
}

/* ── Cognition facet ────────────────────────────────────────────────────── */

type CognitionSubtab = 'assertions' | 'evaluations' | 'commitments'
const COGNITION_SUBTABS: readonly { key: CognitionSubtab; label: string }[] = [
  { key: 'assertions', label: 'Assertions' },
  { key: 'evaluations', label: 'Evaluations' },
  { key: 'commitments', label: 'Commitments' },
]

function isCognitionSubtab(v: string | null): v is CognitionSubtab {
  return v === 'assertions' || v === 'evaluations' || v === 'commitments'
}

function CognitionFacet({
  agentId,
  requestId,
  settlementId,
  tab,
  isOffline,
}: {
  agentId: string
  requestId: string | null
  settlementId: string | null
  tab: string | null
  isOffline: boolean
}) {
  const navigate = useNavigate()
  const activeTab: CognitionSubtab = isCognitionSubtab(tab) ? tab : 'assertions'
  const [historyKey, setHistoryKey] = useState<string | null>(null)

  const apiParams: CognitionListParams = {
    limit: 50,
    ...(requestId ? { request_id: requestId } : {}),
    ...(settlementId ? { settlement_id: settlementId } : {}),
  }

  function selectSubtab(key: CognitionSubtab) {
    navigate(
      buildStudyUrl({
        agentId,
        facet: 'cognition',
        tab: key,
        request_id: requestId,
        settlement_id: settlementId,
      }),
    )
  }

  return (
    <>
      <GlassCard color="emerald">
        <FacetHeader
          icon={<Lightbulb className="w-4 h-4" />}
          label="Cognition"
          onRefresh={() => {}}
          isOffline={isOffline}
        />

        <div className="flex items-center gap-1 bg-white/30 backdrop-blur-sm rounded-xl p-0.5 border border-white/50 w-fit mb-4">
          {COGNITION_SUBTABS.map((st) => (
            <button
              key={st.key}
              type="button"
              onClick={() => selectSubtab(st.key)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-[10px] transition-all duration-200 ${
                activeTab === st.key
                  ? 'bg-white/80 text-emerald-600 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-white/30'
              }`}
              data-testid={`cognition-subtab-${st.key}`}
            >
              {st.label}
            </button>
          ))}
        </div>

        {(requestId || settlementId) && (
          <div className="flex items-center gap-2 mb-3 text-[10px] text-gray-400">
            <span>Filtered by:</span>
            {requestId && (
              <code className="bg-teal-50/60 text-teal-600 px-1.5 py-0.5 rounded">
                req: {requestId.slice(0, 12)}…
              </code>
            )}
            {settlementId && (
              <code className="bg-teal-50/60 text-teal-600 px-1.5 py-0.5 rounded">
                stl: {settlementId.slice(0, 12)}…
              </code>
            )}
            <button
              type="button"
              onClick={() =>
                navigate(buildStudyUrl({ agentId, facet: 'cognition', tab: activeTab }))
              }
              className="text-emerald-500 hover:text-emerald-700 transition-colors cursor-pointer"
            >
              clear
            </button>
          </div>
        )}

        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
          >
            {activeTab === 'assertions' && (
              <AssertionsSubtab agentId={agentId} params={apiParams} onSelectKey={setHistoryKey} />
            )}
            {activeTab === 'evaluations' && (
              <EvaluationsSubtab agentId={agentId} params={apiParams} onSelectKey={setHistoryKey} />
            )}
            {activeTab === 'commitments' && (
              <CommitmentsSubtab agentId={agentId} params={apiParams} onSelectKey={setHistoryKey} />
            )}
          </motion.div>
        </AnimatePresence>
      </GlassCard>

      {historyKey != null && (
        <CognitionHistoryDrawer
          agentId={agentId}
          cognitionKey={historyKey}
          onClose={() => setHistoryKey(null)}
        />
      )}
    </>
  )
}

const POINTER_KIND_ALIASES: Record<string, string> = {
  person: 'char',
  character: 'char',
  npc: 'char',
  place: 'loc',
  location: 'loc',
  area: 'loc',
  thing: 'item',
  object: 'item',
}

function normalizePointerKey(raw: string): string {
  const s = raw.normalize('NFKC').trim()
  if (s.length === 0) return ''
  const colonIdx = s.indexOf(':')
  if (colonIdx === -1) return s.toLowerCase()
  const rawKind = s.slice(0, colonIdx).trim().toLowerCase()
  const body = s.slice(colonIdx + 1).trim()
  if (rawKind.length === 0 || body.length === 0) return ''
  const kind = POINTER_KIND_ALIASES[rawKind] ?? rawKind
  return `${kind}:${body.toLowerCase()}`
}

function readEntityRefs(item: unknown): string[] {
  if (item == null || typeof item !== 'object') return []
  const refs = (item as { entity_refs?: unknown }).entity_refs
  if (!Array.isArray(refs)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const ref of refs) {
    if (typeof ref !== 'string') continue
    const normalized = normalizePointerKey(ref)
    if (normalized.length === 0 || seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
  }
  return out
}

function AssertionsSubtab({
  agentId,
  params,
  onSelectKey,
}: {
  agentId: string
  params: CognitionListParams
  onSelectKey: (key: string) => void
}) {
  const query = useQuery({
    queryKey: queryKeys.cognition.assertions(agentId, params as Record<string, unknown>),
    queryFn: () => listCognitionAssertions(agentId, params),
    refetchInterval: 30_000,
  })

  const items: readonly AssertionItem[] = query.data?.items ?? []

  return (
    <>
      {query.isLoading && <FacetLoading />}
      {query.isError && <FacetError />}
      {query.isSuccess && items.length === 0 && (
        <EmptyState icon={<Lightbulb className="w-6 h-6" />} message="No assertions." />
      )}
      {query.isSuccess && items.length > 0 && (
        <div className="space-y-3">
          {items.map((item, i) => (
            <CognitionCard
              key={item.id}
              cognitionKey={item.cognition_key}
              content={item.content}
              stanceOrStatus={item.stance}
              label="stance"
              salience={item.salience}
              committedTime={item.committed_time}
              requestId={item.request_id}
              settlementId={item.settlement_id}
              entityRefs={readEntityRefs(item)}
              index={i}
              agentId={agentId}
              onSelect={() => onSelectKey(item.cognition_key)}
            />
          ))}
        </div>
      )}
    </>
  )
}

function EvaluationsSubtab({
  agentId,
  params,
  onSelectKey,
}: {
  agentId: string
  params: CognitionListParams
  onSelectKey: (key: string) => void
}) {
  const query = useQuery({
    queryKey: queryKeys.cognition.evaluations(agentId, params as Record<string, unknown>),
    queryFn: () => listCognitionEvaluations(agentId, params),
    refetchInterval: 30_000,
  })

  const items: readonly EvaluationItem[] = query.data?.items ?? []

  return (
    <>
      {query.isLoading && <FacetLoading />}
      {query.isError && <FacetError />}
      {query.isSuccess && items.length === 0 && (
        <EmptyState icon={<Lightbulb className="w-6 h-6" />} message="No evaluations." />
      )}
      {query.isSuccess && items.length > 0 && (
        <div className="space-y-3">
          {items.map((item, i) => (
            <CognitionCard
              key={item.id}
              cognitionKey={item.cognition_key}
              content={item.content}
              stanceOrStatus={item.status}
              label="status"
              salience={item.salience}
              committedTime={item.committed_time}
              requestId={item.request_id}
              settlementId={item.settlement_id}
              entityRefs={readEntityRefs(item)}
              index={i}
              agentId={agentId}
              onSelect={() => onSelectKey(item.cognition_key)}
            />
          ))}
        </div>
      )}
    </>
  )
}

function CommitmentsSubtab({
  agentId,
  params,
  onSelectKey,
}: {
  agentId: string
  params: CognitionListParams
  onSelectKey: (key: string) => void
}) {
  const query = useQuery({
    queryKey: queryKeys.cognition.commitments(agentId, params as Record<string, unknown>),
    queryFn: () => listCognitionCommitments(agentId, params),
    refetchInterval: 30_000,
  })

  const items: readonly CommitmentItem[] = query.data?.items ?? []

  return (
    <>
      {query.isLoading && <FacetLoading />}
      {query.isError && <FacetError />}
      {query.isSuccess && items.length === 0 && (
        <EmptyState icon={<Lightbulb className="w-6 h-6" />} message="No commitments." />
      )}
      {query.isSuccess && items.length > 0 && (
        <div className="space-y-3">
          {items.map((item, i) => (
            <CognitionCard
              key={item.id}
              cognitionKey={item.cognition_key}
              content={item.content}
              stanceOrStatus={item.status}
              label="status"
              salience={item.salience}
              committedTime={item.committed_time}
              requestId={item.request_id}
              settlementId={item.settlement_id}
              entityRefs={readEntityRefs(item)}
              index={i}
              agentId={agentId}
              onSelect={() => onSelectKey(item.cognition_key)}
            />
          ))}
        </div>
      )}
    </>
  )
}

function CognitionCard({
  agentId,
  cognitionKey,
  content,
  stanceOrStatus,
  label,
  salience,
  committedTime,
  requestId,
  settlementId,
  entityRefs,
  index,
  onSelect,
}: {
  agentId: string
  cognitionKey: string
  content: string
  stanceOrStatus: string
  label: string
  salience: number | undefined
  committedTime: number
  requestId: string | null | undefined
  settlementId: string | null | undefined
  entityRefs?: readonly string[]
  index: number
  onSelect: () => void
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
      className="w-full text-left bg-white/50 border border-emerald-100/60 rounded-xl p-4 hover:bg-emerald-50/40 hover:border-emerald-200/80 transition-all duration-200 cursor-pointer"
      data-testid="cognition-card"
    >
      <button type="button" onClick={onSelect} className="w-full text-left cursor-pointer">
        <div className="flex items-center justify-between mb-2">
          <code className="text-xs text-emerald-600/80 bg-emerald-50/60 px-2 py-0.5 rounded-lg truncate max-w-[60%]">
            {cognitionKey}
          </code>
          <div className="flex items-center gap-1.5">
            <StatusBadge status={stanceOrStatus} variant="info" />
            {salience != null && (
              <span className="text-[10px] text-gray-400 tabular-nums">
                salience: {salience.toFixed(2)}
              </span>
            )}
          </div>
        </div>
        <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap line-clamp-3">
          {content}
        </p>
        <div className="flex items-center gap-3 mt-2 text-[10px] text-gray-400">
          <span>
            {label}: {stanceOrStatus}
          </span>
          <time dateTime={toIso(committedTime)} title={toIso(committedTime)}>
            {formatTs(committedTime)}
          </time>
          {requestId && <span>req: {requestId.slice(0, 8)}…</span>}
          {settlementId && <span>stl: {settlementId.slice(0, 8)}…</span>}
        </div>
      </button>

      {entityRefs != null && entityRefs.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2.5" data-testid="cognition-entity-refs">
          {entityRefs.map((entityRef) => {
            const chipText =
              entityRef.length > 28 ? `${entityRef.slice(0, 16)}…${entityRef.slice(-8)}` : entityRef

            return (
              <Link
                key={`${cognitionKey}-${entityRef}`}
                to={buildStudyUrl({ agentId, facet: 'graph', node_ref: entityRef })}
                className="inline-flex items-center text-[10px] font-medium text-teal-700 bg-teal-50/80 hover:bg-teal-100/80 border border-teal-100 rounded-full px-2 py-0.5 transition-colors"
                title={entityRef}
              >
                {chipText}
              </Link>
            )
          })}
        </div>
      )}
    </motion.div>
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
