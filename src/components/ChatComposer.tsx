import { useState, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Send, Square, AlertCircle } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import type { TurnStreamRequest } from '../contracts'
import { streamTurn } from '../stream/turn-stream'
import { queryKeys } from '../query/keys'

interface ChatComposerProps {
  sessionId: string
  disabled?: boolean | undefined
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

export function ChatComposer({ sessionId, disabled }: ChatComposerProps) {
  const [input, setInput] = useState('')
  const [streamState, setStreamState] = useState<StreamState>('idle')
  const [streamedText, setStreamedText] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined)
  const abortRef = useRef<(() => void) | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const qc = useQueryClient()

  const handleSend = useCallback(() => {
    const text = input.trim()
    if (!text || streamState === 'streaming') return

    setInput('')
    setStreamedText('')
    setErrorMessage(undefined)
    setStreamState('streaming')

    const body: TurnStreamRequest = {
      user_message: { text },
    }

    const cancel = streamTurn(
      sessionId,
      body,
      (chunk) => {
        const parsed = tryParseChunk(chunk)
        if (parsed) {
          setStreamedText((prev) => prev + extractChunkText(parsed))
        }
      },
      () => {
        setStreamState('idle')
        void qc.invalidateQueries({ queryKey: queryKeys.sessions.transcript(sessionId) })
      },
      (err) => {
        setErrorMessage(err.message)
        setStreamState('error')
      },
    )
    abortRef.current = () => {
      cancel()
      setStreamState('idle')
    }
  }, [input, streamState, sessionId, qc])

  const handleAbort = useCallback(() => {
    abortRef.current?.()
    abortRef.current = null
    setStreamState('idle')
  }, [])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend],
  )

  const isDisabled = disabled === true || streamState === 'streaming'

  return (
    <div className="space-y-3">
      <AnimatePresence mode="wait">
        {streamedText.length > 0 && (
          <motion.div
            key="streamed"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-white/50 backdrop-blur-sm border border-white/70 rounded-2xl p-4 text-sm text-gray-700 whitespace-pre-wrap max-h-64 overflow-y-auto"
          >
            {streamedText}
            {streamState === 'streaming' && (
              <span className="inline-block w-1.5 h-4 bg-pink-400 animate-pulse ml-0.5 rounded-full align-text-bottom" />
            )}
          </motion.div>
        )}
      </AnimatePresence>

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
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isDisabled ? 'Session is not accepting messages…' : 'Type your message…'}
          disabled={isDisabled}
          rows={1}
          className="flex-1 bg-white/60 backdrop-blur-sm border border-white/80 rounded-2xl px-4 py-3 text-sm text-gray-700 placeholder-gray-400 resize-none focus:outline-none focus:border-pink-300 focus:ring-2 focus:ring-pink-100 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300"
        />
        {streamState === 'streaming' ? (
          <button
            type="button"
            onClick={handleAbort}
            className="shrink-0 p-3 rounded-2xl bg-red-50 border border-red-200 text-red-500 hover:bg-red-100 hover:text-red-600 transition-all duration-200"
            aria-label="Stop streaming"
          >
            <Square className="w-4 h-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSend}
            disabled={isDisabled || input.trim().length === 0}
            className="shrink-0 p-3 rounded-2xl bg-gradient-to-br from-pink-400 to-pink-500 text-white shadow-sm hover:shadow-md hover:from-pink-500 hover:to-pink-600 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none transition-all duration-200"
            aria-label="Send message"
          >
            <Send className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  )
}
