import { useState, useRef, useCallback, useEffect } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Send, Square, AlertCircle, RefreshCw } from 'lucide-react'
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
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const prevStreamState = useRef<StreamState>('idle')
  const qc = useQueryClient()

  // Refocus textarea when streaming finishes so the user can keep typing
  useEffect(() => {
    if (prevStreamState.current === 'streaming' && streamState !== 'streaming') {
      requestAnimationFrame(() => textareaRef.current?.focus())
    }
    prevStreamState.current = streamState
  }, [streamState])

  const handleSend = useCallback(() => {
    const text = input.trim()
    // Allow send from 'idle' or 'error' states; block during active streaming.
    if (!text || streamState === 'streaming') return

    // Keep `input` populated — only clear on confirmed success (onDone).
    // This makes Retry a no-op re-invocation and preserves the user's text
    // if the gateway's talker retries exhaust and we surface a terminal error.
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
        abortRef.current = null
        setInput('')
        setStreamState('idle')
        // Pass the final accumulated text (not empty) so the parent keeps
        // the bubble visible until the real transcript entry arrives.
        onStreamUpdate?.(streamAccumRef.current, false)
        void qc.invalidateQueries({ queryKey: queryKeys.sessions.transcript(sessionId) })
      },
      (err) => {
        abortRef.current = null
        setErrorMessage(err.message)
        setStreamState('error')
        // Input stays as-is; textarea stays locked (error → disabled).
        // User must explicitly Retry or Dismiss before continuing.
        void qc.invalidateQueries({ queryKey: queryKeys.sessions.transcript(sessionId) })
        void qc.invalidateQueries({ queryKey: queryKeys.sessions.all })
        onStreamUpdate?.('', false)
      },
    )
    abortRef.current = () => {
      cancel()
      setStreamState('idle')
      onStreamUpdate?.('', false)
    }
  }, [input, streamState, sessionId, qc, onSend, onStreamUpdate])

  const handleDismissError = useCallback(() => {
    setErrorMessage(undefined)
    setStreamState('idle')
  }, [])

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

  // Lock textarea while streaming AND after terminal error.
  // Unlocks only on success (streamState → 'idle' via onDone) or on explicit
  // Dismiss. This enforces: textarea enabled ⇔ previous turn committed.
  const isInputDisabled =
    disabled === true || streamState === 'streaming' || streamState === 'error'
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
            <span className="flex-1 truncate">{errorMessage}</span>
            <button
              type="button"
              onClick={handleSend}
              disabled={input.trim().length === 0}
              className="inline-flex items-center gap-1 font-semibold hover:text-red-800 disabled:opacity-50 disabled:pointer-events-none transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              Retry
            </button>
            <button
              type="button"
              onClick={handleDismissError}
              className="font-semibold hover:text-red-800 transition-colors"
            >
              Dismiss
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex items-end gap-2">
        <div className="relative flex-1">
          <textarea
            ref={textareaRef}
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
