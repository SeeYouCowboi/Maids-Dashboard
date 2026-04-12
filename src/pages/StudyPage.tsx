import { motion } from 'motion/react'
import { GraduationCap } from 'lucide-react'
import { PageHeader } from '../components/ui/PageHeader'
import { GlassCard } from '../components/ui/GlassCard'

export default function StudyPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Study" subtitle="Memory inspection — core memory, episodes, narratives" />
      <GlassCard>
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <motion.div
            initial={{ scale: 0, rotate: -20 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', bounce: 0.4, duration: 0.8 }}
            className="bg-indigo-100 p-5 rounded-3xl mb-6 shadow-sm"
          >
            <GraduationCap className="w-12 h-12 text-indigo-500" />
          </motion.div>
          <h3 className="text-xl font-bold text-gray-700 mb-2">Study — Placeholder</h3>
          <p className="text-gray-500 max-w-md">
            Core memory blocks, episodic recall, and narrative arcs will be inspectable here.
          </p>
        </div>
      </GlassCard>
    </div>
  )
}
