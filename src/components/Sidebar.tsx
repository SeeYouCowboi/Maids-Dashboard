import { useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Heart, ChevronLeft, ChevronRight } from 'lucide-react'
import { NAV_ROOMS } from '../room-registry'
import type { RoomDefinition } from '../room-registry'

const SIDEBAR_WIDTH = 220

interface SidebarProps {
  activeTab: string | null
  onTabClick: (tabId: string) => void
  isOpen: boolean
  onToggle: () => void
  isMobile?: boolean | undefined
}

export default function Sidebar({
  activeTab,
  onTabClick,
  isOpen,
  onToggle,
  isMobile = false,
}: SidebarProps) {
  const touchStartX = useRef(0)

  const handleSidebarTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0]!.clientX
  }
  const handleSidebarTouchEnd = (e: React.TouchEvent) => {
    const dx = e.changedTouches[0]!.clientX - touchStartX.current
    if (!isOpen && dx > 36) onToggle()
    if (isOpen && dx < -36) onToggle()
  }

  function renderNavItem(room: RoomDefinition, layoutIdSuffix: string) {
    const Icon = room.icon
    const isActive = activeTab === room.id
    return (
      <button
        key={room.id}
        type="button"
        onClick={() => onTabClick(room.id)}
        className={`w-full flex items-center px-2 py-3 rounded-2xl transition-all duration-300 relative overflow-hidden group select-none ${
          isActive ? 'text-gray-900 font-bold shadow-sm' : 'text-gray-500 hover:bg-white/50'
        }`}
        title={!isOpen && !isMobile ? room.label : undefined}
      >
        {isActive && (
          <motion.div
            layoutId={`activeTab${layoutIdSuffix}`}
            className={`absolute inset-0 ${room.bg} ${isMobile ? 'opacity-60' : 'opacity-50'}`}
            initial={false}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          />
        )}
        <div
          className={`relative z-10 p-2 rounded-xl transition-colors shrink-0 ${
            isActive ? 'bg-white shadow-sm' : 'bg-white/60 group-hover:bg-white'
          }`}
        >
          <Icon
            className={`w-5 h-5 ${isActive ? room.color : 'text-gray-400 group-hover:text-pink-400'}`}
          />
        </div>
        {(isOpen || isMobile) && (
          <AnimatePresence mode="popLayout">
            <motion.span
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.2, ease: 'easeOut', delay: 0.05 }}
              className="relative z-10 text-sm font-semibold whitespace-nowrap ml-3"
            >
              {room.label}
            </motion.span>
          </AnimatePresence>
        )}
      </button>
    )
  }

  if (isMobile) {
    return (
      <>
        <AnimatePresence>
          {isOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22 }}
              onClick={onToggle}
              className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
            />
          )}
        </AnimatePresence>

        <motion.aside
          initial={false}
          animate={{ x: isOpen ? 0 : -SIDEBAR_WIDTH }}
          transition={{ type: 'spring', bounce: 0, duration: 0.4 }}
          className="fixed inset-y-0 left-0 z-50 flex flex-col"
          style={{ width: SIDEBAR_WIDTH }}
          onTouchStart={handleSidebarTouchStart}
          onTouchEnd={handleSidebarTouchEnd}
        >
          <div className="absolute inset-0 bg-white/90 backdrop-blur-xl border-r border-white/50 shadow-[4px_0_24px_-12px_rgba(0,0,0,0.2)]" />

          <div className="relative px-4 py-6 flex items-center select-none">
            <div className="bg-pink-100 p-2 rounded-2xl shrink-0 shadow-sm">
              <Heart className="w-8 h-8 text-pink-500 fill-pink-500 animate-pulse" />
            </div>
            <h1 className="text-xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-pink-500 to-purple-500 whitespace-nowrap ml-3">
              MaidManager
            </h1>
          </div>

          <nav className="relative flex-1 px-3 py-2 space-y-1 overflow-y-auto overflow-x-hidden">
            {NAV_ROOMS.map((room) => renderNavItem(room, 'Mobile'))}
          </nav>

          <div className="relative p-4 w-full shrink-0 flex flex-col items-center gap-3 overflow-hidden pb-6">
            <div className="w-[188px] shrink-0 overflow-hidden">
              <div className="bg-gradient-to-br from-pink-100/80 to-purple-100/80 backdrop-blur-md rounded-3xl p-4 text-center relative overflow-hidden border border-white/50 shadow-sm w-full select-none">
                <div className="absolute top-0 right-0 -mt-4 -mr-4 w-16 h-16 bg-white/60 rounded-full blur-xl" />
                <p className="text-sm font-bold text-gray-700 mb-1 truncate">
                  Master, welcome back!
                </p>
                <p className="text-xs text-gray-500 line-clamp-2 leading-tight">
                  Your maids are waiting.
                </p>
              </div>
            </div>
          </div>
        </motion.aside>
      </>
    )
  }

  return (
    <motion.aside
      initial={false}
      animate={{ width: isOpen ? 220 : 80 }}
      transition={{ type: 'spring', bounce: 0, duration: 0.4 }}
      className="bg-white/30 backdrop-blur-xl border-r border-white/50 shadow-[4px_0_24px_-12px_rgba(0,0,0,0.1)] flex flex-col z-20 relative shrink-0"
    >
      <button
        type="button"
        onClick={onToggle}
        className="absolute -right-3.5 top-8 bg-white shadow-md rounded-full p-1.5 text-pink-500 hover:text-pink-600 hover:scale-110 transition-all z-30 border border-pink-100"
        aria-label={isOpen ? 'Collapse sidebar' : 'Expand sidebar'}
      >
        {isOpen ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
      </button>

      <button
        type="button"
        onClick={onToggle}
        className="px-4 py-6 flex items-center text-left hover:bg-white/40 transition-colors select-none w-full"
        title="Toggle sidebar"
      >
        <div className="bg-pink-100 p-2 rounded-2xl shrink-0 shadow-sm">
          <Heart className="w-8 h-8 text-pink-500 fill-pink-500 animate-pulse" />
        </div>
        <AnimatePresence mode="popLayout">
          {isOpen && (
            <motion.h1
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="text-xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-pink-500 to-purple-500 whitespace-nowrap ml-3"
            >
              MaidManager
            </motion.h1>
          )}
        </AnimatePresence>
      </button>

      <nav className="flex-1 px-3 py-2 space-y-1 overflow-y-auto overflow-x-hidden">
        {NAV_ROOMS.map((room) => renderNavItem(room, ''))}
      </nav>

      <div className="p-4 w-full shrink-0 flex flex-col items-center gap-3 overflow-hidden pb-6">
        <AnimatePresence mode="wait">
          {isOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              className="w-[188px] shrink-0 overflow-hidden"
            >
              <div className="bg-gradient-to-br from-pink-100/80 to-purple-100/80 backdrop-blur-md rounded-3xl p-4 text-center relative overflow-hidden border border-white/50 shadow-sm w-full select-none">
                <div className="absolute top-0 right-0 -mt-4 -mr-4 w-16 h-16 bg-white/60 rounded-full blur-xl" />
                <p className="text-sm font-bold text-gray-700 mb-1 truncate">
                  Master, welcome back!
                </p>
                <p className="text-xs text-gray-500 line-clamp-2 leading-tight">
                  Your maids are waiting.
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.aside>
  )
}
