import type { StateSnapshot, MaidenDecisionList } from '../contracts'
import { apiFetch } from './client'

export function getStateSnapshot(sessionId?: string): Promise<StateSnapshot> {
  const qs = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : ''
  return apiFetch<StateSnapshot>(`/v1/state/snapshot${qs}`)
}

export function listMaidenDecisions(sessionId?: string): Promise<MaidenDecisionList> {
  const qs = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : ''
  return apiFetch<MaidenDecisionList>(`/v1/state/maiden-decisions${qs}`)
}
