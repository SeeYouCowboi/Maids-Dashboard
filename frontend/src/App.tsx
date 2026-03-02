import { useState, useLayoutEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
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

export default function App() {
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const { secret } = useConfirmSecret();
  const { state: sseState } = useSSE(secret);

  useLayoutEffect(() => {
    const mq = window.matchMedia('(max-width: 1024px)');
    setIsSidebarOpen(!mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsSidebarOpen(!e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const handleTabClick = (tabId: string) => {
    setActiveTab(tabId);
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
      />

      <main className="flex-1 relative overflow-y-auto overflow-x-hidden z-10">
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
