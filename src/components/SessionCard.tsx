import { motion } from 'motion/react'
import { useNavigate } from 'react-router-dom'
import { Clock, AlertTriangle, XCircle, CheckCircle2 } from 'lucide-react'
import type { SessionListItem, SessionStatus } from '../contracts'
import { StatusBadge } from './ui/StatusBadge'

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

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, type: 'spring', stiffness: 260, damping: 22 }}
      className="group bg-white/60 backdrop-blur-sm rounded-2xl p-5 border border-white/80 hover:border-pink-200 hover:shadow-md hover:shadow-pink-100/30 transition-all duration-300 cursor-pointer"
      onClick={() => navigate(`/grand-hall/sessions/${session.session_id}`)}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-pink-200 to-purple-200 flex items-center justify-center font-bold text-pink-600 text-sm shrink-0">
              {(agentName ?? session.agent_id).charAt(0).toUpperCase()}
            </div>
            <p className="font-bold text-gray-800 truncate text-sm">
              {agentName ?? session.agent_id}
            </p>
          </div>
          <code className="text-[11px] text-blue-600/80 bg-blue-50/60 px-2 py-0.5 rounded-lg block truncate max-w-[220px]">
            {session.session_id}
          </code>
        </div>
        {badge && <StatusBadge status={badge.label} variant={badge.variant} />}
      </div>

      <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-3">
        <Clock className="w-3 h-3" />
        <span>{formatTimestamp(session.created_at)}</span>
        {session.closed_at != null && (
          <span className="text-gray-400">→ {formatTimestamp(session.closed_at)}</span>
        )}
      </div>

      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
        {session.status === 'open' && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onClose(session.session_id)
            }}
            className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-red-600 bg-red-50/80 rounded-xl border border-red-100 hover:bg-red-100 transition-colors"
          >
            <XCircle className="w-3 h-3" />
            Close
          </button>
        )}
        {session.status === 'recovery_required' && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onRecover(session.session_id)
            }}
            className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-amber-600 bg-amber-50/80 rounded-xl border border-amber-100 hover:bg-amber-100 transition-colors"
          >
            <AlertTriangle className="w-3 h-3" />
            Recover
          </button>
        )}
        {session.status === 'closed' && (
          <span className="flex items-center gap-1 text-[11px] text-gray-400">
            <CheckCircle2 className="w-3 h-3" />
            Finalized
          </span>
        )}
      </div>
    </motion.div>
  )
}
