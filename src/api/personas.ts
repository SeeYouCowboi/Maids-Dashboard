import type { PersonaListResponse, PersonaDetail, PersonaForm } from '../contracts'
import { apiFetch } from './client'

export function listPersonas(): Promise<PersonaListResponse> {
  return apiFetch<PersonaListResponse>('/v1/personas')
}

export function getPersona(id: string): Promise<PersonaDetail> {
  return apiFetch<PersonaDetail>(`/v1/personas/${id}`)
}

export function createPersona(body: PersonaForm): Promise<PersonaDetail> {
  return apiFetch<PersonaDetail>('/v1/personas', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function updatePersona(id: string, body: PersonaForm): Promise<PersonaDetail> {
  return apiFetch<PersonaDetail>(`/v1/personas/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export function deletePersona(id: string): Promise<void> {
  return apiFetch<void>(`/v1/personas/${id}`, { method: 'DELETE' })
}

export function reloadPersonas(): Promise<void> {
  return apiFetch<void>('/v1/personas:reload', { method: 'POST' })
}
