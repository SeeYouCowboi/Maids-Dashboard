import { apiStream } from '../api/client'

const DATA_PREFIX = 'data: '

export function streamTurn(
  sessionId: string,
  body: unknown,
  onChunk: (chunk: string) => void,
  signal?: AbortSignal,
): () => void {
  const controller = new AbortController()
  const effectiveSignal = signal ?? controller.signal

  if (signal) {
    signal.addEventListener('abort', () => controller.abort(), { once: true })
  }

  void (async () => {
    const res = await apiStream(`/v1/sessions/${sessionId}/turns:stream`, body)

    if (!res.ok || !res.body) return

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      for (;;) {
        if (effectiveSignal.aborted) break

        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith(DATA_PREFIX)) continue
          const payload = trimmed.slice(DATA_PREFIX.length)
          if (payload.length === 0) continue

          try {
            JSON.parse(payload)
            onChunk(payload)
          } catch {
            continue
          }
        }
      }
    } finally {
      reader.releaseLock()
    }
  })()

  return () => controller.abort()
}
