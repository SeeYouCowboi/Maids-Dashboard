import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { AuthContext } from './AuthContext'
import type { AuthContextValue } from './AuthContext'
import { getSession, setSession, clearSession } from '../lib/storage'
import { registerAuthAccessor } from '../api/client'

const TOKEN_KEY = 'token'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string | null>(() => getSession<string>(TOKEN_KEY))
  const tokenRef = useRef(token)
  tokenRef.current = token

  const setToken = useCallback((t: string | null) => {
    if (t === null) {
      clearSession(TOKEN_KEY)
    } else {
      setSession(TOKEN_KEY, t)
    }
    setTokenState(t)
  }, [])

  const logout = useCallback(() => {
    clearSession(TOKEN_KEY)
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
