import type {
  SessionListResponse,
  SessionCreateRequest,
  SessionCreateResponse,
  SessionCloseResponse,
  SessionRecoverRequest,
  SessionRecoverResponse,
  TurnStreamRequest,
} from '../contracts'
import { apiFetch } from './client'

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

export function getSessionTranscript(sessionId: string): Promise<unknown> {
  return apiFetch(`/v1/sessions/${sessionId}/transcript`)
}

export function getSessionMemory(sessionId: string): Promise<unknown> {
  return apiFetch(`/v1/sessions/${sessionId}/memory`)
}

export type { TurnStreamRequest }
