const PREFIX = 'mc:'

function prefixed(key: string): string {
  return `${PREFIX}${key}`
}

export function getSession<T>(key: string): T | null {
  const raw = sessionStorage.getItem(prefixed(key))
  if (raw === null) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return raw as unknown as T
  }
}

export function setSession<T>(key: string, val: T): void {
  sessionStorage.setItem(prefixed(key), JSON.stringify(val))
}

export function clearSession(key: string): void {
  sessionStorage.removeItem(prefixed(key))
}

export function getLocal<T>(key: string): T | null {
  const raw = localStorage.getItem(prefixed(key))
  if (raw === null) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return raw as unknown as T
  }
}

export function setLocal<T>(key: string, val: T): void {
  localStorage.setItem(prefixed(key), JSON.stringify(val))
}

export function clearLocal(key: string): void {
  localStorage.removeItem(prefixed(key))
}

export function clearAllMc(): void {
  for (const store of [sessionStorage, localStorage]) {
    const toRemove: string[] = []
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i)
      if (k?.startsWith(PREFIX)) {
        toRemove.push(k)
      }
    }
    for (const k of toRemove) {
      store.removeItem(k)
    }
  }
}
