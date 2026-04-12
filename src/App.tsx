import { Suspense, useState, useLayoutEffect, useCallback, useMemo } from 'react'
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { Menu } from 'lucide-react'
import InteractiveBackground from './components/InteractiveBackground'
import Sidebar from './components/Sidebar'
import { ROOMS, NAV_ROOMS } from './room-registry'
import { LoadingSpinner } from './components/ui/LoadingSpinner'
import { OfflineBanner } from './components/OfflineBanner'
import { OfflineContext } from './hooks/OfflineContext'
import type { OfflineContextValue } from './hooks/OfflineContext'
import { useHealth } from './hooks/useHealth'

const MOBILE_BREAKPOINT = 1024

export default function App() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true)
  const [isMobile, setIsMobile] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const health = useHealth()

  const offlineValue = useMemo<OfflineContextValue>(
    () => ({ isOffline: health.isOffline, isLoading: health.isLoading }),
    [health.isOffline, health.isLoading],
  )

  useLayoutEffect(() => {
    const mq = window.matchMedia(`(max-width: ${String(MOBILE_BREAKPOINT)}px)`)
    setIsMobile(mq.matches)
    setIsSidebarOpen(!mq.matches)
    const handler = (e: MediaQueryListEvent) => {
      setIsMobile(e.matches)
      setIsSidebarOpen(!e.matches)
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const activeRoomId = ROOMS.find((r) => r.path === location.pathname)?.id ?? null

  const handleTabClick = useCallback(
    (roomId: string) => {
      const room = ROOMS.find((r) => r.id === roomId)
      if (room) {
        navigate(room.path)
      }
      if (isMobile) setIsSidebarOpen(false)
    },
    [navigate, isMobile],
  )

  return (
    <OfflineContext value={offlineValue}>
      <div className="flex flex-col h-screen overflow-hidden relative">
        <OfflineBanner />
        <div className="flex flex-1 overflow-hidden relative">
          <InteractiveBackground />

          <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
            <div className="absolute top-[-10%] left-[-5%] w-96 h-96 bg-pink-400/30 rounded-full blur-3xl" />
            <div className="absolute bottom-[10%] left-[2%] w-[25rem] h-[25rem] bg-purple-400/20 rounded-full blur-3xl" />
            <div className="absolute top-[20%] right-[-5%] w-80 h-80 bg-blue-400/20 rounded-full blur-3xl" />
          </div>

          <Sidebar
            activeTab={activeRoomId}
            onTabClick={handleTabClick}
            isOpen={isSidebarOpen}
            onToggle={() => setIsSidebarOpen((prev) => !prev)}
            isMobile={isMobile}
          />

          <main className="flex-1 relative overflow-hidden z-10">
            {isMobile && (
              <button
                type="button"
                onClick={() => setIsSidebarOpen(true)}
                className="absolute top-4 left-4 z-30 p-2.5 bg-white/80 backdrop-blur-md rounded-2xl shadow-sm border border-white/60 text-pink-500 hover:text-pink-600 hover:bg-white transition-all duration-300"
                aria-label="Open menu"
              >
                <Menu className="w-5 h-5" />
              </button>
            )}

            <div className="h-full overflow-y-auto overflow-x-hidden overscroll-none">
              <Suspense
                fallback={
                  <div className="flex items-center justify-center h-full">
                    <LoadingSpinner />
                  </div>
                }
              >
                <AnimatePresence mode="wait">
                  <motion.div
                    key={location.pathname}
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -16 }}
                    transition={{ type: 'spring', bounce: 0.18, duration: 0.38 }}
                    className={location.pathname === '/' ? '' : 'min-h-full p-6 md:p-8'}
                  >
                    <Routes location={location}>
                      {ROOMS.map((room) => (
                        <Route key={room.id} path={room.path} element={<room.component />} />
                      ))}
                    </Routes>
                  </motion.div>
                </AnimatePresence>
              </Suspense>
            </div>

            {isMobile && activeRoomId && activeRoomId !== 'welcome' && (
              <div className="fixed left-2 top-1/2 -translate-y-1/2 flex flex-col gap-[5px] z-20">
                {NAV_ROOMS.map((room) => {
                  const isActive = activeRoomId === room.id
                  return (
                    <button
                      key={room.id}
                      type="button"
                      onClick={() => handleTabClick(room.id)}
                      aria-label={room.label}
                      className={`rounded-full transition-all duration-300 cursor-pointer ${
                        isActive
                          ? `w-[5px] h-3.5 ${room.dotColor}`
                          : 'w-[5px] h-[5px] bg-gray-300/60 hover:bg-pink-300'
                      }`}
                    />
                  )
                })}
              </div>
            )}
          </main>
        </div>
      </div>
    </OfflineContext>
  )
}
