import { motion, AnimatePresence } from 'motion/react'
import { WifiOff } from 'lucide-react'
import { useOffline } from '../hooks/OfflineContext'

export function OfflineBanner() {
  const { isOffline } = useOffline()

  return (
    <AnimatePresence>
      {isOffline && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ type: 'spring', bounce: 0.15, duration: 0.4 }}
          className="relative z-50 overflow-hidden"
        >
          <div className="flex items-center justify-center gap-2 bg-red-500/90 backdrop-blur-md text-white text-sm font-bold py-2 px-4">
            <WifiOff className="w-4 h-4 shrink-0" />
            <span>Gateway unreachable — connections and writes are paused</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
