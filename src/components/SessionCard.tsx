import { motion } from 'motion/react'
import { useNavigate } from 'react-router-dom'
import { Clock, AlertTriangle, XCircle, CheckCircle2 } from 'lucide-react'
import type { SessionListItem, SessionStatus } from '../contracts'
import { StatusBadge } from './ui/StatusBadge'
import { getSessionTitle } from '../lib/sessionTitles'

interface SessionCardProps {
  session: SessionListItem
  agentName: string | undefined
  index: number
  onClose: (id: string) => void
  onRecover: (id: string) => void
}

const STATUS_BADGE: Record<
  SessionStatus,
  { label: string; variant: 'success' | 'warning' | 'error' }
> = {
  open: { label: 'Open', variant: 'success' },
  closed: { label: 'Closed', variant: 'warning' },
  recovery_required: { label: 'Recovery Required', variant: 'error' },
}

function formatTimestamp(unix: number): string {
  return new Date(unix).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function SessionCard({ session, agentName, index, onClose, onRecover }: SessionCardProps) {
  const navigate = useNavigate()
  const badge = STATUS_BADGE[session.status]
  const cardTitle = session.title || getSessionTitle(session.session_id) || `Chat with ${agentName || session.agent_id}`

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, type: 'spring', stiffness: 260, damping: 22 }}
      className="relative group bg-white/60 backdrop-blur-md rounded-2xl p-5 border border-white/80 hover:border-pink-200 shadow-sm hover:shadow-lg hover:shadow-pink-100/40 transition-all duration-300 cursor-pointer overflow-hidden flex flex-col"
      onClick={() => navigate(`/grand-hall/sessions/${session.session_id}`)}
    >
      {/* Corner Action Badge */}
      <div className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10">
        {session.status === 'open' && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onClose(session.session_id)
            }}
            className="flex items-center justify-center w-10 h-10 rounded-bl-2xl bg-red-50/90 backdrop-blur-sm text-red-500 hover:bg-red-500 hover:text-white transition-all shadow-sm"
            title="Close Session"
          >
            <XCircle className="w-4 h-4" />
          </button>
        )}
        {session.status === 'recovery_required' && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onRecover(session.session_id)
            }}
            className="flex items-center justify-center w-10 h-10 rounded-bl-2xl bg-amber-50/90 backdrop-blur-sm text-amber-500 hover:bg-amber-500 hover:text-white transition-all shadow-sm"
            title="Recover Session"
          >
            <AlertTriangle className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="flex items-start justify-between gap-3 mb-6 flex-1">
        <div className="min-w-0 flex-1">
          <h3 className="font-extrabold text-gray-800 text-base mb-3 truncate pr-2 group-hover:text-pink-600 transition-colors">
            {cardTitle}
          </h3>

          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-pink-100 to-purple-100 shadow-inner flex items-center justify-center font-bold text-pink-600 text-[10px] shrink-0 border border-white/60">
              {(agentName ?? session.agent_id).charAt(0).toUpperCase()}
            </div>
            <p className="font-medium text-gray-600 text-xs truncate">
              {agentName ?? session.agent_id}
            </p>
          </div>
        </div>
        <div className={`transition-opacity duration-200 shrink-0 ${session.status !== 'closed' ? 'group-hover:opacity-0' : ''}`}>
          {badge && <StatusBadge status={badge.label} variant={badge.variant} />}
        </div>
      </div>

      <div className="mt-auto pt-4 border-t border-white/50 flex items-center justify-between">
        <code
          title={session.session_id}
          className="text-[10px] font-mono tracking-wider text-blue-600/80 bg-blue-50/80 border border-blue-100/50 px-2 py-1 rounded-md block truncate max-w-[120px]"
        >
          {session.session_id.slice(0, 10)}…
        </code>

        <div className="flex flex-col items-end gap-0.5 text-[10px] text-gray-400 font-medium">
          <div className="flex items-center gap-1">
            <Clock className="w-[10px] h-[10px]" />
            <span>{formatTimestamp(session.created_at)}</span>
          </div>
          {session.closed_at != null && (
            <span className="text-gray-300">end: {formatTimestamp(session.closed_at)}</span>
          )}
        </div>
      </div>
    </motion.div>
  )
}
