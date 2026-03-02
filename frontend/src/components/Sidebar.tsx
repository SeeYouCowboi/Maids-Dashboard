import { motion, AnimatePresence } from 'motion/react';
import {
  Home, ChefHat, BookOpen, BarChart3, Shield, Flower2, Music,
  Heart, ChevronLeft, ChevronRight, Wifi, WifiOff, Loader2,
} from 'lucide-react';
import type { SSEState } from '../hooks/useSSE';

const TABS = [
  { id: 'grand-hall', label: 'Grand Hall', icon: Home, color: 'text-pink-500', bg: 'bg-pink-100' },
  { id: 'kitchen', label: 'Kitchen', icon: ChefHat, color: 'text-blue-500', bg: 'bg-blue-100' },
  { id: 'library', label: 'Library', icon: BookOpen, color: 'text-purple-500', bg: 'bg-purple-100' },
  { id: 'observatory', label: 'Observatory', icon: BarChart3, color: 'text-emerald-500', bg: 'bg-emerald-100' },
  { id: 'war-room', label: 'War Room', icon: Shield, color: 'text-red-500', bg: 'bg-red-100' },
  { id: 'garden', label: 'Garden', icon: Flower2, color: 'text-green-500', bg: 'bg-green-100' },
  { id: 'ballroom', label: 'Ballroom', icon: Music, color: 'text-amber-500', bg: 'bg-amber-100' },
];

interface SidebarProps {
  activeTab: string | null;
  onTabClick: (tabId: string) => void;
  isOpen: boolean;
  onToggle: () => void;
  sseState: SSEState;
}

export default function Sidebar({ activeTab, onTabClick, isOpen, onToggle, sseState }: SidebarProps) {
  return (
    <motion.aside
      initial={false}
      animate={{ width: isOpen ? 220 : 80 }}
      transition={{ type: 'spring', bounce: 0, duration: 0.4 }}
      className="bg-white/30 backdrop-blur-xl border-r border-white/50 shadow-[4px_0_24px_-12px_rgba(0,0,0,0.1)] flex flex-col z-20 relative shrink-0"
    >
      {/* Toggle button */}
      <button
        onClick={onToggle}
        className="absolute -right-3.5 top-8 bg-white shadow-md rounded-full p-1.5 text-pink-500 hover:text-pink-600 hover:scale-110 transition-all z-30 border border-pink-100"
      >
        {isOpen ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
      </button>

      {/* Logo area */}
      <div
        onClick={onToggle}
        className="px-4 py-6 flex items-center cursor-pointer hover:bg-white/40 transition-colors select-none"
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
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-2 space-y-1 overflow-y-auto overflow-x-hidden">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onTabClick(tab.id)}
              className={`w-full flex items-center px-2 py-3 rounded-2xl transition-all duration-300 relative overflow-hidden group select-none ${isActive ? 'text-gray-900 font-bold shadow-sm' : 'text-gray-500 hover:bg-white/50'
                }`}
              title={!isOpen ? tab.label : undefined}
            >
              {isActive && (
                <motion.div
                  layoutId="activeTab"
                  className={`absolute inset-0 ${tab.bg} opacity-50`}
                  initial={false}
                  transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                />
              )}
              <div
                className={`relative z-10 p-2 rounded-xl transition-colors shrink-0 ${isActive ? 'bg-white shadow-sm' : 'bg-white/60 group-hover:bg-white'
                  }`}
              >
                <Icon className={`w-5 h-5 ${isActive ? tab.color : 'text-gray-400 group-hover:text-pink-400'}`} />
              </div>
              <AnimatePresence mode="popLayout">
                {isOpen && (
                  <motion.span
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -10 }}
                    transition={{ duration: 0.2, ease: 'easeOut', delay: 0.05 }}
                    className="relative z-10 text-sm font-semibold whitespace-nowrap ml-3"
                  >
                    {tab.label}
                  </motion.span>
                )}
              </AnimatePresence>
            </button>
          );
        })}
      </nav>

      {/* Bottom: SSE status + welcome card */}
      <div className="p-4 w-full shrink-0 flex flex-col items-center gap-3 overflow-hidden pb-6">
        <div
          className={`flex items-center rounded-2xl text-xs font-semibold transition-all duration-300 relative overflow-hidden shadow-sm shrink-0 h-8 ${isOpen ? 'w-[188px] px-3 justify-start' : 'w-8 justify-center'
            } ${sseState === 'connected'
              ? 'bg-emerald-100 text-emerald-700'
              : sseState === 'connecting'
                ? 'bg-amber-100 text-amber-700'
                : 'bg-red-100 text-red-700'
            }`}
          title={sseState === 'connected' ? 'Live' : sseState === 'connecting' ? 'Connecting...' : 'Disconnected'}
        >
          {sseState === 'connected' ? (
            <Wifi className="w-3 h-3 shrink-0" />
          ) : sseState === 'connecting' ? (
            <Loader2 className="w-3 h-3 animate-spin shrink-0" />
          ) : (
            <WifiOff className="w-3 h-3 shrink-0" />
          )}

          <AnimatePresence mode="popLayout">
            {isOpen && (
              <motion.span
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="whitespace-nowrap font-bold ml-2 shrink-0"
              >
                {sseState === 'connected'
                  ? 'Live'
                  : sseState === 'connecting'
                    ? 'Connecting...'
                    : 'Disconnected'}
              </motion.span>
            )}
          </AnimatePresence>
        </div>

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
                <p className="text-sm font-bold text-gray-700 mb-1 truncate">Master, welcome back!</p>
                <p className="text-xs text-gray-500 line-clamp-2 leading-tight">Your maids are waiting.</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.aside>
  );
}
