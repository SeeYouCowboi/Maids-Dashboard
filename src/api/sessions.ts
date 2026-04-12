import type {
  SessionListResponse,
  SessionCreateRequest,
  SessionCreateResponse,
  SessionCloseResponse,
  SessionRecoverRequest,
  SessionRecoverResponse,
} from '../contracts'
import { apiFetch } from './client'

export type TranscriptEntry = {
  record_index: number
  timestamp: number
  actor: string
  record_type: string
  request_id?: string
  text?: string
  payload?: unknown
}

export type TranscriptResponse = {
  session_id: string
  entries: readonly TranscriptEntry[]
}

export type MemoryCoreSummaryItem = {
  label: string
  chars_current: number
  char_limit: number
}

export type MemoryView = {
  session_id: string
  core_memory_summary: readonly MemoryCoreSummaryItem[]
  recent_cognition: string
}

export function listSessions(): Promise<SessionListResponse> {
  return apiFetch<SessionListResponse>('/v1/sessions')
}

export function createSession(body: SessionCreateRequest): Promise<SessionCreateResponse> {
  return apiFetch<SessionCreateResponse>('/v1/sessions', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function closeSession(sessionId: string): Promise<SessionCloseResponse> {
  return apiFetch<SessionCloseResponse>(`/v1/sessions/${sessionId}/close`, { method: 'POST' })
}

export function recoverSession(
  sessionId: string,
  body: SessionRecoverRequest,
): Promise<SessionRecoverResponse> {
  return apiFetch<SessionRecoverResponse>(`/v1/sessions/${sessionId}/recover`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function getSessionTranscript(sessionId: string): Promise<TranscriptResponse> {
  return apiFetch<TranscriptResponse>(`/v1/sessions/${sessionId}/transcript`)
}

export function getSessionMemory(sessionId: string): Promise<MemoryView> {
  return apiFetch<MemoryView>(`/v1/sessions/${sessionId}/memory`)
}
