import { motion } from 'motion/react'
import { Flower2 } from 'lucide-react'
import { PageHeader } from '../components/ui/PageHeader'
import { GlassCard } from '../components/ui/GlassCard'

export default function GardenPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Garden" subtitle="Cron job toggles, heartbeat configuration, settings" />
      <GlassCard>
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <motion.div
            initial={{ scale: 0, rotate: -20 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', bounce: 0.4, duration: 0.8 }}
            className="bg-green-100 p-5 rounded-3xl mb-6 shadow-sm"
          >
            <Flower2 className="w-12 h-12 text-green-500" />
          </motion.div>
          <h3 className="text-xl font-bold text-gray-700 mb-2">Garden — Placeholder</h3>
          <p className="text-gray-500 max-w-md">
            Cron schedules, heartbeat settings, and system configuration will be managed here.
          </p>
        </div>
      </GlassCard>
    </div>
  )
}
