import { useState, useMemo, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'motion/react'
import { Home, Plus, Users, Filter, X } from 'lucide-react'
import { PageHeader } from '../components/ui/PageHeader'
import { GlassCard } from '../components/ui/GlassCard'
import { SearchBar } from '../components/ui/SearchBar'
import { LoadingSpinner } from '../components/ui/LoadingSpinner'
import { EmptyState } from '../components/ui/EmptyState'
import { SessionCard } from '../components/SessionCard'
import { listSessions, createSession, closeSession, recoverSession } from '../api/sessions'
import { listAgents } from '../api/agents'
import type { SessionStatus, AgentItem } from '../contracts'
import { queryKeys } from '../query/keys'
import { ApiError } from '../api/client'

type StatusFilter = SessionStatus | 'all'

const STATUS_OPTIONS: readonly { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
  { value: 'recovery_required', label: 'Recovery' },
] as const

export default function GrandHallPage() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [selectedAgentId, setSelectedAgentId] = useState('')
  const [actionError, setActionError] = useState<string | undefined>(undefined)

  const sessionsQuery = useQuery({
    queryKey: queryKeys.sessions.list(),
    queryFn: listSessions,
  })

  const agentsQuery = useQuery({
    queryKey: queryKeys.agents.list(),
    queryFn: listAgents,
  })

  const agentMap = useMemo(() => {
    const m = new Map<string, AgentItem>()
    if (agentsQuery.data) {
      for (const agent of agentsQuery.data.agents) {
        m.set(agent.id, agent)
      }
    }
    return m
  }, [agentsQuery.data])

  const filteredSessions = useMemo(() => {
    const items = sessionsQuery.data?.items ?? []
    return items.filter((s) => {
      if (statusFilter !== 'all' && s.status !== statusFilter) return false
      if (search.length > 0) {
        const q = search.toLowerCase()
        const agentName = agentMap.get(s.agent_id)?.display_name ?? ''
        return (
          s.session_id.toLowerCase().includes(q) ||
          s.agent_id.toLowerCase().includes(q) ||
          agentName.toLowerCase().includes(q)
        )
      }
      return true
    })
  }, [sessionsQuery.data, statusFilter, search, agentMap])

  const createMutation = useMutation({
    mutationFn: (agentId: string) => createSession({ agent_id: agentId }),
    onSuccess: () => {
      setActionError(undefined)
      setShowCreateForm(false)
      setSelectedAgentId('')
      void qc.invalidateQueries({ queryKey: queryKeys.sessions.all })
    },
    onError: (err: unknown) => {
      setActionError(
        err instanceof ApiError
          ? `${String(err.status)}: ${err.message}`
          : 'Failed to create session',
      )
    },
  })

  const closeMutation = useMutation({
    mutationFn: (id: string) => closeSession(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.sessions.all })
    },
    onError: (err: unknown) => {
      setActionError(err instanceof ApiError ? err.message : 'Close failed')
    },
  })

  const recoverMutation = useMutation({
    mutationFn: (id: string) => recoverSession(id, { action: 'discard_partial_turn' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.sessions.all })
    },
    onError: (err: unknown) => {
      setActionError(err instanceof ApiError ? err.message : 'Recovery failed')
    },
  })

  const handleCreate = useCallback(() => {
    if (selectedAgentId.length === 0) return
    createMutation.mutate(selectedAgentId)
  }, [selectedAgentId, createMutation])

  const handleClose = useCallback((id: string) => closeMutation.mutate(id), [closeMutation])

  const handleRecover = useCallback((id: string) => recoverMutation.mutate(id), [recoverMutation])

  return (
    <div className="space-y-6">
      <PageHeader title="Grand Hall" subtitle="Agent sessions, live activity, connection status">
        <button
          type="button"
          onClick={() => setShowCreateForm((prev) => !prev)}
          className="flex items-center gap-2 px-4 py-2.5 text-sm font-bold text-white bg-gradient-to-r from-pink-400 to-pink-500 rounded-2xl shadow-sm hover:shadow-md hover:from-pink-500 hover:to-pink-600 transition-all duration-200"
        >
          <Plus className="w-4 h-4" />
          New Session
        </button>
      </PageHeader>

      <AnimatePresence>
        {actionError != null && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-red-50 border border-red-200 rounded-2xl p-4 text-red-600 text-sm flex items-center gap-3"
          >
            {actionError}
            <button
              type="button"
              onClick={() => setActionError(undefined)}
              className="ml-auto text-red-500 hover:text-red-700 font-bold text-xs"
            >
              Dismiss
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showCreateForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <GlassCard color="pink">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-pink-600 flex items-center gap-2">
                  <Plus className="w-4 h-4" />
                  Create New Session
                </h3>
                <button
                  type="button"
                  onClick={() => setShowCreateForm(false)}
                  className="p-1 rounded-lg text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex-1">
                  <label
                    htmlFor="agent-select"
                    className="block text-xs font-semibold text-gray-500 mb-1.5"
                  >
                    Agent
                  </label>
                  <select
                    id="agent-select"
                    value={selectedAgentId}
                    onChange={(e) => setSelectedAgentId(e.target.value)}
                    className="w-full bg-white/60 backdrop-blur-sm border border-white/80 rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:border-pink-300 focus:ring-2 focus:ring-pink-100 transition-all"
                  >
                    <option value="">Select an agent…</option>
                    {agentsQuery.data?.agents.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.display_name} ({agent.role})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={handleCreate}
                    disabled={selectedAgentId.length === 0 || createMutation.isPending}
                    className="px-5 py-2 text-sm font-bold text-white bg-gradient-to-r from-pink-400 to-pink-500 rounded-xl shadow-sm hover:shadow-md disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                  >
                    {createMutation.isPending ? 'Creating…' : 'Create'}
                  </button>
                </div>
              </div>
            </GlassCard>
          </motion.div>
        )}
      </AnimatePresence>

      {agentsQuery.isSuccess && agentsQuery.data.agents.length > 0 && (
        <GlassCard color="pink">
          <div className="flex items-center gap-2 mb-3">
            <Users className="w-4 h-4 text-pink-500" />
            <span className="text-sm font-bold text-pink-600">
              {agentsQuery.data.agents.length} Agent
              {agentsQuery.data.agents.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {agentsQuery.data.agents.map((agent, i) => (
              <motion.div
                key={agent.id}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.03 }}
                className="flex items-center gap-2 bg-white/50 rounded-xl px-3 py-2 border border-white/70"
              >
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-pink-200 to-purple-200 flex items-center justify-center font-bold text-pink-600 text-xs shrink-0">
                  {agent.display_name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-gray-800 truncate">{agent.display_name}</p>
                  <p className="text-[10px] text-gray-500 truncate">{agent.role}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </GlassCard>
      )}

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1">
          <SearchBar
            placeholder="Search by agent, session ID…"
            value={search}
            onChange={setSearch}
          />
        </div>
        <div className="flex items-center gap-1 bg-white/30 backdrop-blur-sm rounded-2xl p-1 border border-white/60">
          <Filter className="w-3.5 h-3.5 text-gray-400 ml-2" />
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setStatusFilter(opt.value)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-xl transition-all duration-200 ${
                statusFilter === opt.value
                  ? 'bg-white/70 text-pink-600 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-white/30'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <GlassCard color="blue">
        <div className="flex items-center gap-2 mb-4">
          <Home className="w-4 h-4 text-blue-500" />
          <span className="text-sm font-bold text-blue-600">
            {filteredSessions.length} Session{filteredSessions.length === 1 ? '' : 's'}
          </span>
          {statusFilter !== 'all' && (
            <span className="text-xs text-gray-400">(filtered: {statusFilter})</span>
          )}
        </div>

        {sessionsQuery.isLoading && (
          <div className="py-12">
            <LoadingSpinner />
          </div>
        )}

        {sessionsQuery.isError && (
          <div className="text-sm text-red-500 py-4">
            {sessionsQuery.error instanceof ApiError
              ? `${String(sessionsQuery.error.status)}: ${sessionsQuery.error.message}`
              : 'Failed to load sessions'}
          </div>
        )}

        {sessionsQuery.isSuccess && filteredSessions.length === 0 && (
          <EmptyState
            icon={<Home className="w-8 h-8" />}
            message={
              search.length > 0 || statusFilter !== 'all'
                ? 'No sessions match your filters.'
                : 'No sessions yet. Create one to get started.'
            }
            action={
              search.length > 0 || statusFilter !== 'all' ? (
                <button
                  type="button"
                  onClick={() => {
                    setSearch('')
                    setStatusFilter('all')
                  }}
                  className="text-xs font-semibold text-pink-500 hover:text-pink-700 transition-colors"
                >
                  Clear filters
                </button>
              ) : undefined
            }
          />
        )}

        {sessionsQuery.isSuccess && filteredSessions.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredSessions.map((session, i) => (
              <SessionCard
                key={session.session_id}
                session={session}
                agentName={agentMap.get(session.agent_id)?.display_name}
                index={i}
                onClose={handleClose}
                onRecover={handleRecover}
              />
            ))}
          </div>
        )}
      </GlassCard>
    </div>
  )
}
