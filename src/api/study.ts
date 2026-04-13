import type { RecentRequestList, RetrievalTrace } from '../contracts'
import { apiFetch } from './client'

export function listRecentRequests(agentId: string, limit = 20): Promise<RecentRequestList> {
  return apiFetch<RecentRequestList>(
    `/v1/agents/${encodeURIComponent(agentId)}/recent-requests?limit=${String(limit)}`,
  )
}

export function getRetrievalTrace(requestId: string): Promise<RetrievalTrace> {
  return apiFetch<RetrievalTrace>(`/v1/requests/${encodeURIComponent(requestId)}/retrieval-trace`)
}
