import type { LoreListResponse, LoreDetail, LoreForm } from '../contracts'
import { apiFetch } from './client'

export function listLore(): Promise<LoreListResponse> {
  return apiFetch<LoreListResponse>('/v1/lore')
}

export function getLore(id: string): Promise<LoreDetail> {
  return apiFetch<LoreDetail>(`/v1/lore/${id}`)
}

export function createLore(body: LoreForm): Promise<LoreDetail> {
  return apiFetch<LoreDetail>('/v1/lore', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function updateLore(id: string, body: LoreForm): Promise<LoreDetail> {
  return apiFetch<LoreDetail>(`/v1/lore/${id}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

export function deleteLore(id: string): Promise<void> {
  return apiFetch<void>(`/v1/lore/${id}`, { method: 'DELETE' })
}
