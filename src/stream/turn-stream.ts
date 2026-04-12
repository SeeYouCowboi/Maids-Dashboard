import { apiStream } from '../api/client'

const DATA_PREFIX = 'data: '

export function streamTurn(
  sessionId: string,
  body: unknown,
  onChunk: (chunk: string) => void,
  onDone: () => void,
  onError: (err: Error) => void,
  signal?: AbortSignal,
): () => void {
  const controller = new AbortController()
  const effectiveSignal = signal ?? controller.signal

  if (signal) {
    signal.addEventListener('abort', () => controller.abort(), { once: true })
  }

  void (async () => {
    try {
      const res = await apiStream(
        `/v1/sessions/${sessionId}/turns:stream`,
        body,
        effectiveSignal,
      )

      if (!res.ok || !res.body) {
        onError(new Error(`HTTP ${String(res.status)}`))
        return
      }

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

            let parsed: Record<string, unknown>
            try {
              parsed = JSON.parse(payload) as Record<string, unknown>
            } catch {
              continue
            }

            if (parsed.type === 'done') {
              onDone()
              return
            }

            if (parsed.type === 'error') {
              const errData = parsed.data
              const message =
                typeof errData === 'object' &&
                errData !== null &&
                'message' in errData &&
                typeof (errData as Record<string, unknown>).message === 'string'
                  ? (errData as Record<string, unknown>).message as string
                  : 'Gateway stream error'
              onError(new Error(message))
              return
            }

            onChunk(payload)
          }
        }
      } finally {
        reader.releaseLock()
      }
    } catch (err) {
      if (effectiveSignal.aborted) return
      onError(err instanceof Error ? err : new Error(String(err)))
    }
  })()

  return () => controller.abort()
}
