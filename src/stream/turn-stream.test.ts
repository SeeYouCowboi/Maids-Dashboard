import { describe, it, expect, vi, beforeEach } from 'vitest'
import { streamTurn } from './turn-stream'

function makeSseResponse(lines: string[]): Response {
  const body = lines.join('')
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(body))
      controller.close()
    },
  })
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

function makeSseResponseChunked(chunks: string[]): Response {
  const encoder = new TextEncoder()
  let idx = 0
  const stream = new ReadableStream({
    pull(controller) {
      if (idx < chunks.length) {
        const chunk = chunks[idx]!
        controller.enqueue(encoder.encode(chunk))
        idx++
      } else {
        controller.close()
      }
    },
  })
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

function makeHangingSseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  let idx = 0
  const stream = new ReadableStream({
    pull(controller) {
      if (idx < chunks.length) {
        controller.enqueue(encoder.encode(chunks[idx]!))
        idx++
        return
      }
      return new Promise(() => {})
    },
  })
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('streamTurn', () => {
  it('emits parsed delta chunks and fires onDone', async () => {
    const chunks: string[] = []
    const onDone = vi.fn()
    const response = makeSseResponse([
      'data: {"type":"delta","data":{"text":"hello"}}\n\n',
      'data: {"type":"delta","data":{"text":"world"}}\n\n',
      'data: {"type":"done","data":{"total_tokens":2}}\n\n',
    ])

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response)

    const cleanup = streamTurn('sess-1', {}, (chunk) => {
      chunks.push(chunk)
    }, onDone, vi.fn())

    await vi.waitFor(() => expect(onDone).toHaveBeenCalledOnce(), { timeout: 2000 })

    expect(chunks).toHaveLength(2)
    expect(JSON.parse(chunks[0]!)).toEqual({ type: 'delta', data: { text: 'hello' } })
    expect(JSON.parse(chunks[1]!)).toEqual({ type: 'delta', data: { text: 'world' } })

    cleanup()
  })

  it('skips malformed data lines', async () => {
    const chunks: string[] = []
    const onDone = vi.fn()
    const response = makeSseResponse([
      'data: {"type":"delta","data":{"text":"ok"}}\n\n',
      'data: NOT_JSON\n\n',
      'data: {"type":"done","data":{"total_tokens":1}}\n\n',
    ])

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response)

    streamTurn('sess-1', {}, (chunk) => {
      chunks.push(chunk)
    }, onDone, vi.fn())

    await vi.waitFor(() => expect(onDone).toHaveBeenCalledOnce(), { timeout: 2000 })

    expect(chunks).toHaveLength(1)
    expect(JSON.parse(chunks[0]!)).toEqual({ type: 'delta', data: { text: 'ok' } })
  })

  it('handles data split across network chunks', async () => {
    const chunks: string[] = []
    const onDone = vi.fn()
    const response = makeSseResponseChunked([
      'data: {"type":"del',
      'ta","data":{"text":"split"}}\n\ndata: {"type":"done","data":{"total_tokens":1}}\n\n',
    ])

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response)

    streamTurn('sess-1', {}, (chunk) => {
      chunks.push(chunk)
    }, onDone, vi.fn())

    await vi.waitFor(() => expect(onDone).toHaveBeenCalledOnce(), { timeout: 2000 })

    expect(chunks).toHaveLength(1)
    expect(JSON.parse(chunks[0]!)).toEqual({ type: 'delta', data: { text: 'split' } })
  })

  it('stops when aborted via signal', async () => {
    const chunks: string[] = []
    const controller = new AbortController()

    let pullCount = 0
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async pull(ctrl) {
        pullCount++
        if (pullCount === 1) {
          ctrl.enqueue(encoder.encode('data: {"type":"delta","data":{"text":"a"}}\n\n'))
          controller.abort()
        } else {
          ctrl.enqueue(encoder.encode('data: {"type":"delta","data":{"text":"b"}}\n\n'))
          ctrl.close()
        }
      },
    })

    const response = new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response)

    streamTurn(
      'sess-1',
      {},
      (chunk) => {
        chunks.push(chunk)
      },
      vi.fn(),
      vi.fn(),
      controller.signal,
    )

    await new Promise((r) => setTimeout(r, 200))

    expect(chunks.length).toBeLessThanOrEqual(1)
  })

  it('fires onDone on done event and stops emitting chunks', async () => {
    const chunks: string[] = []
    const onDone = vi.fn()
    const response = makeSseResponse([
      'data: {"type":"delta","data":{"text":"hi"}}\n\n',
      'data: {"type":"done","data":{"total_tokens":1}}\n\n',
    ])

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response)

    streamTurn('sess-1', {}, (chunk) => {
      chunks.push(chunk)
    }, onDone, vi.fn())

    await vi.waitFor(() => expect(onDone).toHaveBeenCalledOnce(), { timeout: 2000 })

    expect(chunks).toHaveLength(1)
    expect(JSON.parse(chunks[0]!)).toEqual({ type: 'delta', data: { text: 'hi' } })
  })

  it('fires onError on non-2xx response', async () => {
    const onError = vi.fn()
    const response = new Response(null, { status: 503 })

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response)

    streamTurn('sess-1', {}, vi.fn(), vi.fn(), onError)

    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce(), { timeout: 2000 })

    expect((onError.mock.calls[0]![0] as Error).message).toContain('503')
  })

  it('fires onError (not onChunk) when gateway emits error event', async () => {
    const chunks: string[] = []
    const onError = vi.fn()
    const onDone = vi.fn()
    const response = makeSseResponse([
      'data: {"type":"delta","data":{"text":"hello"}}\n\n',
      'data: {"type":"error","data":{"code":"AGENT_RUNTIME_ERROR","message":"Model unavailable","retriable":false}}\n\n',
    ])

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response)

    streamTurn('sess-1', {}, (chunk) => chunks.push(chunk), onDone, onError)

    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce(), { timeout: 2000 })

    // Only the delta chunk before the error should be emitted
    expect(chunks).toHaveLength(1)
    expect(JSON.parse(chunks[0]!)).toEqual({ type: 'delta', data: { text: 'hello' } })
    // onDone must NOT be called
    expect(onDone).not.toHaveBeenCalled()
    // Error message should be forwarded
    expect((onError.mock.calls[0]![0] as Error).message).toBe('Model unavailable')
  })

  it('fires onError when the stream closes before done/error', async () => {
    const chunks: string[] = []
    const onError = vi.fn()
    const onDone = vi.fn()
    const response = makeSseResponse(['data: {"type":"delta","data":{"text":"partial"}}\n\n'])

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response)

    streamTurn('sess-1', {}, (chunk) => chunks.push(chunk), onDone, onError)

    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce(), { timeout: 2000 })

    expect(chunks).toHaveLength(1)
    expect(onDone).not.toHaveBeenCalled()
    expect((onError.mock.calls[0]![0] as Error).message).toContain('closed before done/error')
  })

  it('fires onError when the stream goes idle before the next event', async () => {
    const chunks: string[] = []
    const onError = vi.fn()
    const onDone = vi.fn()
    const response = makeHangingSseResponse([
      'data: {"type":"delta","data":{"text":"hello"}}\n\n',
    ])

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response)

    streamTurn(
      'sess-1',
      {},
      (chunk) => chunks.push(chunk),
      onDone,
      onError,
      undefined,
      { idleTimeoutMs: 20 },
    )

    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce(), { timeout: 2000 })

    expect(chunks).toHaveLength(1)
    expect(onDone).not.toHaveBeenCalled()
    expect((onError.mock.calls[0]![0] as Error).message).toContain('timed out')
  })
})
