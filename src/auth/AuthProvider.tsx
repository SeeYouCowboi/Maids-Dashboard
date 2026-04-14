import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { AuthContext } from './AuthContext'
import type { AuthContextValue } from './AuthContext'
import { getLocal, setLocal, clearLocal, getSession, clearSession } from '../lib/storage'
import { registerAuthAccessor } from '../api/client'

const TOKEN_KEY = 'token'

function loadInitialToken(): string | null {
  const fromLocal = getLocal<string>(TOKEN_KEY)
  if (fromLocal !== null) return fromLocal
  const legacy = getSession<string>(TOKEN_KEY)
  if (legacy !== null) {
    setLocal(TOKEN_KEY, legacy)
    clearSession(TOKEN_KEY)
    return legacy
  }
  return null
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(loadInitialToken)
  const tokenRef = useRef(token)
  tokenRef.current = token

  const setToken = useCallback((t: string | null) => {
    if (t === null) {
      clearLocal(TOKEN_KEY)
    } else {
      setLocal(TOKEN_KEY, t)
    }
    setTokenState(t)
  }, [])

  const logout = useCallback(() => {
    clearLocal(TOKEN_KEY)
    setTokenState(null)
  }, [])

  useEffect(() => {
    registerAuthAccessor(() => tokenRef.current, logout)
  }, [logout])

  const value = useMemo<AuthContextValue>(
    () => ({ token, setToken, logout }),
    [token, setToken, logout],
  )

  return <AuthContext value={value}>{children}</AuthContext>
}
