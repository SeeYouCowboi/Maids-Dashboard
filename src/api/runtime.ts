import type { RuntimeSnapshot } from '../contracts'
import { apiFetch } from './client'

export function getRuntimeSnapshot(): Promise<RuntimeSnapshot> {
  return apiFetch<RuntimeSnapshot>('/v1/runtime')
}
