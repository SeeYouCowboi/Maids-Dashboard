/* ── Session title utilities ──────────────────────────────────────── */

import { getLocal, setLocal } from './storage'

const TITLE_PREFIX = 'session-title:'

/**
 * Read a locally-persisted session title.
 * Returns `null` if no title has been generated yet.
 */
export function getSessionTitle(sessionId: string): string | null {
    return getLocal<string>(`${TITLE_PREFIX}${sessionId}`)
}

/**
 * Persist a locally-generated session title.
 */
export function setSessionTitle(sessionId: string, title: string): void {
    setLocal(`${TITLE_PREFIX}${sessionId}`, title)
}

/**
 * Derive a session title from messages.
 *
 * Strategy:
 * - Takes the first user message text.
 * - Strips leading greetings/filler.
 * - Truncates to `maxLen` characters.
 *
 * Returns `null` if there isn't enough material.
 */
export function deriveSessionTitle(
    messages: readonly { actor: string; text?: string }[],
    maxLen = 20,
): string | null {
    const userMessages: { actor: string; text: string }[] = messages.filter(
        (m): m is { actor: string; text: string } =>
            m.actor === 'user' && typeof m.text === 'string' && m.text.trim().length > 0,
    )
    const first = userMessages[0]
    if (!first) return null

    let text = first.text.trim()

    // Strip common greeting prefixes (Chinese and English)
    text = text
        .replace(/^(你好[，,！!]?\s*|hi[,，!！]?\s*|hello[,，!！]?\s*|hey[,，!！]?\s*)/i, '')
        .trim()

    // If only a sentence-final particle remains (e.g. "你好啊" → "啊"), treat as empty
    if (/^[啊哦嗯呢吧哈噢呵哇哉咯嗦喽呀哟]{1,3}[！!？?。.～~]*$/.test(text)) {
        text = ''
    }

    if (text.length === 0) {
        const second = userMessages[1]
        if (second) text = second.text.trim()
    }

    if (text.length === 0) return null

    // Remove line breaks — take only first line
    const firstLine = (text.split(/[\r\n]/)[0] ?? text).trim()
    if (firstLine.length <= maxLen) return firstLine
    return firstLine.slice(0, maxLen) + '…'
}

/** Minimum number of message entries before we attempt to auto-generate a title. */
export const TITLE_MIN_MESSAGES = 4
