import type { HealthzResponse, ReadyzResponse } from '../contracts'
import { apiFetch } from './client'

export function getHealthz(): Promise<HealthzResponse> {
  return apiFetch<HealthzResponse>('/healthz')
}

export function getReadyz(): Promise<ReadyzResponse> {
  return apiFetch<ReadyzResponse>('/readyz')
}
