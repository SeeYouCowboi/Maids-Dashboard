import { createContext, useContext } from 'react'

export type OfflineContextValue = {
  isOffline: boolean
  isLoading: boolean
}

export const OfflineContext = createContext<OfflineContextValue>({
  isOffline: false,
  isLoading: true,
})

export function useOffline(): OfflineContextValue {
  return useContext(OfflineContext)
}
