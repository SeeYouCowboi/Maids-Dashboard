import { useState, useLayoutEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Menu } from 'lucide-react';
import InteractiveBackground from './components/InteractiveBackground';
import Sidebar from './components/Sidebar';
import WelcomePage from './pages/WelcomePage';
import GrandHallPage from './pages/GrandHallPage';
import KitchenPage from './pages/KitchenPage';
import LibraryPage from './pages/LibraryPage';
import ObservatoryPage from './pages/ObservatoryPage';
import WarRoomPage from './pages/WarRoomPage';
import GardenPage from './pages/GardenPage';
import BallroomPage from './pages/BallroomPage';
import { useSSE } from './hooks';
import { useConfirmSecret } from './contexts/ConfirmSecretContext';

function PageContent({ activeTab }: { activeTab: string }) {
  switch (activeTab) {
    case 'grand-hall': return <GrandHallPage />;
    case 'kitchen': return <KitchenPage />;
    case 'library': return <LibraryPage />;
    case 'observatory': return <ObservatoryPage />;
    case 'war-room': return <WarRoomPage />;
    case 'garden': return <GardenPage />;
    case 'ballroom': return <BallroomPage />;
    default: return null;
  }
}

const MOBILE_BREAKPOINT = 1024;

export default function App() {
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const { secret } = useConfirmSecret();
  const { state: sseState } = useSSE(secret);

  useLayoutEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);
    setIsMobile(mq.matches);
    setIsSidebarOpen(!mq.matches);
    const handler = (e: MediaQueryListEvent) => {
      setIsMobile(e.matches);
      setIsSidebarOpen(!e.matches);
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const handleTabClick = (tabId: string) => {
    setActiveTab(tabId);
    if (isMobile) {
      setIsSidebarOpen(false);
    }
  };

  return (
    <div className="flex h-screen overflow-hidden relative">
      <InteractiveBackground />

      {/* Decorative background blobs */}
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-5%] w-96 h-96 bg-pink-400/30 rounded-full blur-3xl" />
        <div className="absolute bottom-[10%] left-[2%] w-[25rem] h-[25rem] bg-purple-400/20 rounded-full blur-3xl" />
        <div className="absolute top-[20%] right-[-5%] w-80 h-80 bg-blue-400/20 rounded-full blur-3xl" />
      </div>

      <Sidebar
        activeTab={activeTab}
        onTabClick={handleTabClick}
        isOpen={isSidebarOpen}
        onToggle={() => setIsSidebarOpen(!isSidebarOpen)}
        sseState={sseState}
        isMobile={isMobile}
      />

      <main className="flex-1 relative overflow-y-auto overflow-x-hidden z-10">
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
        <AnimatePresence mode="wait">
          {activeTab === null ? (
            <motion.div key="welcome" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <WelcomePage onStart={() => handleTabClick('grand-hall')} />
            </motion.div>
          ) : (
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ type: 'spring', bounce: 0.2, duration: 0.4 }}
              className="min-h-full p-6 md:p-8"
            >
              <PageContent activeTab={activeTab} />
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
