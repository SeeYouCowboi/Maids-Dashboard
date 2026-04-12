import { describe, it, expect, beforeEach } from 'vitest'
import {
  getSession,
  setSession,
  clearSession,
  getLocal,
  setLocal,
  clearLocal,
  clearAllMc,
} from './storage'

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
})

describe('sessionStorage helpers', () => {
  it('returns null for missing key', () => {
    expect(getSession('nope')).toBeNull()
  })

  it('round-trips a string value', () => {
    setSession('token', 'abc123')
    expect(getSession<string>('token')).toBe('abc123')
  })

  it('round-trips an object value', () => {
    const obj = { a: 1, b: 'two' }
    setSession('prefs', obj)
    expect(getSession<typeof obj>('prefs')).toEqual(obj)
  })

  it('stores under the mc: prefix', () => {
    setSession('token', 'x')
    expect(sessionStorage.getItem('mc:token')).toBe('"x"')
  })

  it('clearSession removes the key', () => {
    setSession('token', 'x')
    clearSession('token')
    expect(getSession('token')).toBeNull()
  })
})

describe('localStorage helpers', () => {
  it('returns null for missing key', () => {
    expect(getLocal('nope')).toBeNull()
  })

  it('round-trips a value', () => {
    setLocal('theme', 'dark')
    expect(getLocal<string>('theme')).toBe('dark')
  })

  it('stores under the mc: prefix', () => {
    setLocal('theme', 'dark')
    expect(localStorage.getItem('mc:theme')).toBe('"dark"')
  })

  it('clearLocal removes the key', () => {
    setLocal('theme', 'dark')
    clearLocal('theme')
    expect(getLocal('theme')).toBeNull()
  })
})

describe('clearAllMc', () => {
  it('removes all mc: keys from both stores', () => {
    setSession('a', 1)
    setSession('b', 2)
    setLocal('c', 3)
    sessionStorage.setItem('other', 'keep')
    localStorage.setItem('other', 'keep')

    clearAllMc()

    expect(getSession('a')).toBeNull()
    expect(getSession('b')).toBeNull()
    expect(getLocal('c')).toBeNull()
    expect(sessionStorage.getItem('other')).toBe('keep')
    expect(localStorage.getItem('other')).toBe('keep')
  })

  it('is a no-op when no mc: keys exist', () => {
    sessionStorage.setItem('other', 'x')
    clearAllMc()
    expect(sessionStorage.getItem('other')).toBe('x')
  })
})
