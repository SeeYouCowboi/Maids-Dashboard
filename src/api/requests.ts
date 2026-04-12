import { apiFetch } from './client'

export function getRequestSummary(requestId: string): Promise<unknown> {
  return apiFetch(`/v1/requests/${requestId}/summary`)
}

export function getRequestPrompt(requestId: string): Promise<unknown> {
  return apiFetch(`/v1/requests/${requestId}/prompt`)
}

export function getRequestChunks(requestId: string): Promise<unknown> {
  return apiFetch(`/v1/requests/${requestId}/chunks`)
}

export function getRequestDiagnose(requestId: string): Promise<unknown> {
  return apiFetch(`/v1/requests/${requestId}/diagnose`)
}

export function getRequestTrace(requestId: string): Promise<unknown> {
  return apiFetch(`/v1/requests/${requestId}/trace`)
}

import type { RetrievalTrace } from '../contracts'

export function getRetrievalTrace(requestId: string): Promise<RetrievalTrace> {
  return apiFetch<RetrievalTrace>(`/v1/requests/${requestId}/retrieval-trace`)
}

export function getLogs(): Promise<unknown> {
  return apiFetch('/v1/logs')
}
