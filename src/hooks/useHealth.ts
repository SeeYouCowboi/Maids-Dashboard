import { useQuery } from '@tanstack/react-query'
import type { HealthzResponse } from '../contracts'
import { getHealthz } from '../api/health'
import { queryKeys } from '../query/keys'

const HEALTH_POLL_MS = 10_000

export function useHealth() {
  const query = useQuery<HealthzResponse, Error>({
    queryKey: queryKeys.health.healthz,
    queryFn: getHealthz,
    refetchInterval: HEALTH_POLL_MS,
    retry: 0,
    staleTime: HEALTH_POLL_MS,
  })

  const isOnline = query.isSuccess && query.data?.status === 'ok'
  const isOffline = query.isError || (query.isSuccess && query.data?.status !== 'ok')

  return {
    isOnline,
    isOffline,
    isLoading: query.isLoading,
    error: query.error,
    data: query.data,
  } as const
}
