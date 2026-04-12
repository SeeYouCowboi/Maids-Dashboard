import type { ProviderListResponse } from '../contracts'
import { apiFetch } from './client'

export function listProviders(): Promise<ProviderListResponse> {
  return apiFetch<ProviderListResponse>('/v1/providers')
}
