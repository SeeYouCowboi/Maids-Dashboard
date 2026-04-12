import { useCallback, useState } from 'react'

import { clearAllMc, getLocal, setLocal } from '../lib/storage'

export type ThemePref = 'system' | 'light' | 'dark'
export type PollingInterval = 15 | 30 | 60

export interface Prefs {
  theme: ThemePref
  pollingInterval: PollingInterval
  apiBaseOverride: string
}

const VALID_THEMES = new Set<string>(['system', 'light', 'dark'])
const VALID_INTERVALS = new Set<number>([15, 30, 60])

function readTheme(): ThemePref {
  const raw = getLocal<string>('theme')
  if (raw !== null && VALID_THEMES.has(raw)) return raw as ThemePref
  return 'system'
}

function readPollingInterval(): PollingInterval {
  const raw = getLocal<number>('pollingInterval')
  if (raw !== null && VALID_INTERVALS.has(raw)) return raw as PollingInterval
  return 30
}

function readApiBaseOverride(): string {
  return getLocal<string>('apiBaseOverride') ?? ''
}

export function usePrefs() {
  const [theme, setThemeRaw] = useState<ThemePref>(readTheme)
  const [pollingInterval, setPollingRaw] = useState<PollingInterval>(readPollingInterval)
  const [apiBaseOverride, setApiBaseRaw] = useState<string>(readApiBaseOverride)

  const setTheme = useCallback((v: ThemePref) => {
    setLocal('theme', v)
    setThemeRaw(v)
  }, [])

  const setPollingInterval = useCallback((v: PollingInterval) => {
    setLocal('pollingInterval', v)
    setPollingRaw(v)
  }, [])

  const setApiBaseOverride = useCallback((v: string) => {
    setLocal('apiBaseOverride', v)
    setApiBaseRaw(v)
  }, [])

  const resetAll = useCallback(() => {
    clearAllMc()
    window.location.reload()
  }, [])

  return {
    theme,
    pollingInterval,
    apiBaseOverride,
    setTheme,
    setPollingInterval,
    setApiBaseOverride,
    resetAll,
  } as const
}
