import { motion } from 'motion/react'
import { Music } from 'lucide-react'
import { PageHeader } from '../components/ui/PageHeader'
import { GlassCard } from '../components/ui/GlassCard'

export default function BallroomPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Ballroom"
        subtitle="Multi-agent group RP — rooms, participants, broadcast"
      />
      <GlassCard color="amber">
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <motion.div
            initial={{ scale: 0, rotate: -20 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', bounce: 0.4, duration: 0.8 }}
            className="bg-amber-100 p-5 rounded-3xl mb-6 shadow-sm"
          >
            <Music className="w-12 h-12 text-amber-500" />
          </motion.div>
          <h3 className="text-xl font-bold text-gray-700 mb-2">Ballroom — Coming Soon</h3>
          <p className="text-gray-500 max-w-md">
            Group RP rooms with multi-agent coordination and live broadcast will appear here.
          </p>
        </div>
      </GlassCard>
    </div>
  )
}
