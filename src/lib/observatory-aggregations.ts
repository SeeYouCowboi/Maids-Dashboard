import type { HealthzResponse, JobListResponse, SessionListItem } from '../contracts'

type DayKey = string

export function groupSessionsByDay(sessions: readonly SessionListItem[]): Record<DayKey, number> {
  const buckets: Record<string, number> = {}
  for (const s of sessions) {
    const day = epochToDay(s.created_at)
    const prev = buckets[day]
    buckets[day] = (prev ?? 0) + 1
  }
  return buckets
}

export type HealthSummary = {
  gatewayStatus: 'ok' | 'offline'
  activeSessionCount: number
  recentJobCount: number
}

export function computeHealthSummary(
  sessions: readonly SessionListItem[] | undefined,
  jobs: JobListResponse | undefined,
  health: HealthzResponse | undefined,
): HealthSummary {
  const gatewayStatus: 'ok' | 'offline' = health?.status === 'ok' ? 'ok' : 'offline'
  const activeSessionCount = sessions?.filter((s) => s.status === 'open').length ?? 0
  const recentJobCount = jobs?.items.length ?? 0
  return { gatewayStatus, activeSessionCount, recentJobCount }
}

export type DayDataPoint = {
  day: string
  count: number
}

export function buildWeeklyTimeline(grouped: Record<DayKey, number>): DayDataPoint[] {
  const today = new Date()
  const points: DayDataPoint[] = []

  for (let i = 6; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const key = formatDay(d)
    points.push({ day: key, count: grouped[key] ?? 0 })
  }

  return points
}

function epochToDay(epoch: number): string {
  return formatDay(new Date(epoch * 1000))
}

function formatDay(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${String(y)}-${m}-${day}`
}
