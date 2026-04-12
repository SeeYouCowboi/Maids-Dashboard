import type { GatewayErrorEnvelope, GatewayErrorCodeUnion } from '../contracts'

const DEFAULT_BASE = 'http://localhost:18790'

function getApiBase(): string {
  try {
    return import.meta.env.VITE_API_BASE || DEFAULT_BASE
  } catch {
    return DEFAULT_BASE
  }
}

function isLocalhostOrigin(url: URL): boolean {
  const host = url.hostname
  return host === 'localhost' || host === '127.0.0.1' || host === '::1'
}

function assertOriginSafe(base: string): void {
  const url = new URL(base)
  if (url.protocol === 'https:') return
  if (isLocalhostOrigin(url)) return
  throw new Error(`Refusing to send token over insecure origin: ${url.origin}`)
}

export class ApiError extends Error {
  readonly status: number
  readonly code: GatewayErrorCodeUnion | string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

let _tokenAccessor: (() => string | null) | undefined
let _onUnauthorized: (() => void) | undefined

export function registerAuthAccessor(
  getToken: () => string | null,
  onUnauthorized: () => void,
): void {
  _tokenAccessor = getToken
  _onUnauthorized = onUnauthorized
}

async function parseErrorBody(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as unknown
    if (typeof body === 'object' && body !== null && 'error' in body) {
      const envelope = body as GatewayErrorEnvelope
      return new ApiError(res.status, envelope.error.code, envelope.error.message)
    }
  } catch {}
  return new ApiError(res.status, 'UNKNOWN', res.statusText)
}

export async function apiFetch<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const base = getApiBase()
  assertOriginSafe(base)

  const headers = new Headers(options.headers)
  const token = _tokenAccessor?.()
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json')
  }

  const res = await fetch(`${base}${path}`, {
    ...options,
    headers,
  })

  if (!res.ok) {
    if (res.status === 401) {
      _onUnauthorized?.()
    }
    throw await parseErrorBody(res)
  }

  return res.json() as Promise<T>
}

export function apiStream(path: string, body: unknown): Promise<Response> {
  const base = getApiBase()
  assertOriginSafe(base)

  const headers = new Headers({
    'Content-Type': 'application/json',
  })
  const token = _tokenAccessor?.()
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  return fetch(`${base}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}
