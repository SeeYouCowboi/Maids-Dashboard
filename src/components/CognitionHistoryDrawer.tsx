import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'motion/react'
import { Clock, X } from 'lucide-react'

import { getCognitionHistory } from '../api/cognition'
import { LoadingSpinner } from './ui/LoadingSpinner'
import { EmptyState } from './ui/EmptyState'
import { StatusBadge } from './ui/StatusBadge'
import type { CognitionHistoryItem } from '../contracts'
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

export function CognitionHistoryDrawer({
  agentId,
  cognitionKey,
  onClose,
}: {
  agentId: string
  cognitionKey: string
  onClose: () => void
}) {
  const query = useQuery({
    queryKey: queryKeys.cognition.history(agentId, cognitionKey),
    queryFn: () => getCognitionHistory(agentId, cognitionKey),
  })

  const items: readonly CognitionHistoryItem[] = query.data?.items ?? []
  // Oldest-first for history timeline
  const sorted = [...items].sort((a, b) => a.committed_time - b.committed_time)

  return (
    <AnimatePresence>
      {/* Backdrop */}
      <motion.div
        key="cognition-drawer-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px]"
        onClick={onClose}
        data-testid="cognition-history-backdrop"
      />

      {/* Drawer */}
      <motion.aside
        key="cognition-drawer"
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', bounce: 0.15, duration: 0.4 }}
        className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-md bg-white/95 backdrop-blur-xl border-l border-emerald-100/80 shadow-2xl flex flex-col"
        data-testid="cognition-history-drawer"
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-emerald-100/60">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-bold text-emerald-700 truncate">History</h3>
            <code className="text-[11px] text-emerald-500/80 bg-emerald-50/60 px-2 py-0.5 rounded-lg inline-block mt-1 max-w-full truncate">
              {cognitionKey}
            </code>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-gray-400 hover:text-red-500 hover:bg-red-50/60 transition-all cursor-pointer"
            aria-label="Close drawer"
            data-testid="cognition-history-close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
          {query.isLoading && (
            <div className="py-12">
              <LoadingSpinner />
            </div>
          )}

          {query.isError && (
            <div className="text-xs text-red-500 py-4">Failed to load cognition history.</div>
          )}

          {query.isSuccess && sorted.length === 0 && (
            <EmptyState
              icon={<Clock className="w-6 h-6" />}
              message="No history entries for this key."
            />
          )}

          {query.isSuccess && sorted.length > 0 && (
            <div className="relative">
              {/* Timeline line */}
              <div className="absolute left-[7px] top-3 bottom-3 w-px bg-emerald-200/60" />

              <div className="space-y-4">
                {sorted.map((entry, i) => (
                  <motion.div
                    key={entry.id}
                    initial={{ opacity: 0, x: 12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className="relative pl-6"
                  >
                    {/* Timeline dot */}
                    <div className="absolute left-0 top-3 w-[15px] h-[15px] rounded-full border-2 border-emerald-300 bg-white" />

                    <div className="bg-white/70 border border-emerald-100/60 rounded-xl p-3.5">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {entry.stance != null && (
                            <StatusBadge status={entry.stance} variant="info" />
                          )}
                          {entry.status != null && (
                            <StatusBadge status={entry.status} variant="neutral" />
                          )}
                          {entry.salience != null && (
                            <span className="text-[10px] text-gray-400 tabular-nums">
                              salience: {entry.salience.toFixed(2)}
                            </span>
                          )}
                        </div>
                        <time
                          dateTime={toIso(entry.committed_time)}
                          title={toIso(entry.committed_time)}
                          className="text-[10px] text-gray-400 shrink-0"
                        >
                          {formatTs(entry.committed_time)}
                        </time>
                      </div>
                      <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                        {entry.content}
                      </p>
                      {(entry.request_id || entry.settlement_id) && (
                        <div className="flex items-center gap-3 mt-2 text-[10px] text-gray-400">
                          {entry.request_id && <span>req: {entry.request_id.slice(0, 12)}…</span>}
                          {entry.settlement_id && (
                            <span>stl: {entry.settlement_id.slice(0, 12)}…</span>
                          )}
                        </div>
                      )}
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          )}
        </div>
      </motion.aside>
    </AnimatePresence>
  )
}
