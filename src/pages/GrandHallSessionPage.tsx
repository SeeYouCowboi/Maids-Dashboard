import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'motion/react'
import { ArrowLeft, MessageSquare, Brain, XCircle, AlertTriangle, RefreshCw } from 'lucide-react'
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
import type { TranscriptEntry } from '../api/sessions'
import type { SessionListItem, SessionStatus } from '../contracts'
import { listAgents } from '../api/agents'
import { queryKeys } from '../query/keys'
import { ApiError } from '../api/client'
import { useOffline } from '../hooks/OfflineContext'
import { buildStudyUrl } from '../lib/studyUrls'
import {
  getSessionTitle,
  setSessionTitle,
  deriveSessionTitle,
  TITLE_MIN_MESSAGES,
} from '../lib/sessionTitles'
import { lightweightComplete } from '../api/util'

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
  const [pendingUserMsg, setPendingUserMsg] = useState<string | null>(null)
  const [liveText, setLiveText] = useState('')
  const [liveActive, setLiveActive] = useState(false)
  const transcriptEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const isInitialScrollDone = useRef(false)
  const scrollTimeoutRef = useRef<any>(null)

  // Reset scroll initialization flag when switching sessions
  useEffect(() => {
    isInitialScrollDone.current = false
  }, [sessionId])

  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      if (!sessionId) return
      const top = e.currentTarget.scrollTop
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current)
      scrollTimeoutRef.current = setTimeout(() => {
        sessionStorage.setItem(`session_scroll_${sessionId}`, top.toString())
      }, 100)
    },
    [sessionId],
  )

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

  const sessionTitle = useMemo(() => {
    if (session?.title) return session.title
    if (sessionId) {
      const stored = getSessionTitle(sessionId)
      if (stored) return stored
    }
    return `Chat with ${agentDisplayName}`
  }, [session, sessionId, agentDisplayName])

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

  // Clear optimistic user bubble once the real transcript entry arrives
  const messageEntries = useMemo(() => {
    return (
      (transcriptQuery.data?.entries as readonly TranscriptEntry[] | undefined)?.filter(
        (e) => e.record_type === 'message'
      ) ?? []
    )
  }, [transcriptQuery.data?.entries])

  // Auto-generate title when transcript has enough messages
  useEffect(() => {
    if (!sessionId || !transcriptQuery.isSuccess) return
    if (session?.title || getSessionTitle(sessionId)) return
    if (messageEntries.length < TITLE_MIN_MESSAGES) return

    const firstUserText = messageEntries
      .filter((e) => e.actor === 'user' && e.text)
      .slice(0, 3)
      .map((e) => e.text!)
      .join('\n')
    if (!firstUserText) return

    let cancelled = false

    lightweightComplete({
      messages: [
        {
          role: 'user',
          content: `请根据以下对话开头，用不超过10个字为这个会话起一个简短的标题，只输出标题本身，不要加引号或标点：\n\n${firstUserText}`,
        },
      ],
      max_tokens: 512,
      temperature: 0.6,
    })
      .then(({ text }) => {
        if (cancelled) return
        const title = text.trim().replace(/^["「『【]|["」』】]$/g, '').trim()
        if (title) setSessionTitle(sessionId, title)
      })
      .catch(() => {
        if (cancelled) return
        const title = deriveSessionTitle(messageEntries)
        if (title) setSessionTitle(sessionId, title)
      })

    return () => { cancelled = true }
  }, [sessionId, session?.title, transcriptQuery.isSuccess, messageEntries])

  useEffect(() => {
    if (!pendingUserMsg) return
    const last = [...messageEntries].reverse().find((e) => e.actor === 'user')
    if (last?.text === pendingUserMsg) {
      setPendingUserMsg(null)
      setLiveText('') // clear live bubble once real entries land — no flash
      setLiveActive(false)
    }
  }, [messageEntries, pendingUserMsg])

  useEffect(() => {
    if (!transcriptQuery.isSuccess) return

    if (!isInitialScrollDone.current) {
      // Delay briefly to allow DOM elements (messages) to render
      setTimeout(() => {
        const saved = sessionStorage.getItem(`session_scroll_${sessionId}`)
        if (saved && scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = parseInt(saved, 10)
        } else {
          transcriptEndRef.current?.scrollIntoView({ behavior: 'auto' })
        }
        isInitialScrollDone.current = true
      }, 0)
      return
    }

    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messageEntries, liveText, liveActive, pendingUserMsg, transcriptQuery.isSuccess, sessionId])

  const handleSendOptimistic = useCallback((text: string) => {
    setPendingUserMsg(text)
  }, [])

  const handleStreamUpdate = useCallback((text: string, active: boolean) => {
    setLiveText(text)
    setLiveActive(active)
    // Stream ended with no text = error path; clear pending
    if (!active && !text) setPendingUserMsg(null)
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

  return (
    <div className="h-full flex flex-col gap-0">
      {/* ── Compact top bar ─────────────────────────────────────────── */}
      <div className="shrink-0 flex items-center gap-2 px-4 py-2.5 border-b border-white/40 bg-white/10 backdrop-blur-sm">
        {/* Back */}
        <button
          type="button"
          onClick={() => navigate('/grand-hall')}
          className="p-1.5 rounded-xl text-gray-500 hover:text-pink-600 hover:bg-pink-50/60 transition-all duration-200"
          aria-label="Back"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>

        {/* Avatar */}
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-pink-200 to-purple-200 flex items-center justify-center text-xs font-bold text-pink-600 shrink-0">
          {(session?.agent_id ?? '?').charAt(0).toUpperCase()}
        </div>

        {/* Name + session id */}
        <div className="flex-1 min-w-0 flex items-center gap-3 pr-2">
          <span className="font-bold text-sm text-gray-800 truncate">{sessionTitle}</span>
          {session && (
            <div className="flex items-center gap-2 opacity-90 shrink-0">
              <span className="text-[10px] text-gray-500 font-medium hidden sm:block">
                Agent: <span className="text-gray-700">{agentDisplayName}</span>
              </span>
              <code
                className="text-[10px] font-mono tracking-wider text-blue-600/80 bg-blue-50/80 border border-blue-100/50 px-2 py-0.5 rounded-md hidden md:block select-all"
                title={session.session_id}
              >
                {session.session_id}
              </code>
            </div>
          )}
        </div>

        {/* Status + timestamp */}
        {session && (
          <>
            <StatusBadge status={session.status} variant={STATUS_VARIANT[session.status]} />
            <span className="text-[10px] text-gray-400 hidden md:block shrink-0">
              {formatTs(session.created_at)}
            </span>
          </>
        )}

        {/* Refresh transcript */}
        {activeTab === 'transcript' && (
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
        )}

        {/* Session actions */}
        {session?.status === 'open' && (
          <button
            type="button"
            onClick={() => closeMutation.mutate(session.session_id)}
            disabled={isOffline || closeMutation.isPending}
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-red-500 hover:bg-red-50/80 rounded-xl border border-transparent hover:border-red-100 disabled:opacity-50 transition-all"
          >
            <XCircle className="w-3.5 h-3.5" />
            {closeMutation.isPending ? 'Closing…' : 'Close'}
          </button>
        )}
        {session?.status === 'recovery_required' && (
          <button
            type="button"
            onClick={() => recoverMutation.mutate(session.session_id)}
            disabled={isOffline || recoverMutation.isPending}
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-amber-600 hover:bg-amber-50/80 rounded-xl border border-transparent hover:border-amber-100 disabled:opacity-50 transition-all"
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            {recoverMutation.isPending ? 'Recovering…' : 'Recover'}
          </button>
        )}
      </div>

      {/* Action error */}
      <AnimatePresence>
        {actionError != null && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="shrink-0 mx-4 mt-2 bg-red-50/80 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-600 flex items-center gap-2"
          >
            {actionError}
            <button
              type="button"
              onClick={() => setActionError(undefined)}
              className="ml-auto font-semibold hover:text-red-800"
            >
              ✕
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Tab switcher ──────────────────────────────────────────────── */}
      <div className="shrink-0 px-4 pt-2 pb-1">
        <div className="flex items-center gap-1 bg-white/30 backdrop-blur-sm rounded-xl p-0.5 border border-white/50 w-fit">
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
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-[10px] transition-all duration-200 ${activeTab === tab.key
                ? 'bg-white/80 text-pink-600 shadow-sm'
                : 'text-gray-500 hover:text-gray-700 hover:bg-white/30'
                }`}
            >
              <tab.icon className="w-3 h-3" />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Content (card fills height; scroll is inside the card) ──── */}
      <div className="flex-1 min-h-0 flex flex-col px-4 pt-2 pb-2">
        {activeTab === 'transcript' && (
          <GlassCard color="blue" className="flex-1 min-h-0 flex flex-col !p-0 overflow-hidden">
            {transcriptQuery.isLoading && (
              <div className="flex-1 flex items-center justify-center py-8">
                <LoadingSpinner />
              </div>
            )}

            {transcriptQuery.isError && (
              <div className="flex-1 flex items-center justify-center text-xs text-red-500 p-4">
                {transcriptQuery.error instanceof ApiError
                  ? `${String(transcriptQuery.error.status)}: ${transcriptQuery.error.message}`
                  : 'Failed to load transcript'}
              </div>
            )}

            {transcriptQuery.isSuccess && (
              <div
                className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3"
                ref={scrollContainerRef}
                onScroll={handleScroll}
              >
                {messageEntries.length === 0 && !pendingUserMsg && !liveActive && !liveText ? (
                  <EmptyState
                    icon={<MessageSquare className="w-6 h-6" />}
                    message="No messages yet."
                  />
                ) : (
                  <>
                    {messageEntries.map((entry, i) => (
                      <motion.div
                        key={`${String(entry.timestamp)}-${String(i)}`}
                        initial={{ opacity: 0, x: entry.actor === 'user' ? 10 : -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: Math.min(i * 0.02, 0.25) }}
                        className={`rounded-2xl px-4 py-3 ${entry.actor === 'user'
                          ? 'bg-pink-50/70 border border-pink-100/80 ml-10'
                          : 'bg-white/60 border border-white/80 mr-10'
                          }`}
                      >
                        <div className="flex items-baseline justify-between mb-1 gap-2">
                          <span className="text-[10px] text-gray-400 shrink-0">
                            {entry.actor === 'user' ? 'You' : agentDisplayName}
                          </span>
                          <span className="text-[10px] text-gray-300 shrink-0">
                            {formatTs(entry.timestamp)}
                          </span>
                        </div>
                        <p
                          className={`text-[15px] leading-[1.7] text-gray-700 whitespace-pre-wrap ${entry.actor !== 'user' ? 'font-serif' : ''
                            }`}
                        >
                          {entry.text}
                        </p>
                        {entry.actor !== 'user' && entry.request_id && session?.agent_id && (
                          <div className="flex items-center gap-3 mt-1.5">
                            <Link
                              to={buildStudyUrl({
                                agentId: session.agent_id,
                                facet: 'retrieval-trace',
                                request_id: entry.request_id,
                              })}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-[11px] text-teal-600 hover:text-teal-800 transition-colors"
                              data-testid="grand-hall-retrieval-link"
                            >
                              🔍 Retrieval Trace
                            </Link>
                            <Link
                              to={buildStudyUrl({
                                agentId: session.agent_id,
                                facet: 'cognition',
                                request_id: entry.request_id,
                                tab: 'assertions',
                              })}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-[11px] text-teal-600 hover:text-teal-800 transition-colors"
                              data-testid="grand-hall-cognition-link"
                            >
                              🧠 Cognition
                            </Link>
                          </div>
                        )}
                      </motion.div>
                    ))}

                    {/* Optimistic user bubble — shown immediately on send */}
                    {pendingUserMsg && (
                      <motion.div
                        initial={{ opacity: 0, x: 10 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="rounded-2xl px-4 py-3 bg-pink-50/70 border border-pink-100/80 ml-10"
                      >
                        <div className="mb-1">
                          <span className="text-[10px] text-gray-400">You</span>
                        </div>
                        <p className="text-[15px] leading-[1.7] text-gray-700 whitespace-pre-wrap">
                          {pendingUserMsg}
                        </p>
                      </motion.div>
                    )}

                    {/* Typing dots while waiting for first token */}
                    {liveActive && !liveText && (
                      <motion.div
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="rounded-2xl px-4 py-3 bg-white/60 border border-white/80 mr-10"
                      >
                        <div className="mb-2">
                          <span className="text-[10px] text-gray-400">{agentDisplayName}</span>
                        </div>
                        <div className="flex gap-1.5 items-center py-0.5">
                          <span className="w-1.5 h-1.5 bg-gray-300 rounded-full animate-bounce [animation-delay:0ms]" />
                          <span className="w-1.5 h-1.5 bg-gray-300 rounded-full animate-bounce [animation-delay:160ms]" />
                          <span className="w-1.5 h-1.5 bg-gray-300 rounded-full animate-bounce [animation-delay:320ms]" />
                        </div>
                      </motion.div>
                    )}

                    {/* Streaming text once tokens start arriving */}
                    {liveText && (
                      <motion.div
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="rounded-2xl px-4 py-3 bg-white/60 border border-white/80 mr-10"
                      >
                        <div className="mb-1">
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
          <GlassCard color="purple" className="flex-1 min-h-0 flex flex-col !p-0 overflow-hidden">
            {/* Fixed header */}
            <div className="shrink-0 flex items-center justify-between px-4 pt-3 pb-2">
              <h3 className="text-xs font-semibold text-purple-500 flex items-center gap-1.5 tracking-wide uppercase">
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

            {/* Scrollable body */}
            <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 space-y-3">
              {memoryQuery.isLoading && (
                <div className="py-8 flex justify-center">
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
                <>
                  {memoryQuery.data.core_memory_summary.length === 0 ? (
                    <EmptyState icon={<Brain className="w-6 h-6" />} message="No memory blocks." />
                  ) : (
                    memoryQuery.data.core_memory_summary.map((item, i) => (
                      <motion.div
                        key={item.label}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.04 }}
                        className="bg-white/50 border border-purple-100/60 rounded-xl p-3"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-purple-500 uppercase tracking-wider">
                            {item.label}
                          </span>
                          <span className="text-[10px] text-gray-400">
                            {item.chars_current} / {item.char_limit}
                          </span>
                        </div>
                      </motion.div>
                    ))
                  )}
                  {memoryQuery.data.recent_cognition && (
                    <motion.div
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: memoryQuery.data.core_memory_summary.length * 0.04 }}
                      className="bg-purple-50/40 border border-purple-100/60 rounded-xl p-3"
                    >
                      <h4 className="text-xs font-semibold text-purple-500 uppercase tracking-wider mb-2">
                        Recent Cognition
                      </h4>
                      <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                        {memoryQuery.data.recent_cognition}
                      </p>
                    </motion.div>
                  )}
                </>
              )}
            </div>
          </GlassCard>
        )}
      </div>

      {/* ── Chat composer ─────────────────────────────────────────────── */}
      {session?.status === 'open' && (
        <div className="shrink-0 px-4 pb-4 pt-1">
          <div className="bg-white/40 backdrop-blur-xl border border-white/60 rounded-2xl px-4 py-3 shadow-sm">
            <ChatComposer
              sessionId={sessionId}
              disabled={isOffline}
              onSend={handleSendOptimistic}
              onStreamUpdate={handleStreamUpdate}
            />
          </div>
        </div>
      )}

      {session?.status === 'closed' && (
        <div className="shrink-0 px-4 pb-4 text-center text-xs text-gray-400 pt-2">
          Session closed — no further messages.
        </div>
      )}

      {session?.status === 'recovery_required' && (
        <div className="shrink-0 px-4 pb-4 pt-1">
          <div className="text-center text-sm text-amber-600 bg-amber-50/60 border border-amber-200 rounded-2xl py-3 px-6">
            Recovery required before sending messages.
          </div>
        </div>
      )}
    </div>
  )
}
