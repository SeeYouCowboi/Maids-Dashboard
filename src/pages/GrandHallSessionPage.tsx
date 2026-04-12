import { useState, useCallback } from 'react'
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
    second: '2-digit',
  })
}

export default function GrandHallSessionPage() {
  const { isOffline } = useOffline()
  const { id: sessionId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [activeTab, setActiveTab] = useState<DetailTab>('transcript')
  const [actionError, setActionError] = useState<string | undefined>(undefined)

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
      <div className="space-y-6">
        <EmptyState message="No session ID provided." />
      </div>
    )
  }

  if (sessionsQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <LoadingSpinner />
      </div>
    )
  }

  return (
    <div className="space-y-6">
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

      {session && (
        <GlassCard color="pink">
          <div className="flex flex-wrap items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-pink-200 to-purple-200 flex items-center justify-center font-bold text-pink-600 text-lg shrink-0">
              {session.agent_id.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-gray-800">{session.agent_id}</p>
              <code className="text-xs text-blue-600/80 bg-blue-50/60 px-2 py-0.5 rounded-lg">
                {session.session_id}
              </code>
            </div>
            <StatusBadge status={session.status} variant={STATUS_VARIANT[session.status]} />
            <span className="text-xs text-gray-500">{formatTs(session.created_at)}</span>

            <div className="flex items-center gap-2">
              {session.status === 'open' && (
                <button
                  type="button"
                  onClick={() => closeMutation.mutate(session.session_id)}
                  disabled={isOffline || closeMutation.isPending}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-red-600 bg-red-50/80 rounded-xl border border-red-100 hover:bg-red-100 disabled:opacity-50 transition-colors"
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
      )}

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

      {activeTab === 'transcript' && (
        <GlassCard color="blue">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-blue-600 flex items-center gap-2">
              <MessageSquare className="w-4 h-4" />
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
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {(transcriptQuery.data.entries as readonly TranscriptEntry[]).filter(
                (e) => e.record_type === 'message',
              ).length === 0 ? (
                <EmptyState
                  icon={<MessageSquare className="w-6 h-6" />}
                  message="No transcript entries yet."
                />
              ) : (
                (transcriptQuery.data.entries as readonly TranscriptEntry[])
                  .filter((e) => e.record_type === 'message')
                  .map((entry, i) => (
                    <motion.div
                      key={`${String(entry.timestamp)}-${String(i)}`}
                      initial={{ opacity: 0, x: entry.actor === 'user' ? 12 : -12 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.03 }}
                      className={`rounded-xl p-3 ${
                        entry.actor === 'user'
                          ? 'bg-pink-50/60 border border-pink-100 ml-8'
                          : 'bg-white/50 border border-white/70 mr-8'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] text-gray-400">
                          {entry.actor === 'user' ? 'You' : agentDisplayName}
                        </span>
                        <span className="text-[10px] text-gray-400">{formatTs(entry.timestamp)}</span>
                      </div>
                      <p className="text-sm text-gray-700 whitespace-pre-wrap">{entry.text}</p>
                    </motion.div>
                  ))
              )}
            </div>
          )}
        </GlassCard>
      )}

      {activeTab === 'memory' && (
        <GlassCard color="purple">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-purple-600 flex items-center gap-2">
              <Brain className="w-4 h-4" />
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
                      <h4 className="text-xs font-bold text-purple-500 uppercase tracking-wider">
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
                  <h4 className="text-xs font-bold text-purple-500 uppercase tracking-wider mb-2">
                    Recent Cognition
                  </h4>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">
                    {memoryQuery.data.recent_cognition}
                  </p>
                </motion.div>
              )}
            </div>
          )}
        </GlassCard>
      )}

      {session?.status === 'open' && (
        <GlassCard>
          <ChatComposer sessionId={sessionId} disabled={isOffline} />
        </GlassCard>
      )}

      {session?.status === 'closed' && (
        <div className="text-center text-sm text-gray-400 py-4">
          This session is closed. No further messages can be sent.
        </div>
      )}

      {session?.status === 'recovery_required' && (
        <div className="text-center text-sm text-amber-600 bg-amber-50/60 border border-amber-200 rounded-2xl py-4 px-6">
          This session requires recovery before sending new messages. Use the Recover button above.
        </div>
      )}
    </div>
  )
}
