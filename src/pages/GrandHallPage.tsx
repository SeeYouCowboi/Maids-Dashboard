import { motion } from 'motion/react'
import { Home } from 'lucide-react'
import { PageHeader } from '../components/ui/PageHeader'
import { GlassCard } from '../components/ui/GlassCard'

export default function GrandHallPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Grand Hall"
        subtitle="Agent overview — sessions, activity, connection status"
      />
      <GlassCard color="pink">
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <motion.div
            initial={{ scale: 0, rotate: -20 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', bounce: 0.4, duration: 0.8 }}
            className="bg-pink-100 p-5 rounded-3xl mb-6 shadow-sm"
          >
            <Home className="w-12 h-12 text-pink-500" />
          </motion.div>
          <h3 className="text-xl font-bold text-gray-700 mb-2">Grand Hall — Coming Soon</h3>
          <p className="text-gray-500 max-w-md">
            Agent sessions, live activity feed, and connection status will appear here once the full
            implementation lands.
          </p>
        </div>
      </GlassCard>
    </div>
  )
}
