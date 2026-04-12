import { motion } from 'motion/react'
import { BarChart3 } from 'lucide-react'
import { PageHeader } from '../components/ui/PageHeader'
import { GlassCard } from '../components/ui/GlassCard'

export default function ObservatoryPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Observatory"
        subtitle="Metrics, event log, activity timeline, plot branch inspector"
      />
      <GlassCard color="emerald">
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <motion.div
            initial={{ scale: 0, rotate: -20 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', bounce: 0.4, duration: 0.8 }}
            className="bg-emerald-100 p-5 rounded-3xl mb-6 shadow-sm"
          >
            <BarChart3 className="w-12 h-12 text-emerald-500" />
          </motion.div>
          <h3 className="text-xl font-bold text-gray-700 mb-2">Observatory — Placeholder</h3>
          <p className="text-gray-500 max-w-md">
            System metrics, event logs, and the activity timeline will be displayed here.
          </p>
        </div>
      </GlassCard>
    </div>
  )
}
