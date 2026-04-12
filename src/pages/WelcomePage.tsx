import { motion } from 'motion/react'
import {
  Sparkles,
  Heart,
  Home,
  BookOpen,
  Wifi,
  WifiOff,
  KeyRound,
  Server,
  GitBranch,
  Globe,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { useHealth } from '../hooks/useHealth'
import { useAuth } from '../auth/useAuth'
import { GlassCard } from '../components/ui/GlassCard'
import { StatusBadge } from '../components/ui/StatusBadge'

const NAV_CARDS = [
  {
    to: '/grand-hall',
    label: 'Grand Hall',
    description: 'Agent overview, sessions & activity',
    icon: Home,
    gradient: 'from-pink-400 to-rose-500',
    shadow: 'shadow-pink-200/50',
  },
  {
    to: '/library',
    label: 'Library',
    description: 'Characters, lorebook & world building',
    icon: BookOpen,
    gradient: 'from-purple-400 to-violet-500',
    shadow: 'shadow-purple-200/50',
  },
] as const

function truncateSha(sha: string): string {
  return sha.length > 8 ? sha.slice(0, 8) : sha
}

export default function WelcomePage() {
  const { isOnline, isOffline, isLoading } = useHealth()
  const { token } = useAuth()
  const isAuthenticated = token !== null

  const apiBase = import.meta.env.VITE_API_BASE || 'http://localhost:18790'
  const appVersion = __APP_VERSION__
  const maidsclawSha = __MAIDSCLAW_SHA__

  return (
    <div className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden px-6 pb-24 pt-12">
      <motion.div
        animate={{ y: [0, -20, 0], rotate: [0, 5, -5, 0] }}
        transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute top-1/4 left-1/4 text-pink-300 pointer-events-none"
      >
        <Sparkles className="w-16 h-16" />
      </motion.div>
      <motion.div
        animate={{ y: [0, 30, 0], rotate: [0, -10, 10, 0] }}
        transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute bottom-1/3 right-1/4 text-purple-300 pointer-events-none"
      >
        <Heart className="w-20 h-20 fill-purple-300" />
      </motion.div>
      <motion.div
        animate={{ y: [0, -15, 0], scale: [1, 1.1, 1] }}
        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute top-1/3 right-1/3 text-blue-300 pointer-events-none"
      >
        <Sparkles className="w-10 h-10" />
      </motion.div>

      <div className="relative z-10 w-full max-w-3xl mx-auto space-y-10">
        <div className="text-center space-y-6">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', bounce: 0.5, duration: 1 }}
            className="w-40 h-40 mx-auto bg-gradient-to-tr from-pink-300 via-purple-300 to-blue-300 rounded-[2.5rem] p-1.5 shadow-2xl shadow-pink-200/50 rotate-3 hover:rotate-0 transition-transform duration-500"
          >
            <div className="w-full h-full bg-gradient-to-br from-pink-100 to-purple-100 rounded-[2rem] border-4 border-white flex items-center justify-center">
              <Heart className="w-16 h-16 text-pink-400 fill-pink-300" />
            </div>
          </motion.div>

          <motion.h1
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.2, duration: 0.8 }}
            className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-pink-500 via-purple-500 to-blue-500 drop-shadow-sm tracking-tight"
          >
            Welcome, Master!
          </motion.h1>
          <motion.p
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.4, duration: 0.8 }}
            className="text-lg text-gray-600 font-bold max-w-xl mx-auto leading-relaxed"
          >
            Your AI maids are ready and waiting.{' '}
            <span className="text-pink-400">Let&apos;s create some wonderful memories today!</span>
          </motion.p>
        </div>

        <motion.div
          initial={{ y: 30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.5, duration: 0.7 }}
        >
          <GlassCard title="System Status" color="purple">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex items-center gap-3">
                <div
                  className={`p-2 rounded-xl ${isOnline ? 'bg-emerald-100 text-emerald-600' : isOffline ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-400'}`}
                >
                  {isOnline ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
                </div>
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                    Gateway
                  </span>
                  {isLoading ? (
                    <span className="text-sm text-gray-400">Checking…</span>
                  ) : (
                    <StatusBadge
                      status={isOnline ? 'Online' : 'Offline'}
                      variant={isOnline ? 'success' : 'error'}
                    />
                  )}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div
                  className={`p-2 rounded-xl ${isAuthenticated ? 'bg-blue-100 text-blue-600' : 'bg-amber-100 text-amber-600'}`}
                >
                  <KeyRound className="w-4 h-4" />
                </div>
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                    Auth
                  </span>
                  <StatusBadge
                    status={isAuthenticated ? 'Authenticated' : 'No Token'}
                    variant={isAuthenticated ? 'success' : 'warning'}
                  />
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-purple-100 text-purple-600">
                  <Server className="w-4 h-4" />
                </div>
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                    Dashboard
                  </span>
                  <span className="text-sm font-bold text-gray-700">v{appVersion}</span>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-pink-100 text-pink-600">
                  <GitBranch className="w-4 h-4" />
                </div>
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                    MaidsClaw
                  </span>
                  <span className="text-sm font-bold text-gray-700 font-mono">
                    {truncateSha(maidsclawSha)}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-3 sm:col-span-2">
                <div className="p-2 rounded-xl bg-blue-100 text-blue-600">
                  <Globe className="w-4 h-4" />
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                    API Base
                  </span>
                  <span className="text-sm font-bold text-gray-700 font-mono truncate">
                    {apiBase}
                  </span>
                </div>
              </div>
            </div>
          </GlassCard>
        </motion.div>

        <motion.div
          initial={{ y: 30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.7, duration: 0.7 }}
          className="grid grid-cols-1 sm:grid-cols-2 gap-5"
        >
          {NAV_CARDS.map((card, i) => (
            <Link key={card.to} to={card.to} className="block group">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.8 + i * 0.12, type: 'spring', bounce: 0.3 }}
                className={`relative overflow-hidden rounded-2xl p-5 bg-white/40 backdrop-blur-xl border border-white/60 shadow-sm hover:shadow-lg ${card.shadow} transition-all duration-300 group-hover:-translate-y-1`}
              >
                <div
                  className={`inline-flex items-center justify-center w-11 h-11 rounded-xl bg-gradient-to-br ${card.gradient} text-white shadow-sm mb-3`}
                >
                  <card.icon className="w-5 h-5" />
                </div>
                <h3 className="text-lg font-black text-gray-800 mb-1">{card.label}</h3>
                <p className="text-sm text-gray-500 font-semibold leading-snug">
                  {card.description}
                </p>
                <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-white/20 to-transparent rounded-bl-full pointer-events-none" />
              </motion.div>
            </Link>
          ))}
        </motion.div>
      </div>
    </div>
  )
}
