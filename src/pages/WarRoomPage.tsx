import { motion } from 'motion/react'
import { Shield } from 'lucide-react'
import { PageHeader } from '../components/ui/PageHeader'
import { GlassCard } from '../components/ui/GlassCard'

export default function WarRoomPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="War Room" subtitle="Dispatch failures and agent conflicts" />
      <GlassCard color="red">
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <motion.div
            initial={{ scale: 0, rotate: -20 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', bounce: 0.4, duration: 0.8 }}
            className="bg-red-100 p-5 rounded-3xl mb-6 shadow-sm"
          >
            <Shield className="w-12 h-12 text-red-500" />
          </motion.div>
          <h3 className="text-xl font-bold text-gray-700 mb-2">War Room — Placeholder</h3>
          <p className="text-gray-500 max-w-md">
            Dispatch failure tracking and agent conflict resolution will be available here.
          </p>
        </div>
      </GlassCard>
    </div>
  )
}
