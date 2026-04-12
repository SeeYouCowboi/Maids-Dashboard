import { Music, Puzzle, Radio, Sparkles, Users } from 'lucide-react'
import { motion } from 'motion/react'

import { GlassCard } from '../components/ui/GlassCard'
import { PageHeader } from '../components/ui/PageHeader'
import { StatusBadge } from '../components/ui/StatusBadge'

const PLANNED_FEATURES = [
  {
    icon: Users,
    title: 'Multi-Agent Sessions',
    description:
      'Create group RP rooms with multiple agents interacting in a shared narrative space.',
  },
  {
    icon: Radio,
    title: 'Live Broadcast',
    description: 'Stream collaborative sessions in real-time with SSE-powered event broadcasting.',
  },
  {
    icon: Puzzle,
    title: 'Architecture Extensions',
    description:
      'Requires MaidsClaw architecture extensions for cross-agent coordination and state sync.',
  },
] as const

export default function BallroomPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Ballroom"
        subtitle="Multi-agent group interactions and collaborative sessions"
      >
        <StatusBadge status="Coming in v2" variant="warning" />
      </PageHeader>

      <GlassCard color="amber">
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <motion.div
            initial={{ scale: 0, rotate: -20 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', bounce: 0.4, duration: 0.8 }}
            className="bg-amber-100 p-5 rounded-3xl mb-6 shadow-sm"
          >
            <Music className="w-12 h-12 text-amber-500" />
          </motion.div>
          <h3 className="text-xl font-bold text-gray-700 mb-2">Ballroom — Under Construction</h3>
          <p className="text-gray-500 max-w-lg mb-2">
            The Ballroom will host multi-agent group RP — create rooms, add participants, and
            orchestrate collaborative narrative sessions with live broadcast.
          </p>
          <p className="text-gray-400 text-sm max-w-md">
            This room is planned for the v2 release and requires MaidsClaw architecture extensions.
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
                <div className="bg-amber-50 p-2.5 rounded-xl shrink-0">
                  <feature.icon className="w-5 h-5 text-amber-400" />
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
            The Ballroom depends on cross-agent coordination primitives that are being designed as
            part of MaidsClaw v2.
          </p>
        </div>
      </GlassCard>
    </div>
  )
}
