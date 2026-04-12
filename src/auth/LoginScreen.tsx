import { useState } from 'react'
import type { FormEvent } from 'react'
import { useAuth } from './useAuth'

export function LoginScreen() {
  const { setToken } = useAuth()
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = input.trim()
    if (trimmed.length === 0) {
      setError('Token cannot be empty')
      return
    }
    setError(null)
    setToken(trimmed)
  }

  return (
    <div className="flex items-center justify-center min-h-screen">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm p-8 space-y-4 bg-white/80 backdrop-blur-md rounded-2xl shadow-lg border border-white/60"
      >
        <h1 className="text-xl font-semibold text-center text-gray-800">MaidsClaw Dashboard</h1>
        <p className="text-sm text-center text-gray-500">Enter your bearer token to continue</p>

        <input
          type="password"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Bearer token"
          autoFocus
          className="w-full px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-pink-300 transition-all"
        />

        {error && <p className="text-sm text-red-500 text-center">{error}</p>}

        <button
          type="submit"
          className="w-full py-2.5 rounded-xl bg-pink-500 text-white font-medium hover:bg-pink-600 transition-colors cursor-pointer"
        >
          Connect
        </button>
      </form>
    </div>
  )
}
