import { useCallback, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'motion/react'
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Database,
  FileWarning,
  Layers,
  ListTree,
  Radio,
  ScrollText,
  Shield,
} from 'lucide-react'
import { useSearchParams } from 'react-router-dom'

import { getLogs, getRequestDiagnose, getRequestChunks, getRequestTrace } from '../api/requests'
import { getStateSnapshot, listMaidenDecisions } from '../api/state'
import { EmptyState } from '../components/ui/EmptyState'
import { GlassCard } from '../components/ui/GlassCard'
import { LoadingSpinner } from '../components/ui/LoadingSpinner'
import { PageHeader } from '../components/ui/PageHeader'
import { StatusBadge } from '../components/ui/StatusBadge'
import type { MaidenDecisionItem, StateSnapshotResponse } from '../contracts'
import { useOffline } from '../hooks/OfflineContext'
import { queryKeys } from '../query/keys'

/* ── Constants ─────────────────────────────────────────────────────────── */

const POLL_INTERVAL = 30_000

type TopTab = 'event-stream' | 'state-inspector'

type EventSubTab = 'logs' | 'errors' | 'failed-requests'
type StateSubTab = 'blackboard' | 'maiden-decisions' | 'raw-traces'

const TOP_TABS: readonly { value: TopTab; label: string; icon: typeof Shield }[] = [
  { value: 'event-stream', label: 'Event Stream', icon: Radio },
  { value: 'state-inspector', label: 'State Inspector', icon: Database },
] as const

const EVENT_SUB_TABS: readonly { value: EventSubTab; label: string; icon: typeof Shield }[] = [
  { value: 'logs', label: 'Logs', icon: ScrollText },
  { value: 'errors', label: 'Errors', icon: AlertTriangle },
  { value: 'failed-requests', label: 'Failed Requests', icon: FileWarning },
] as const

const STATE_SUB_TABS: readonly { value: StateSubTab; label: string; icon: typeof Shield }[] = [
  { value: 'blackboard', label: 'Blackboard', icon: Layers },
  { value: 'maiden-decisions', label: 'Maiden Decisions', icon: ListTree },
  { value: 'raw-traces', label: 'Raw Traces', icon: ScrollText },
] as const

const VALID_TOP_TABS = new Set<string>(['event-stream', 'state-inspector'])
const VALID_EVENT_SUBS = new Set<string>(['logs', 'errors', 'failed-requests'])
const VALID_STATE_SUBS = new Set<string>(['blackboard', 'maiden-decisions', 'raw-traces'])

/* ── Log entry type (matches GET /v1/logs response) ────────────────────── */

type LogEntryRow = {
  level: string
  message: string
  timestamp: number
  request_id: string
  session_id: string
  agent_id: string
}

type LogsResponse = {
  filters: {
    request_id?: string | undefined
    session_id?: string | undefined
    agent_id?: string | undefined
  }
  entries: LogEntryRow[]
}

/* ── Helpers ──────────────────────────────────────────────────────────── */

function formatTs(unix: number): string {
  return new Date(unix).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function levelVariant(level: string): 'error' | 'warning' | 'info' | 'neutral' {
  if (level === 'error' || level === 'fatal') return 'error'
  if (level === 'warn' || level === 'warning') return 'warning'
  if (level === 'info') return 'info'
  return 'neutral'
}

/* ── Main component ────────────────────────────────────────────────────── */

export default function WarRoomPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { isOffline } = useOffline()

  const rawTab = searchParams.get('tab')
  const rawSubtab = searchParams.get('subtab')
  const highlightedRequestId = searchParams.get('request_id')

  const activeTab: TopTab =
    rawTab != null && VALID_TOP_TABS.has(rawTab) ? (rawTab as TopTab) : 'event-stream'

  const eventSubTab: EventSubTab =
    highlightedRequestId != null
      ? 'failed-requests'
      : rawSubtab != null && VALID_EVENT_SUBS.has(rawSubtab)
        ? (rawSubtab as EventSubTab)
        : 'logs'

  const stateSubTab: StateSubTab =
    rawSubtab != null && VALID_STATE_SUBS.has(rawSubtab) ? (rawSubtab as StateSubTab) : 'blackboard'

  const setTab = useCallback(
    (tab: TopTab) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        next.set('tab', tab)
        next.delete('subtab')
        next.delete('request_id')
        return next
      })
    },
    [setSearchParams],
  )

  const setEventSub = useCallback(
    (sub: EventSubTab) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        next.set('tab', 'event-stream')
        next.set('subtab', sub)
        if (sub !== 'failed-requests') next.delete('request_id')
        return next
      })
    },
    [setSearchParams],
  )

  const setStateSub = useCallback(
    (sub: StateSubTab) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        next.set('tab', 'state-inspector')
        next.set('subtab', sub)
        return next
      })
    },
    [setSearchParams],
  )

  const logsQuery = useQuery<LogsResponse>({
    queryKey: queryKeys.requests.logs(),
    queryFn: () => getLogs() as Promise<LogsResponse>,
    refetchInterval: isOffline ? false : POLL_INTERVAL,
  })

  const snapshotQuery = useQuery<StateSnapshotResponse>({
    queryKey: queryKeys.state.snapshot(),
    queryFn: () => getStateSnapshot(),
    refetchInterval: isOffline ? false : POLL_INTERVAL,
    enabled: activeTab === 'state-inspector',
  })

  const decisionsQuery = useQuery({
    queryKey: queryKeys.state.maidenDecisions(),
    queryFn: () => listMaidenDecisions(),
    refetchInterval: isOffline ? false : POLL_INTERVAL,
    enabled: activeTab === 'state-inspector' && stateSubTab === 'maiden-decisions',
  })

  const allEntries = logsQuery.data?.entries ?? []

  const errorEntries = useMemo(
    () => allEntries.filter((e) => e.level === 'error' || e.level === 'fatal'),
    [allEntries],
  )

  const failedRequestIds = useMemo(() => {
    const ids = new Set<string>()
    for (const e of errorEntries) {
      ids.add(e.request_id)
    }
    return [...ids]
  }, [errorEntries])

  return (
    <div className="space-y-6">
      <PageHeader title="War Room" subtitle="Request traces, logs, and state inspectors">
        {isOffline && <StatusBadge status="Offline — cached data" variant="warning" />}
      </PageHeader>

      <div className="flex items-center gap-1 bg-white/30 backdrop-blur-sm rounded-2xl p-1 border border-white/60">
        {TOP_TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setTab(t.value)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-xl transition-all duration-200 ${
              activeTab === t.value
                ? 'bg-white/70 text-red-600 shadow-sm'
                : 'text-gray-500 hover:text-gray-700 hover:bg-white/30'
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'event-stream' && (
        <EventStreamZone
          subTab={eventSubTab}
          setSubTab={setEventSub}
          logsQuery={logsQuery}
          allEntries={allEntries}
          errorEntries={errorEntries}
          failedRequestIds={failedRequestIds}
          highlightedRequestId={highlightedRequestId}
        />
      )}

      {activeTab === 'state-inspector' && (
        <StateInspectorZone
          subTab={stateSubTab}
          setSubTab={setStateSub}
          snapshotQuery={snapshotQuery}
          decisionsQuery={decisionsQuery}
        />
      )}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════════
   Event Stream Zone
   ══════════════════════════════════════════════════════════════════════════ */

type EventStreamProps = {
  subTab: EventSubTab
  setSubTab: (sub: EventSubTab) => void
  logsQuery: ReturnType<typeof useQuery<LogsResponse>>
  allEntries: LogEntryRow[]
  errorEntries: LogEntryRow[]
  failedRequestIds: string[]
  highlightedRequestId: string | null
}

function EventStreamZone({
  subTab,
  setSubTab,
  logsQuery,
  allEntries,
  errorEntries,
  failedRequestIds,
  highlightedRequestId,
}: EventStreamProps) {
  return (
    <>
      <div className="flex items-center gap-1 bg-white/20 backdrop-blur-sm rounded-xl p-1 border border-white/40">
        {EVENT_SUB_TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setSubTab(t.value)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all duration-200 ${
              subTab === t.value
                ? 'bg-white/60 text-red-600 shadow-sm'
                : 'text-gray-500 hover:text-gray-700 hover:bg-white/20'
            }`}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
            {t.value === 'errors' && errorEntries.length > 0 && (
              <span className="ml-1 bg-red-100 text-red-600 rounded-full px-1.5 text-[10px] font-bold">
                {errorEntries.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {logsQuery.isLoading && (
        <div className="py-12">
          <LoadingSpinner />
        </div>
      )}

      {logsQuery.isError && (
        <GlassCard color="red">
          <p className="text-sm text-red-500">Failed to load logs</p>
        </GlassCard>
      )}

      {logsQuery.isSuccess && (
        <>
          {subTab === 'logs' && <LogsTable entries={allEntries} />}
          {subTab === 'errors' && <LogsTable entries={errorEntries} />}
          {subTab === 'failed-requests' && (
            <FailedRequestsList
              requestIds={failedRequestIds}
              highlightedRequestId={highlightedRequestId}
            />
          )}
        </>
      )}
    </>
  )
}

/* ── Logs Table ────────────────────────────────────────────────────────── */

function LogsTable({ entries }: { entries: LogEntryRow[] }) {
  if (entries.length === 0) {
    return (
      <GlassCard color="red">
        <EmptyState icon={<ScrollText className="w-8 h-8" />} message="No log entries" />
      </GlassCard>
    )
  }

  return (
    <GlassCard color="red">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs font-bold text-gray-400 uppercase tracking-wider border-b border-gray-200/40">
              <th className="pb-2 pr-3">Time</th>
              <th className="pb-2 pr-3">Level</th>
              <th className="pb-2 pr-3">Request</th>
              <th className="pb-2">Message</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry, i) => (
              <motion.tr
                key={`${entry.request_id}-${String(entry.timestamp)}-${String(i)}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: Math.min(i * 0.02, 0.5) }}
                className="border-b border-gray-100/30 last:border-b-0"
              >
                <td className="py-2 pr-3 text-gray-500 whitespace-nowrap font-mono text-xs">
                  {formatTs(entry.timestamp)}
                </td>
                <td className="py-2 pr-3">
                  <StatusBadge status={entry.level} variant={levelVariant(entry.level)} />
                </td>
                <td className="py-2 pr-3 text-gray-400 font-mono text-xs max-w-[120px] truncate">
                  {entry.request_id.slice(0, 12)}
                </td>
                <td className="py-2 text-gray-700 break-all">{entry.message}</td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
    </GlassCard>
  )
}

/* ── Failed Requests List ──────────────────────────────────────────────── */

function FailedRequestsList({
  requestIds,
  highlightedRequestId,
}: {
  requestIds: string[]
  highlightedRequestId: string | null
}) {
  if (requestIds.length === 0) {
    return (
      <GlassCard color="red">
        <EmptyState icon={<FileWarning className="w-8 h-8" />} message="No failed requests found" />
      </GlassCard>
    )
  }

  return (
    <GlassCard color="red">
      <div className="space-y-2">
        {requestIds.map((id, i) => (
          <FailedRequestRow
            key={id}
            requestId={id}
            index={i}
            isHighlighted={highlightedRequestId === id}
          />
        ))}
      </div>
    </GlassCard>
  )
}

function FailedRequestRow({
  requestId,
  index,
  isHighlighted,
}: {
  requestId: string
  index: number
  isHighlighted: boolean
}) {
  const [expanded, setExpanded] = useState(isHighlighted)

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.05, 0.3) }}
      className={`border rounded-xl overflow-hidden ${
        isHighlighted ? 'border-red-300 bg-red-50/30' : 'border-white/50 bg-white/20'
      }`}
    >
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/20 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
        )}
        <span className="font-mono text-sm text-gray-700">{requestId}</span>
        <StatusBadge status="error" variant="error" />
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 border-t border-gray-100/30">
              <RequestDetailPanel requestId={requestId} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

/* ── Request Detail Panel ──────────────────────────────────────────────── */

function RequestDetailPanel({ requestId }: { requestId: string }) {
  const [detailTab, setDetailTab] = useState<'diagnose' | 'chunks' | 'trace'>('diagnose')

  const diagnoseQuery = useQuery({
    queryKey: queryKeys.requests.diagnose(requestId),
    queryFn: () => getRequestDiagnose(requestId),
    enabled: detailTab === 'diagnose',
  })

  const chunksQuery = useQuery({
    queryKey: queryKeys.requests.chunks(requestId),
    queryFn: () => getRequestChunks(requestId),
    enabled: detailTab === 'chunks',
  })

  const traceQuery = useQuery({
    queryKey: queryKeys.requests.trace(requestId),
    queryFn: () => getRequestTrace(requestId),
    enabled: detailTab === 'trace',
  })

  const tabs = [
    { key: 'diagnose' as const, label: 'Diagnosis' },
    { key: 'chunks' as const, label: 'Chunks' },
    { key: 'trace' as const, label: 'Trace' },
  ] as const

  const activeQuery =
    detailTab === 'diagnose' ? diagnoseQuery : detailTab === 'chunks' ? chunksQuery : traceQuery

  return (
    <div className="mt-3 space-y-3">
      <div className="flex gap-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setDetailTab(t.key)}
            className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
              detailTab === t.key
                ? 'bg-red-100 text-red-700'
                : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100/50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeQuery.isLoading && (
        <div className="py-4">
          <LoadingSpinner />
        </div>
      )}

      {activeQuery.isError && (
        <p className="text-sm text-red-500 py-2">Failed to load {detailTab} data</p>
      )}

      {activeQuery.isSuccess && (
        <pre className="bg-gray-900/90 text-gray-100 text-xs font-mono rounded-xl p-4 overflow-x-auto max-h-80 overflow-y-auto">
          {JSON.stringify(activeQuery.data, null, 2)}
        </pre>
      )}
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════════════════
   State Inspector Zone
   ══════════════════════════════════════════════════════════════════════════ */

type StateInspectorProps = {
  subTab: StateSubTab
  setSubTab: (sub: StateSubTab) => void
  snapshotQuery: ReturnType<typeof useQuery<StateSnapshotResponse>>
  decisionsQuery: ReturnType<typeof useQuery>
}

function StateInspectorZone({
  subTab,
  setSubTab,
  snapshotQuery,
  decisionsQuery,
}: StateInspectorProps) {
  return (
    <>
      <div className="flex items-center gap-1 bg-white/20 backdrop-blur-sm rounded-xl p-1 border border-white/40">
        {STATE_SUB_TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setSubTab(t.value)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all duration-200 ${
              subTab === t.value
                ? 'bg-white/60 text-red-600 shadow-sm'
                : 'text-gray-500 hover:text-gray-700 hover:bg-white/20'
            }`}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {subTab === 'blackboard' && <BlackboardPanel query={snapshotQuery} />}
      {subTab === 'maiden-decisions' && <MaidenDecisionsPanel query={decisionsQuery} />}
      {subTab === 'raw-traces' && <RawTracesPlaceholder />}
    </>
  )
}

/* ── Blackboard Panel ──────────────────────────────────────────────────── */

function BlackboardPanel({ query }: { query: ReturnType<typeof useQuery<StateSnapshotResponse>> }) {
  if (query.isLoading) {
    return (
      <div className="py-12">
        <LoadingSpinner />
      </div>
    )
  }

  if (query.isError) {
    return (
      <GlassCard color="purple">
        <p className="text-sm text-red-500">Failed to load blackboard snapshot</p>
      </GlassCard>
    )
  }

  const entries = query.data?.entries ?? []

  if (entries.length === 0) {
    return (
      <GlassCard color="purple">
        <EmptyState icon={<Layers className="w-8 h-8" />} message="Blackboard is empty" />
      </GlassCard>
    )
  }

  return (
    <GlassCard color="purple" title="Blackboard Snapshot">
      <div className="space-y-3">
        {entries.map((entry, i) => (
          <motion.div
            key={entry.key}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: Math.min(i * 0.03, 0.5) }}
            className="bg-white/30 rounded-xl p-4 border border-white/40"
          >
            <div className="flex items-start gap-3">
              <span className="text-xs font-bold text-purple-600 bg-purple-100 rounded-lg px-2 py-1 shrink-0">
                {entry.key}
              </span>
              <pre className="text-xs text-gray-700 font-mono overflow-x-auto flex-1 whitespace-pre-wrap break-all">
                {typeof entry.value === 'string'
                  ? entry.value
                  : JSON.stringify(entry.value, null, 2)}
              </pre>
            </div>
          </motion.div>
        ))}
      </div>
    </GlassCard>
  )
}

/* ── Maiden Decisions Panel ────────────────────────────────────────────── */

function MaidenDecisionsPanel({ query }: { query: ReturnType<typeof useQuery> }) {
  if (query.isLoading) {
    return (
      <div className="py-12">
        <LoadingSpinner />
      </div>
    )
  }

  if (query.isError) {
    return (
      <GlassCard color="purple">
        <p className="text-sm text-red-500">Failed to load maiden decisions</p>
      </GlassCard>
    )
  }

  const data = query.data as { items?: MaidenDecisionItem[] } | undefined
  const items = data?.items ?? []

  if (items.length === 0) {
    return (
      <GlassCard color="purple">
        <EmptyState
          icon={<ListTree className="w-8 h-8" />}
          message="No maiden decisions recorded"
        />
      </GlassCard>
    )
  }

  return (
    <GlassCard color="purple" title="Maiden Decisions">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs font-bold text-gray-400 uppercase tracking-wider border-b border-gray-200/40">
              <th className="pb-2 pr-3">Time</th>
              <th className="pb-2 pr-3">Action</th>
              <th className="pb-2 pr-3">Target</th>
              <th className="pb-2 pr-3">Depth</th>
              <th className="pb-2">Candidates</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <motion.tr
                key={item.decision_id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: Math.min(i * 0.03, 0.5) }}
                className="border-b border-gray-100/30 last:border-b-0"
              >
                <td className="py-2 pr-3 text-gray-500 whitespace-nowrap font-mono text-xs">
                  {formatTs(item.created_at)}
                </td>
                <td className="py-2 pr-3">
                  <StatusBadge
                    status={item.action}
                    variant={item.action === 'delegate' ? 'info' : 'success'}
                  />
                </td>
                <td className="py-2 pr-3 text-gray-700 font-mono text-xs">
                  {item.target_agent_id ?? '—'}
                </td>
                <td className="py-2 pr-3 text-gray-500 text-xs">{item.delegation_depth}</td>
                <td className="py-2 text-gray-400 text-xs">
                  {item.chosen_from_agent_ids.join(', ') || '—'}
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
    </GlassCard>
  )
}

/* ── Raw Traces Placeholder ────────────────────────────────────────────── */

function RawTracesPlaceholder() {
  return (
    <GlassCard color="purple">
      <EmptyState
        icon={<ScrollText className="w-8 h-8" />}
        message="Raw trace store unavailable in v1"
      />
    </GlassCard>
  )
}
