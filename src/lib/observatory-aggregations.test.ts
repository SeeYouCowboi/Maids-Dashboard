import { describe, expect, it } from 'vitest'
import type { SessionListItem } from '../contracts'
import {
  buildWeeklyTimeline,
  computeHealthSummary,
  groupSessionsByDay,
} from './observatory-aggregations'

function makeSession(
  overrides: Partial<SessionListItem> & { created_at: number },
): SessionListItem {
  return {
    session_id: `s-${String(Math.random()).slice(2, 8)}`,
    agent_id: 'agent-1',
    status: 'open',
    ...overrides,
  }
}

describe('groupSessionsByDay', () => {
  it('returns empty record for empty input', () => {
    expect(groupSessionsByDay([])).toEqual({})
  })

  it('groups sessions by their creation date', () => {
    const sessions = [
      makeSession({ created_at: Date.UTC(2025, 0, 15, 10) }),
      makeSession({ created_at: Date.UTC(2025, 0, 15, 14) }),
      makeSession({ created_at: Date.UTC(2025, 0, 16, 8) }),
    ]

    const grouped = groupSessionsByDay(sessions)
    const jan15 = grouped['2025-01-15']
    const jan16 = grouped['2025-01-16']
    expect(jan15).toBe(2)
    expect(jan16).toBe(1)
  })

  it('handles a single session', () => {
    const sessions = [makeSession({ created_at: Date.UTC(2025, 5, 1, 12) })]
    const grouped = groupSessionsByDay(sessions)
    expect(Object.keys(grouped).length).toBe(1)
  })
})

describe('computeHealthSummary', () => {
  it('returns offline when health is undefined', () => {
    const result = computeHealthSummary([], undefined, undefined)
    expect(result.gatewayStatus).toBe('offline')
    expect(result.activeSessionCount).toBe(0)
    expect(result.recentJobCount).toBe(0)
  })

  it('counts only open sessions as active', () => {
    const sessions = [
      makeSession({ created_at: 1000, status: 'open' }),
      makeSession({ created_at: 2000, status: 'closed' }),
      makeSession({ created_at: 3000, status: 'open' }),
      makeSession({ created_at: 4000, status: 'recovery_required' }),
    ]
    const result = computeHealthSummary(
      sessions,
      { items: [1, 2, 3], next_cursor: null },
      {
        status: 'ok',
      },
    )
    expect(result.gatewayStatus).toBe('ok')
    expect(result.activeSessionCount).toBe(2)
    expect(result.recentJobCount).toBe(3)
  })

  it('handles undefined sessions gracefully', () => {
    const result = computeHealthSummary(undefined, undefined, { status: 'ok' })
    expect(result.gatewayStatus).toBe('ok')
    expect(result.activeSessionCount).toBe(0)
    expect(result.recentJobCount).toBe(0)
  })
})

describe('buildWeeklyTimeline', () => {
  it('returns exactly 7 data points', () => {
    const result = buildWeeklyTimeline({})
    expect(result).toHaveLength(7)
  })

  it('fills missing days with count 0', () => {
    const result = buildWeeklyTimeline({})
    for (const point of result) {
      expect(point.count).toBe(0)
    }
  })

  it('uses provided counts for matching days', () => {
    const today = new Date()
    const y = today.getFullYear()
    const m = String(today.getMonth() + 1).padStart(2, '0')
    const d = String(today.getDate()).padStart(2, '0')
    const todayKey = `${String(y)}-${m}-${d}`

    const result = buildWeeklyTimeline({ [todayKey]: 5 })
    const todayPoint = result[result.length - 1]
    expect(todayPoint).toBeDefined()
    expect(todayPoint?.day).toBe(todayKey)
    expect(todayPoint?.count).toBe(5)
  })

  it('orders days from oldest to newest', () => {
    const result = buildWeeklyTimeline({})
    for (let i = 1; i < result.length; i++) {
      const current = result[i]
      const previous = result[i - 1]
      expect(current).toBeDefined()
      expect(previous).toBeDefined()
      if (current && previous) {
        expect(current.day > previous.day).toBe(true)
      }
    }
  })
})
