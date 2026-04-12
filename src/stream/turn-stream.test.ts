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

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('streamTurn', () => {
  it('emits parsed chunks from SSE data lines', async () => {
    const chunks: string[] = []
    const response = makeSseResponse([
      'data: {"type":"chunk","content":"hello"}\n\n',
      'data: {"type":"chunk","content":"world"}\n\n',
      'data: {"type":"done"}\n\n',
    ])

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response)

    const cleanup = streamTurn('sess-1', {}, (chunk) => {
      chunks.push(chunk)
    })

    await vi.waitFor(() => expect(chunks.length).toBe(3), { timeout: 2000 })

    expect(JSON.parse(chunks[0]!)).toEqual({
      type: 'chunk',
      content: 'hello',
    })
    expect(JSON.parse(chunks[1]!)).toEqual({
      type: 'chunk',
      content: 'world',
    })
    expect(JSON.parse(chunks[2]!)).toEqual({ type: 'done' })

    cleanup()
  })

  it('skips malformed data lines', async () => {
    const chunks: string[] = []
    const response = makeSseResponse([
      'data: {"type":"chunk","content":"ok"}\n\n',
      'data: NOT_JSON\n\n',
      'data: {"type":"done"}\n\n',
    ])

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response)

    streamTurn('sess-1', {}, (chunk) => {
      chunks.push(chunk)
    })

    await vi.waitFor(() => expect(chunks.length).toBe(2), { timeout: 2000 })

    expect(JSON.parse(chunks[0]!)).toEqual({
      type: 'chunk',
      content: 'ok',
    })
    expect(JSON.parse(chunks[1]!)).toEqual({ type: 'done' })
  })

  it('handles data split across chunks', async () => {
    const chunks: string[] = []
    const response = makeSseResponseChunked(['data: {"type":"ch', 'unk","content":"split"}\n\n'])

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response)

    streamTurn('sess-1', {}, (chunk) => {
      chunks.push(chunk)
    })

    await vi.waitFor(() => expect(chunks.length).toBe(1), { timeout: 2000 })

    expect(JSON.parse(chunks[0]!)).toEqual({
      type: 'chunk',
      content: 'split',
    })
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
          ctrl.enqueue(encoder.encode('data: {"type":"chunk","content":"a"}\n\n'))
          controller.abort()
        } else {
          ctrl.enqueue(encoder.encode('data: {"type":"chunk","content":"b"}\n\n'))
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
      controller.signal,
    )

    await new Promise((r) => setTimeout(r, 200))

    expect(chunks.length).toBeLessThanOrEqual(1)
  })

  it('handles done event termination', async () => {
    const chunks: string[] = []
    const response = makeSseResponse([
      'data: {"type":"chunk","content":"hi"}\n\n',
      'data: {"type":"done"}\n\n',
    ])

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response)

    streamTurn('sess-1', {}, (chunk) => {
      chunks.push(chunk)
    })

    await vi.waitFor(() => expect(chunks.length).toBe(2), { timeout: 2000 })

    expect(JSON.parse(chunks[1]!)).toEqual({ type: 'done' })
  })
})
