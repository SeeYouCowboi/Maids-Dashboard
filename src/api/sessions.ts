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
  role: string
  content: string
  timestamp: number
  metadata?: Record<string, unknown> | undefined
}

export type TranscriptResponse = {
  entries: readonly TranscriptEntry[]
}

export type MemorySnapshotBlock = {
  label: string
  content: string
}

export type MemorySnapshotResponse = {
  blocks: readonly MemorySnapshotBlock[]
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

export function getSessionMemory(sessionId: string): Promise<MemorySnapshotResponse> {
  return apiFetch<MemorySnapshotResponse>(`/v1/sessions/${sessionId}/memory`)
}
