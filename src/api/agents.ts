import type { AgentListResponse } from '../contracts'
import { apiFetch } from './client'

export function listAgents(): Promise<AgentListResponse> {
  return apiFetch<AgentListResponse>('/v1/agents')
}
