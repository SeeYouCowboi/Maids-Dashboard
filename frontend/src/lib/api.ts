import { ApiError } from './types';

export function getConfirmSecret(): string | null {
  return sessionStorage.getItem('confirm-secret');
}

export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const secret = getConfirmSecret();
  const headers = new Headers(options.headers);
  
  if (secret) {
    headers.set('X-Confirm-Secret', secret);
  }
  
  const response = await fetch(path, {
    ...options,
    headers,
  });
  
  if (!response.ok) {
    const error: ApiError = {
      message: `HTTP ${response.status}: ${response.statusText}`,
      status: response.status,
    };
    throw error;
  }
  
  return response;
}

export async function apiGet<T>(path: string): Promise<T> {
  const response = await apiFetch(path, {
    method: 'GET',
  });
  return response.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const response = await apiFetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return response.json() as Promise<T>;
}

export async function apiPut<T>(path: string, body?: unknown): Promise<T> {
  const response = await apiFetch(path, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return response.json() as Promise<T>;
}

export async function apiDelete<T>(path: string): Promise<T> {
  const response = await apiFetch(path, {
    method: 'DELETE',
  });
  return response.json() as Promise<T>;
}
