import { apiFetch } from './client'

export type LightweightCompleteRequest = {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  system?: string
  model?: string
  max_tokens?: number
  temperature?: number
}

export type LightweightCompleteResponse = {
  text: string
  model: string
}

export function lightweightComplete(
  body: LightweightCompleteRequest,
): Promise<LightweightCompleteResponse> {
  return apiFetch<LightweightCompleteResponse>('/v1/util/complete', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}
