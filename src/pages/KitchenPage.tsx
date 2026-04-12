import { motion } from 'motion/react'
import { ChefHat } from 'lucide-react'
import { PageHeader } from '../components/ui/PageHeader'
import { GlassCard } from '../components/ui/GlassCard'

export default function KitchenPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Kitchen"
        subtitle="RP commit editor — review and revise turns before canon"
      />
      <GlassCard color="blue">
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <motion.div
            initial={{ scale: 0, rotate: -20 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', bounce: 0.4, duration: 0.8 }}
            className="bg-blue-100 p-5 rounded-3xl mb-6 shadow-sm"
          >
            <ChefHat className="w-12 h-12 text-blue-500" />
          </motion.div>
          <h3 className="text-xl font-bold text-gray-700 mb-2">Kitchen — Coming Soon</h3>
          <p className="text-gray-500 max-w-md">
            The RP commit editor will let you review and revise turns before they go to canon.
          </p>
        </div>
      </GlassCard>
    </div>
  )
}
