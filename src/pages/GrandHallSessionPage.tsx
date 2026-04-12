import { useState, useCallback, useRef, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'motion/react'
import { ArrowLeft, MessageSquare, Brain, XCircle, AlertTriangle, RefreshCw } from 'lucide-react'
import { PageHeader } from '../components/ui/PageHeader'
import { GlassCard } from '../components/ui/GlassCard'
import { LoadingSpinner } from '../components/ui/LoadingSpinner'
import { EmptyState } from '../components/ui/EmptyState'
import { StatusBadge } from '../components/ui/StatusBadge'
import { ChatComposer } from '../components/ChatComposer'
import {
  listSessions,
  getSessionTranscript,
  getSessionMemory,
  closeSession,
  recoverSession,
} from '../api/sessions'
import type { TranscriptEntry, MemoryView } from '../api/sessions'
import type { SessionListItem, SessionStatus } from '../contracts'
import { listAgents } from '../api/agents'
import { queryKeys } from '../query/keys'
import { ApiError } from '../api/client'
import { useOffline } from '../hooks/OfflineContext'

type DetailTab = 'transcript' | 'memory'

const STATUS_VARIANT: Record<SessionStatus, 'success' | 'warning' | 'error'> = {
  open: 'success',
  closed: 'warning',
  recovery_required: 'error',
}

function formatTs(unix: number): string {
  return new Date(unix).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function GrandHallSessionPage() {
  const { isOffline } = useOffline()
  const { id: sessionId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [activeTab, setActiveTab] = useState<DetailTab>('transcript')
  const [actionError, setActionError] = useState<string | undefined>(undefined)
  const [liveText, setLiveText] = useState('')
  const [liveActive, setLiveActive] = useState(false)
  const transcriptEndRef = useRef<HTMLDivElement>(null)

  const sessionsQuery = useQuery({
    queryKey: queryKeys.sessions.list(),
    queryFn: listSessions,
  })

  const agentsQuery = useQuery({
    queryKey: queryKeys.agents.list(),
    queryFn: listAgents,
  })

  const session: SessionListItem | undefined = sessionsQuery.data?.items.find(
    (s) => s.session_id === sessionId,
  )

  const agentDisplayName: string = (() => {
    if (!session) return 'Agent'
    const found = agentsQuery.data?.agents.find((a) => a.id === session.agent_id)
    return found?.display_name ?? session.agent_id
  })()

  const transcriptQuery = useQuery({
    queryKey: queryKeys.sessions.transcript(sessionId ?? ''),
    queryFn: () => getSessionTranscript(sessionId ?? ''),
    enabled: sessionId != null && activeTab === 'transcript',
  })

  const memoryQuery = useQuery({
    queryKey: queryKeys.sessions.memory(sessionId ?? ''),
    queryFn: () => getSessionMemory(sessionId ?? ''),
    enabled: sessionId != null && activeTab === 'memory',
  })

  // Auto-scroll to bottom when transcript updates or live text changes
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [transcriptQuery.data, liveText, liveActive])

  const handleStreamUpdate = useCallback((text: string, active: boolean) => {
    setLiveText(text)
    setLiveActive(active)
  }, [])

  const closeMutation = useMutation({
    mutationFn: (id: string) => closeSession(id),
    onSuccess: () => {
      setActionError(undefined)
      void qc.invalidateQueries({ queryKey: queryKeys.sessions.all })
    },
    onError: (err: unknown) => {
      setActionError(err instanceof ApiError ? err.message : 'Close failed')
    },
  })

  const recoverMutation = useMutation({
    mutationFn: (id: string) => recoverSession(id, { action: 'discard_partial_turn' }),
    onSuccess: () => {
      setActionError(undefined)
      void qc.invalidateQueries({ queryKey: queryKeys.sessions.all })
    },
    onError: (err: unknown) => {
      setActionError(err instanceof ApiError ? err.message : 'Recovery failed')
    },
  })

  const handleBack = useCallback(() => navigate('/grand-hall'), [navigate])

  if (!sessionId) {
    return (
      <div className="h-full flex items-center justify-center">
        <EmptyState message="No session ID provided." />
      </div>
    )
  }

  if (sessionsQuery.isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <LoadingSpinner />
      </div>
    )
  }

  const messageEntries = (transcriptQuery.data?.entries as readonly TranscriptEntry[] | undefined)
    ?.filter((e) => e.record_type === 'message') ?? []

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="shrink-0 px-6 pt-6 md:px-8 md:pt-8 pb-4">
        <PageHeader
          title="Session Detail"
          subtitle={session ? `${session.agent_id} • ${session.session_id.slice(0, 12)}…` : sessionId}
        >
          <button
            type="button"
            onClick={handleBack}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-gray-600 bg-white/60 backdrop-blur-sm border border-white/80 rounded-2xl hover:border-pink-200 hover:text-pink-600 transition-all duration-200"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
        </PageHeader>
      </div>

      {/* Session info card */}
      {session && (
        <div className="shrink-0 px-6 md:px-8 pb-3">
          <GlassCard color="pink">
            <div className="flex flex-wrap items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-pink-200 to-purple-200 flex items-center justify-center font-bold text-pink-600 shrink-0">
                {session.agent_id.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-800 text-sm">{agentDisplayName}</p>
                <code className="text-xs text-blue-600/70 bg-blue-50/60 px-1.5 py-0.5 rounded-md">
                  {session.session_id.slice(0, 20)}…
                </code>
              </div>
              <StatusBadge status={session.status} variant={STATUS_VARIANT[session.status]} />
              <span className="text-xs text-gray-400">{formatTs(session.created_at)}</span>

              <div className="flex items-center gap-2">
                {session.status === 'open' && (
                  <button
                    type="button"
                    onClick={() => closeMutation.mutate(session.session_id)}
                    disabled={isOffline || closeMutation.isPending}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-red-500 bg-red-50/80 rounded-xl border border-red-100 hover:bg-red-100 disabled:opacity-50 transition-colors"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    {closeMutation.isPending ? 'Closing…' : 'Close'}
                  </button>
                )}
                {session.status === 'recovery_required' && (
                  <button
                    type="button"
                    onClick={() => recoverMutation.mutate(session.session_id)}
                    disabled={isOffline || recoverMutation.isPending}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-amber-600 bg-amber-50/80 rounded-xl border border-amber-100 hover:bg-amber-100 disabled:opacity-50 transition-colors"
                  >
                    <AlertTriangle className="w-3.5 h-3.5" />
                    {recoverMutation.isPending ? 'Recovering…' : 'Recover'}
                  </button>
                )}
              </div>
            </div>

            <AnimatePresence>
              {actionError != null && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-3 bg-red-50/80 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-600"
                >
                  {actionError}
                </motion.div>
              )}
            </AnimatePresence>
          </GlassCard>
        </div>
      )}

      {/* Tab switcher */}
      <div className="shrink-0 px-6 md:px-8 pb-3">
        <div className="flex items-center gap-1 bg-white/30 backdrop-blur-sm rounded-2xl p-1 border border-white/60 w-fit">
          {(
            [
              { key: 'transcript' as const, icon: MessageSquare, label: 'Transcript' },
              { key: 'memory' as const, icon: Brain, label: 'Memory' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl transition-all duration-200 ${
                activeTab === tab.key
                  ? 'bg-white/70 text-pink-600 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-white/30'
              }`}
            >
              <tab.icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Scrollable content area */}
      <div className="flex-1 min-h-0 overflow-y-auto px-6 md:px-8 pb-3">
        {activeTab === 'transcript' && (
          <GlassCard color="blue">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-semibold text-blue-500 flex items-center gap-2 tracking-wide uppercase">
                <MessageSquare className="w-3.5 h-3.5" />
                Transcript
              </h3>
              <button
                type="button"
                onClick={() =>
                  void qc.invalidateQueries({ queryKey: queryKeys.sessions.transcript(sessionId) })
                }
                className="p-1.5 rounded-xl text-gray-400 hover:text-blue-500 hover:bg-blue-50/50 transition-all"
                aria-label="Refresh transcript"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>

            {transcriptQuery.isLoading && (
              <div className="py-8">
                <LoadingSpinner />
              </div>
            )}

            {transcriptQuery.isError && (
              <div className="text-xs text-red-500 py-4">
                {transcriptQuery.error instanceof ApiError
                  ? `${String(transcriptQuery.error.status)}: ${transcriptQuery.error.message}`
                  : 'Failed to load transcript'}
              </div>
            )}

            {transcriptQuery.isSuccess && (
              <div className="space-y-3">
                {messageEntries.length === 0 && !liveActive && !liveText ? (
                  <EmptyState
                    icon={<MessageSquare className="w-6 h-6" />}
                    message="No messages yet."
                  />
                ) : (
                  <>
                    {messageEntries.map((entry, i) => (
                      <motion.div
                        key={`${String(entry.timestamp)}-${String(i)}`}
                        initial={{ opacity: 0, x: entry.actor === 'user' ? 12 : -12 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: Math.min(i * 0.02, 0.3) }}
                        className={`rounded-2xl px-4 py-3 ${
                          entry.actor === 'user'
                            ? 'bg-pink-50/70 border border-pink-100/80 ml-10'
                            : 'bg-white/60 border border-white/80 mr-10'
                        }`}
                      >
                        <div className="flex items-baseline justify-between mb-1.5 gap-2">
                          <span className="text-[10px] text-gray-400 shrink-0">
                            {entry.actor === 'user' ? 'You' : agentDisplayName}
                          </span>
                          <span className="text-[10px] text-gray-300">{formatTs(entry.timestamp)}</span>
                        </div>
                        <p
                          className={`text-[15px] leading-[1.7] text-gray-700 whitespace-pre-wrap ${
                            entry.actor !== 'user' ? 'font-serif' : ''
                          }`}
                        >
                          {entry.text}
                        </p>
                      </motion.div>
                    ))}

                    {/* Live streaming bubble */}
                    {(liveActive || liveText) && (
                      <motion.div
                        initial={{ opacity: 0, x: -12 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="rounded-2xl px-4 py-3 bg-white/60 border border-white/80 mr-10"
                      >
                        <div className="mb-1.5">
                          <span className="text-[10px] text-gray-400">{agentDisplayName}</span>
                        </div>
                        <p className="text-[15px] leading-[1.7] text-gray-700 whitespace-pre-wrap font-serif">
                          {liveText}
                          {liveActive && (
                            <span className="inline-block w-[3px] h-[1em] bg-pink-400/70 animate-pulse ml-0.5 rounded-full align-text-bottom" />
                          )}
                        </p>
                      </motion.div>
                    )}
                  </>
                )}
                <div ref={transcriptEndRef} />
              </div>
            )}
          </GlassCard>
        )}

        {activeTab === 'memory' && (
          <GlassCard color="purple">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-semibold text-purple-500 flex items-center gap-2 tracking-wide uppercase">
                <Brain className="w-3.5 h-3.5" />
                Memory Snapshot
              </h3>
              <button
                type="button"
                onClick={() =>
                  void qc.invalidateQueries({ queryKey: queryKeys.sessions.memory(sessionId) })
                }
                className="p-1.5 rounded-xl text-gray-400 hover:text-purple-500 hover:bg-purple-50/50 transition-all"
                aria-label="Refresh memory"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>

            {memoryQuery.isLoading && (
              <div className="py-8">
                <LoadingSpinner />
              </div>
            )}

            {memoryQuery.isError && (
              <div className="text-xs text-red-500 py-4">
                {memoryQuery.error instanceof ApiError
                  ? `${String(memoryQuery.error.status)}: ${memoryQuery.error.message}`
                  : 'Failed to load memory'}
              </div>
            )}

            {memoryQuery.isSuccess && (
              <div className="space-y-3">
                {memoryQuery.data.core_memory_summary.length === 0 ? (
                  <EmptyState icon={<Brain className="w-6 h-6" />} message="No memory blocks." />
                ) : (
                  memoryQuery.data.core_memory_summary.map((item, i) => (
                    <motion.div
                      key={item.label}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.05 }}
                      className="bg-white/50 border border-purple-100/60 rounded-xl p-4"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-xs font-semibold text-purple-500 uppercase tracking-wider">
                          {item.label}
                        </h4>
                        <span className="text-[10px] text-gray-400">
                          {item.chars_current} / {item.char_limit} chars
                        </span>
                      </div>
                    </motion.div>
                  ))
                )}
                {memoryQuery.data.recent_cognition && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: memoryQuery.data.core_memory_summary.length * 0.05 }}
                    className="bg-purple-50/40 border border-purple-100/60 rounded-xl p-4"
                  >
                    <h4 className="text-xs font-semibold text-purple-500 uppercase tracking-wider mb-2">
                      Recent Cognition
                    </h4>
                    <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                      {memoryQuery.data.recent_cognition}
                    </p>
                  </motion.div>
                )}
              </div>
            )}
          </GlassCard>
        )}
      </div>

      {/* Chat composer — pinned to bottom */}
      {session?.status === 'open' && (
        <div className="shrink-0 px-6 pb-6 md:px-8 md:pb-8">
          <GlassCard>
            <ChatComposer
              sessionId={sessionId}
              disabled={isOffline}
              onStreamUpdate={handleStreamUpdate}
            />
          </GlassCard>
        </div>
      )}

      {session?.status === 'closed' && (
        <div className="shrink-0 px-6 pb-6 md:px-8 md:pb-8 text-center text-sm text-gray-400">
          This session is closed.
        </div>
      )}

      {session?.status === 'recovery_required' && (
        <div className="shrink-0 px-6 pb-6 md:px-8 md:pb-8">
          <div className="text-center text-sm text-amber-600 bg-amber-50/60 border border-amber-200 rounded-2xl py-4 px-6">
            This session requires recovery before sending new messages.
          </div>
        </div>
      )}
    </div>
  )
}
