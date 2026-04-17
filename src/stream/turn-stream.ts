import { apiStream } from '../api/client'

const DATA_PREFIX = 'data: '
const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 45_000

type StreamTurnOptions = {
  idleTimeoutMs?: number
}

class StreamReadAbortedError extends Error {
  constructor() {
    super('Stream read aborted')
    this.name = 'StreamReadAbortedError'
  }
}

function combineAbortSignals(localSignal: AbortSignal, externalSignal?: AbortSignal): AbortSignal {
  if (!externalSignal) return localSignal

  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any([localSignal, externalSignal])
  }

  const combined = new AbortController()
  const abort = () => combined.abort()

  if (localSignal.aborted || externalSignal.aborted) {
    combined.abort()
    return combined.signal
  }

  localSignal.addEventListener('abort', abort, { once: true })
  externalSignal.addEventListener('abort', abort, { once: true })
  return combined.signal
}

function readNextChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
  idleTimeoutMs: number,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  return new Promise((resolve, reject) => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId)
      signal.removeEventListener('abort', handleAbort)
    }

    const handleAbort = () => {
      cleanup()
      reject(new StreamReadAbortedError())
    }

    if (signal.aborted) {
      handleAbort()
      return
    }

    signal.addEventListener('abort', handleAbort, { once: true })

    if (idleTimeoutMs > 0) {
      timeoutId = setTimeout(() => {
        cleanup()
        reject(
          new Error(
            `Gateway stream timed out after ${String(Math.ceil(idleTimeoutMs / 1000))}s waiting for the next SSE event`,
          ),
        )
      }, idleTimeoutMs)
    }

    void reader.read().then(
      (result) => {
        cleanup()
        resolve(result)
      },
      (err) => {
        cleanup()
        reject(err)
      },
    )
  })
}

export function streamTurn(
  sessionId: string,
  body: unknown,
  onChunk: (chunk: string) => void,
  onDone: () => void,
  onError: (err: Error) => void,
  signal?: AbortSignal,
  options: StreamTurnOptions = {},
): () => void {
  const controller = new AbortController()
  const effectiveSignal = combineAbortSignals(controller.signal, signal)
  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS
  let settled = false

  const finishWithDone = () => {
    if (settled) return
    settled = true
    onDone()
  }

  const finishWithError = (err: Error) => {
    if (settled) return
    settled = true
    onError(err)
  }

  void (async () => {
    try {
      const res = await apiStream(
        `/v1/sessions/${sessionId}/turns:stream`,
        body,
        effectiveSignal,
      )

      if (!res.ok || !res.body) {
        finishWithError(new Error(`HTTP ${String(res.status)}`))
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      try {
        for (;;) {
          if (effectiveSignal.aborted || settled) break

          const { done, value } = await readNextChunk(reader, effectiveSignal, idleTimeoutMs)
          if (done) {
            if (!effectiveSignal.aborted && !settled) {
              finishWithError(new Error('Gateway stream closed before done/error'))
            }
            return
          }

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
              finishWithDone()
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
              finishWithError(new Error(message))
              return
            }

            onChunk(payload)
          }
        }
      } finally {
        try {
          await reader.cancel()
        } catch {}
        try {
          reader.releaseLock()
        } catch {}
      }
    } catch (err) {
      if (effectiveSignal.aborted || err instanceof StreamReadAbortedError || settled) return
      finishWithError(err instanceof Error ? err : new Error(String(err)))
    }
  })()

  return () => controller.abort()
}
