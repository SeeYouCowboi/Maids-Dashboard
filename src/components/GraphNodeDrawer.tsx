import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'motion/react'
import { AlertTriangle, ArrowRight, Share2, X } from 'lucide-react'
import { Link } from 'react-router-dom'

import { getGraphNodeDetail, listGraphNodeEdges } from '../api/graph'
import { buildStudyUrl } from '../lib/studyUrls'
import { LoadingSpinner } from './ui/LoadingSpinner'
import { EmptyState } from './ui/EmptyState'
import { StatusBadge } from './ui/StatusBadge'
import type { GraphEdgeItem } from '../contracts'
import { queryKeys } from '../query/keys'

/** Format an epoch-ms timestamp into a short display string. */
function formatTs(epochMs: number): string {
  return new Date(epochMs).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function toIso(epochMs: number): string {
  return new Date(epochMs).toISOString()
}

/** Render a 0–1 score as a small colored bar. */
function ScoreBar({ label, value }: { label: string; value: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100)
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-gray-400 w-16 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-emerald-300 to-teal-400 rounded-full transition-all duration-500"
          style={{ width: `${String(pct)}%` }}
        />
      </div>
      <span className="text-[10px] text-gray-400 tabular-nums w-8 text-right">
        {value.toFixed(2)}
      </span>
    </div>
  )
}

const EDGE_GROUPS: readonly { key: string; label: string }[] = [
  { key: 'logic', label: 'Logic' },
  { key: 'semantic', label: 'Semantic' },
  { key: 'memory', label: 'Memory' },
]

const COGNITION_LINKED_RELATIONS = new Set([
  'supports',
  'conflicts_with',
  'derived_from',
  'resolved_by',
  'downgraded_by',
])

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function readEdgeInteropMeta(edge: GraphEdgeItem): {
  edgeType: string | null
  relation: string | null
  requestId: string | null
  settlementId: string | null
} {
  const ext = edge as GraphEdgeItem & {
    edge_type?: unknown
    relation?: unknown
    request_id?: unknown
    settlement_id?: unknown
    context?: {
      request_id?: unknown
      settlement_id?: unknown
    }
  }

  const context = ext.context

  return {
    edgeType: asNonEmptyString(ext.edge_type) ?? asNonEmptyString(ext.relation_type),
    relation: asNonEmptyString(ext.relation),
    requestId: asNonEmptyString(context?.request_id) ?? asNonEmptyString(ext.request_id),
    settlementId: asNonEmptyString(context?.settlement_id) ?? asNonEmptyString(ext.settlement_id),
  }
}

function groupEdges(edges: readonly GraphEdgeItem[]): Record<string, GraphEdgeItem[]> {
  const groups: Record<string, GraphEdgeItem[]> = {}
  for (const edge of edges) {
    const key = edge.relation_type
    if (!groups[key]) groups[key] = []
    groups[key].push(edge)
  }
  return groups
}

export function GraphNodeDrawer({
  agentId,
  nodeRef,
  onClose,
  onDrillIn,
}: {
  agentId: string
  nodeRef: string
  onClose: () => void
  onDrillIn: (targetRef: string) => void
}) {
  const detailQuery = useQuery({
    queryKey: queryKeys.graph.nodeDetail(agentId, nodeRef),
    queryFn: () => getGraphNodeDetail(agentId, nodeRef),
    retry: (failCount, error) => {
      if (error && 'status' in error && (error as { status: number }).status === 404) return false
      return failCount < 2
    },
  })

  const edgesQuery = useQuery({
    queryKey: queryKeys.graph.nodeEdges(agentId, nodeRef),
    queryFn: () => listGraphNodeEdges(agentId, nodeRef),
    retry: (failCount, error) => {
      if (error && 'status' in error && (error as { status: number }).status === 404) return false
      return failCount < 2
    },
  })

  const node = detailQuery.data?.node
  const edges: readonly GraphEdgeItem[] = edgesQuery.data?.items ?? []
  const grouped = groupEdges(edges)

  const is404 =
    detailQuery.isError &&
    detailQuery.error &&
    'status' in detailQuery.error &&
    (detailQuery.error as { status: number }).status === 404
  const is501 =
    detailQuery.isError &&
    detailQuery.error &&
    'status' in detailQuery.error &&
    (detailQuery.error as { status: number }).status === 501

  return (
    <AnimatePresence>
      {/* Backdrop */}
      <motion.div
        key="graph-drawer-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px]"
        onClick={onClose}
        data-testid="graph-drawer-backdrop"
      />

      {/* Drawer */}
      <motion.aside
        key="graph-drawer"
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', bounce: 0.15, duration: 0.4 }}
        className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-md bg-white/95 backdrop-blur-xl border-l border-emerald-100/80 shadow-2xl flex flex-col"
        data-testid="graph-node-drawer"
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-emerald-100/60">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-bold text-emerald-700 truncate">Graph Node</h3>
            <code className="text-[11px] text-emerald-500/80 bg-emerald-50/60 px-2 py-0.5 rounded-lg inline-block mt-1 max-w-full truncate">
              {nodeRef}
            </code>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-gray-400 hover:text-red-500 hover:bg-red-50/60 transition-all cursor-pointer"
            aria-label="Close drawer"
            data-testid="graph-drawer-close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
          {/* Loading */}
          {detailQuery.isLoading && (
            <div className="py-12">
              <LoadingSpinner />
            </div>
          )}

          {/* 404 — node unavailable */}
          {is404 && (
            <div className="py-8" data-testid="graph-node-unavailable">
              <EmptyState
                icon={<AlertTriangle className="w-6 h-6" />}
                message="Node unavailable — it may have been removed or is not accessible."
              />
            </div>
          )}

          {/* 501 — graph inspection unavailable */}
          {is501 && (
            <div className="py-8" data-testid="graph-node-unsupported">
              <EmptyState
                icon={<Share2 className="w-6 h-6" />}
                message="Graph inspection unavailable for this runtime mode."
              />
            </div>
          )}

          {/* Generic error (not 404/501) */}
          {detailQuery.isError && !is404 && !is501 && (
            <div className="text-xs text-red-500 py-4" data-testid="graph-node-error">
              Failed to load graph node.
            </div>
          )}

          {/* Success — node detail */}
          {detailQuery.isSuccess && node && (
            <div className="space-y-5">
              {/* Summary / raw text */}
              {node.summary && (
                <div>
                  <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider block mb-1">
                    Summary
                  </span>
                  <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                    {node.summary}
                  </p>
                </div>
              )}
              {node.raw_text && (
                <div>
                  <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider block mb-1">
                    Raw Text
                  </span>
                  <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap bg-gray-50/50 border border-gray-100 rounded-lg p-3">
                    {node.raw_text}
                  </p>
                </div>
              )}

              {/* Metadata row */}
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={node.category} variant="info" />
                <StatusBadge status={node.visibility_scope} variant="neutral" />
                <time
                  dateTime={toIso(node.timestamp)}
                  title={toIso(node.timestamp)}
                  className="text-[10px] text-gray-400"
                >
                  {formatTs(node.timestamp)}
                </time>
              </div>

              {/* Participants */}
              {node.participants && node.participants.length > 0 && (
                <div>
                  <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider block mb-1">
                    Participants
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {node.participants.map((p) => (
                      <span
                        key={p}
                        className="text-xs bg-emerald-50/80 text-emerald-600 px-2 py-0.5 rounded-lg border border-emerald-100"
                      >
                        {p}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Entity refs */}
              {node.entity_refs && node.entity_refs.length > 0 && (
                <div>
                  <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider block mb-1">
                    Entity Refs
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {node.entity_refs.map((ref) => (
                      <code
                        key={ref}
                        className="text-[11px] text-teal-600 bg-teal-50/60 px-2 py-0.5 rounded-lg"
                      >
                        {ref}
                      </code>
                    ))}
                  </div>
                </div>
              )}

              {/* Score bars */}
              {(node.salience != null || node.centrality != null || node.bridge_score != null) && (
                <div className="space-y-2">
                  <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider block">
                    Scores
                  </span>
                  {node.salience != null && <ScoreBar label="Salience" value={node.salience} />}
                  {node.centrality != null && (
                    <ScoreBar label="Centrality" value={node.centrality} />
                  )}
                  {node.bridge_score != null && (
                    <ScoreBar label="Bridge" value={node.bridge_score} />
                  )}
                </div>
              )}

              {/* ── Edges ────────────────────────────────────── */}
              <div className="border-t border-emerald-100/60 pt-4">
                <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider block mb-3">
                  One-hop Edges
                </span>

                {edgesQuery.isLoading && <LoadingSpinner />}
                {edgesQuery.isError && (
                  <div className="text-xs text-red-500">Failed to load edges.</div>
                )}
                {edgesQuery.isSuccess && edges.length === 0 && (
                  <div className="text-xs text-gray-400 py-2">No connected edges.</div>
                )}

                {edgesQuery.isSuccess && edges.length > 0 && (
                  <div className="space-y-4">
                    {EDGE_GROUPS.map((group) => {
                      const items = grouped[group.key]
                      if (!items || items.length === 0) return null
                      return (
                        <div key={group.key}>
                          <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">
                            {group.label}{' '}
                            <span className="text-gray-300">({String(items.length)})</span>
                          </span>
                          <div className="space-y-1.5">
                            {items.map((edge, i) => {
                              const target = edge.from_ref === nodeRef ? edge.to_ref : edge.from_ref
                              const interop = readEdgeInteropMeta(edge)
                              const isCognitionLinked =
                                interop.edgeType === 'logic' &&
                                interop.relation != null &&
                                COGNITION_LINKED_RELATIONS.has(interop.relation)

                              const cognitionJumpUrl = isCognitionLinked
                                ? buildStudyUrl({
                                    agentId,
                                    facet: 'cognition',
                                    tab: 'assertions',
                                    request_id: interop.requestId,
                                    settlement_id: interop.settlementId,
                                  })
                                : null

                              return (
                                <motion.div
                                  key={`${edge.from_ref}-${edge.to_ref}-${String(i)}`}
                                  initial={{ opacity: 0, x: 8 }}
                                  animate={{ opacity: 1, x: 0 }}
                                  transition={{ delay: i * 0.03 }}
                                  className="w-full flex items-center gap-1.5"
                                >
                                  <button
                                    type="button"
                                    onClick={() => onDrillIn(target)}
                                    className="flex-1 text-left flex items-center gap-2 px-3 py-2 bg-white/50 border border-emerald-100/50 rounded-lg hover:bg-emerald-50/40 hover:border-emerald-200/80 transition-all duration-200 cursor-pointer"
                                    data-testid="graph-edge-target"
                                  >
                                    <ArrowRight className="w-3 h-3 text-emerald-400 shrink-0" />
                                    <code className="text-xs text-emerald-600/80 truncate flex-1">
                                      {target}
                                    </code>
                                    {edge.weight != null && (
                                      <span className="text-[10px] text-gray-400 tabular-nums shrink-0">
                                        w: {edge.weight.toFixed(2)}
                                      </span>
                                    )}
                                  </button>

                                  {cognitionJumpUrl != null && (
                                    <Link
                                      to={cognitionJumpUrl}
                                      className="shrink-0 h-8 w-8 inline-flex items-center justify-center rounded-lg border border-teal-100 bg-teal-50/70 hover:bg-teal-100/80 text-teal-700 transition-colors"
                                      title={`Jump to cognition${interop.relation ? ` (${interop.relation})` : ''}`}
                                      aria-label="Jump to cognition"
                                      data-testid="graph-edge-cognition-jump"
                                    >
                                      <span className="text-xs leading-none">🧠</span>
                                    </Link>
                                  )}
                                </motion.div>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}

                    {/* Edges that don't match known groups */}
                    {Object.entries(grouped)
                      .filter(([key]) => !EDGE_GROUPS.some((g) => g.key === key))
                      .map(([key, items]) => (
                        <div key={key}>
                          <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">
                            {key} <span className="text-gray-300">({String(items.length)})</span>
                          </span>
                          <div className="space-y-1.5">
                            {items.map((edge, i) => {
                              const target = edge.from_ref === nodeRef ? edge.to_ref : edge.from_ref
                              const interop = readEdgeInteropMeta(edge)
                              const isCognitionLinked =
                                interop.edgeType === 'logic' &&
                                interop.relation != null &&
                                COGNITION_LINKED_RELATIONS.has(interop.relation)

                              const cognitionJumpUrl = isCognitionLinked
                                ? buildStudyUrl({
                                    agentId,
                                    facet: 'cognition',
                                    tab: 'assertions',
                                    request_id: interop.requestId,
                                    settlement_id: interop.settlementId,
                                  })
                                : null

                              return (
                                <motion.div
                                  key={`${edge.from_ref}-${edge.to_ref}-${String(i)}`}
                                  initial={{ opacity: 0, x: 8 }}
                                  animate={{ opacity: 1, x: 0 }}
                                  transition={{ delay: i * 0.03 }}
                                  className="w-full flex items-center gap-1.5"
                                >
                                  <button
                                    type="button"
                                    onClick={() => onDrillIn(target)}
                                    className="flex-1 text-left flex items-center gap-2 px-3 py-2 bg-white/50 border border-gray-100/60 rounded-lg hover:bg-gray-50/60 hover:border-gray-200 transition-all duration-200 cursor-pointer"
                                    data-testid="graph-edge-target"
                                  >
                                    <ArrowRight className="w-3 h-3 text-gray-400 shrink-0" />
                                    <code className="text-xs text-gray-600/80 truncate flex-1">
                                      {target}
                                    </code>
                                    {edge.weight != null && (
                                      <span className="text-[10px] text-gray-400 tabular-nums shrink-0">
                                        w: {edge.weight.toFixed(2)}
                                      </span>
                                    )}
                                  </button>

                                  {cognitionJumpUrl != null && (
                                    <Link
                                      to={cognitionJumpUrl}
                                      className="shrink-0 h-8 w-8 inline-flex items-center justify-center rounded-lg border border-teal-100 bg-teal-50/70 hover:bg-teal-100/80 text-teal-700 transition-colors"
                                      title={`Jump to cognition${interop.relation ? ` (${interop.relation})` : ''}`}
                                      aria-label="Jump to cognition"
                                      data-testid="graph-edge-cognition-jump"
                                    >
                                      <span className="text-xs leading-none">🧠</span>
                                    </Link>
                                  )}
                                </motion.div>
                              )
                            })}
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </motion.aside>
    </AnimatePresence>
  )
}
