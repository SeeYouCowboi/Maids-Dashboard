import { useState, useRef, useCallback } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Send, Square, AlertCircle } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import type { TurnStreamRequest } from '../contracts'
import { streamTurn } from '../stream/turn-stream'
import { queryKeys } from '../query/keys'

interface ChatComposerProps {
  sessionId: string
  disabled?: boolean | undefined
  onSend?: (text: string) => void
  onStreamUpdate?: (text: string, active: boolean) => void
}

type StreamState = 'idle' | 'streaming' | 'error'

interface StreamChunk {
  raw: string
  parsed: Record<string, unknown>
}

function tryParseChunk(raw: string): StreamChunk | undefined {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return { raw, parsed }
  } catch {
    return undefined
  }
}

function extractChunkText(chunk: StreamChunk): string {
  if (chunk.parsed.type === 'delta') {
    const data = chunk.parsed.data
    if (typeof data === 'object' && data !== null && 'text' in data) {
      const text = (data as Record<string, unknown>).text
      if (typeof text === 'string') return text
    }
  }
  return ''
}

export function ChatComposer({ sessionId, disabled, onSend, onStreamUpdate }: ChatComposerProps) {
  const [input, setInput] = useState('')
  const [streamState, setStreamState] = useState<StreamState>('idle')
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined)
  const abortRef = useRef<(() => void) | null>(null)
  const streamAccumRef = useRef('')
  const qc = useQueryClient()

  const handleSend = useCallback(() => {
    const text = input.trim()
    if (!text || streamState === 'streaming') return

    setInput('')
    setErrorMessage(undefined)
    setStreamState('streaming')
    streamAccumRef.current = ''
    onSend?.(text)
    onStreamUpdate?.('', true)

    const body: TurnStreamRequest = {
      user_message: { text },
    }

    const cancel = streamTurn(
      sessionId,
      body,
      (chunk) => {
        const parsed = tryParseChunk(chunk)
        if (parsed) {
          const delta = extractChunkText(parsed)
          if (delta) {
            streamAccumRef.current += delta
            onStreamUpdate?.(streamAccumRef.current, true)
          }
        }
      },
      () => {
        setStreamState('idle')
        onStreamUpdate?.('', false)
        void qc.invalidateQueries({ queryKey: queryKeys.sessions.transcript(sessionId) })
      },
      (err) => {
        setErrorMessage(err.message)
        setStreamState('error')
        onStreamUpdate?.('', false)
      },
    )
    abortRef.current = () => {
      cancel()
      setStreamState('idle')
      onStreamUpdate?.('', false)
    }
  }, [input, streamState, sessionId, qc, onStreamUpdate])

  const handleAbort = useCallback(() => {
    abortRef.current?.()
    abortRef.current = null
    setStreamState('idle')
    onStreamUpdate?.('', false)
  }, [onStreamUpdate])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend],
  )

  const isInputDisabled = disabled === true || streamState === 'streaming'
  const canSend = input.trim().length > 0 && !isInputDisabled

  return (
    <div className="space-y-2">
      <AnimatePresence>
        {errorMessage != null && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="flex items-center gap-2 bg-red-50/80 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-600"
          >
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            {errorMessage}
            <button
              type="button"
              onClick={() => setErrorMessage(undefined)}
              className="ml-auto font-semibold hover:text-red-800 transition-colors"
            >
              Dismiss
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex items-end gap-2">
        <div className="relative flex-1">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isInputDisabled ? 'Waiting for reply…' : 'Type a message… (Enter to send)'}
            disabled={isInputDisabled}
            rows={1}
            className="w-full bg-transparent border-none rounded-2xl px-0 py-1 pr-8 text-sm leading-relaxed text-gray-700 placeholder-gray-300 resize-none focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            aria-label="Send message"
            className="absolute right-2 bottom-2 p-1.5 rounded-xl text-pink-400 hover:text-pink-600 hover:bg-pink-50/80 disabled:text-gray-200 disabled:pointer-events-none transition-all duration-200"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>

        {streamState === 'streaming' && (
          <button
            type="button"
            onClick={handleAbort}
            aria-label="Stop streaming"
            className="shrink-0 p-2.5 rounded-2xl text-gray-400 hover:text-rose-400 hover:bg-rose-50/60 border border-transparent hover:border-rose-100 transition-all duration-200"
          >
            <Square className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  )
}
