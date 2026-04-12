import { ChefHat, ClipboardList, Clock, GitCommit, Sparkles } from 'lucide-react'
import { motion } from 'motion/react'

import { GlassCard } from '../components/ui/GlassCard'
import { PageHeader } from '../components/ui/PageHeader'
import { StatusBadge } from '../components/ui/StatusBadge'

const PLANNED_FEATURES = [
  {
    icon: ClipboardList,
    title: 'Task Submission',
    description:
      'Submit structured tasks to agents with context, constraints, and priority levels.',
  },
  {
    icon: Clock,
    title: 'Scheduled Tasks',
    description: 'Queue and schedule recurring or deferred tasks with cron-like timing controls.',
  },
  {
    icon: GitCommit,
    title: 'Turn Review & Commit',
    description: 'Review, revise, and approve RP turns before they are committed to canon.',
  },
] as const

export default function KitchenPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Kitchen" subtitle="Task submission and scheduled task management">
        <StatusBadge status="Coming in v2" variant="info" />
      </PageHeader>

      <GlassCard color="blue">
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <motion.div
            initial={{ scale: 0, rotate: -20 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', bounce: 0.4, duration: 0.8 }}
            className="bg-blue-100 p-5 rounded-3xl mb-6 shadow-sm"
          >
            <ChefHat className="w-12 h-12 text-blue-500" />
          </motion.div>
          <h3 className="text-xl font-bold text-gray-700 mb-2">Kitchen — Under Construction</h3>
          <p className="text-gray-500 max-w-lg mb-2">
            The Kitchen will be the command center for task orchestration — submit work to agents,
            schedule recurring operations, and review RP turns before they become canon.
          </p>
          <p className="text-gray-400 text-sm max-w-md">
            This room is planned for the v2 release and is not yet functional.
          </p>
        </div>
      </GlassCard>

      <div className="grid gap-4 sm:grid-cols-3">
        {PLANNED_FEATURES.map((feature, i) => (
          <motion.div
            key={feature.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', bounce: 0.3, duration: 0.6, delay: 0.15 * (i + 1) }}
          >
            <GlassCard className="h-full opacity-75">
              <div className="flex items-start gap-3">
                <div className="bg-blue-50 p-2.5 rounded-xl shrink-0">
                  <feature.icon className="w-5 h-5 text-blue-400" />
                </div>
                <div className="text-left">
                  <h4 className="font-semibold text-gray-600 text-sm mb-1">{feature.title}</h4>
                  <p className="text-gray-400 text-xs leading-relaxed">{feature.description}</p>
                </div>
              </div>
            </GlassCard>
          </motion.div>
        ))}
      </div>

      <GlassCard className="opacity-60">
        <div className="flex items-center gap-3 text-gray-400">
          <Sparkles className="w-4 h-4 shrink-0" />
          <p className="text-xs">
            The Kitchen will integrate with the MaidsClaw task pipeline once the v2 backend
            endpoints are available.
          </p>
        </div>
      </GlassCard>
    </div>
  )
}
