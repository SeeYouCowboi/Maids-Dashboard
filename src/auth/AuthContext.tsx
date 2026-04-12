import { createContext } from 'react'

export type AuthContextValue = {
  token: string | null
  setToken: (t: string | null) => void
  logout: () => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)
