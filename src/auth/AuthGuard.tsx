import type { ReactNode } from 'react'
import { useAuth } from './useAuth'
import { LoginScreen } from './LoginScreen'

export function AuthGuard({ children }: { children: ReactNode }) {
  const { token } = useAuth()

  if (!token) {
    return <LoginScreen />
  }

  return <>{children}</>
}
