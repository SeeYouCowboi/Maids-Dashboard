import { useState, useLayoutEffect, useRef, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { motion, AnimatePresence, useMotionValue, useSpring, useTransform } from 'motion/react';
import {
  Home, ChefHat, BookOpen, BarChart3, Shield, Flower2, Music,
  ChevronUp, ChevronDown, Menu,
} from 'lucide-react';
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

export const PAGE_ORDER = [
  'grand-hall', 'kitchen', 'library', 'observatory',
  'war-room', 'garden', 'ballroom',
] as const;

export type PageId = typeof PAGE_ORDER[number];

const PAGE_META: Record<PageId, {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  dotColor: string;
  textColor: string;
}> = {
  'grand-hall':  { label: 'Grand Hall',   icon: Home,     dotColor: 'bg-pink-500',    textColor: 'text-pink-500' },
  'kitchen':     { label: 'Kitchen',      icon: ChefHat,  dotColor: 'bg-blue-500',    textColor: 'text-blue-500' },
  'library':     { label: 'Library',      icon: BookOpen, dotColor: 'bg-purple-500',  textColor: 'text-purple-500' },
  'observatory': { label: 'Observatory',  icon: BarChart3,dotColor: 'bg-emerald-500', textColor: 'text-emerald-500' },
  'war-room':    { label: 'War Room',     icon: Shield,   dotColor: 'bg-red-500',     textColor: 'text-red-500' },
  'garden':      { label: 'Garden',       icon: Flower2,  dotColor: 'bg-green-500',   textColor: 'text-green-500' },
  'ballroom':    { label: 'Ballroom',     icon: Music,    dotColor: 'bg-amber-500',   textColor: 'text-amber-500' },
};

// Rubber-band resistance: returns a damped displacement that asymptotically
// approaches `limit`. The further you pull, the more resistance you feel.
function rubberBand(x: number, limit: number): number {
  const sign = x > 0 ? 1 : -1;
  const abs = Math.abs(x);
  return sign * limit * (1 - Math.exp(-abs / (limit * 1.3)));
}

const PULL_LIMIT = 76;           // max visual displacement in px
const SWITCH_THRESHOLD = 0.58;  // fraction of PULL_LIMIT that triggers page switch
const WHEEL_ACCUM_THRESHOLD = 260; // accumulated wheel delta that triggers page switch

export default function App() {
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [navDir, setNavDir] = useState<'up' | 'down' | 'lateral'>('lateral');
  const { secret } = useConfirmSecret();
  const { state: sseState } = useSSE(secret);

  // ── Elastic scroll refs ──────────────────────────────────────────────────
  const scrollRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef(0);
  const isPulling = useRef(false);
  const isTransitioning = useRef(false);
  const wheelAccum = useRef(0);
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // dragY is the "raw" target; springY follows it with spring physics.
  // Setting dragY → springY springs towards it (creating the jelly feel).
  const dragY = useMotionValue(0);
  const springY = useSpring(dragY, { stiffness: 440, damping: 38, mass: 0.75 });

  // Indicator opacity derived from the spring value
  const topOpacity    = useTransform(springY, [0, PULL_LIMIT * 0.25, PULL_LIMIT], [0, 0.35, 1]);
  const bottomOpacity = useTransform(springY, [-PULL_LIMIT, -PULL_LIMIT * 0.25, 0], [1, 0.35, 0]);

  // ── Responsive layout ────────────────────────────────────────────────────
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

  // ── Page navigation ──────────────────────────────────────────────────────
  const navigatePage = useCallback((direction: 'prev' | 'next'): boolean => {
    if (isTransitioning.current) return false;

    // Welcome page (activeTab === null) lives at virtual index −1.
    // Only "next" makes sense from here — navigates to the first room.
    if (activeTab === null) {
      if (direction !== 'next') return false;
      isTransitioning.current = true;
      dragY.set(0);
      flushSync(() => setNavDir('up'));
      setActiveTab(PAGE_ORDER[0]);
      setTimeout(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; }, 60);
      setTimeout(() => { isTransitioning.current = false; }, 700);
      return true;
    }

    const idx = PAGE_ORDER.indexOf(activeTab as PageId);
    if (idx === -1) return false;
    const newIdx = direction === 'prev' ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= PAGE_ORDER.length) return false;

    isTransitioning.current = true;
    dragY.set(0);
    flushSync(() => setNavDir(direction === 'prev' ? 'down' : 'up'));
    setActiveTab(PAGE_ORDER[newIdx]);
    // Scroll new page to top after transition starts
    setTimeout(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; }, 60);
    setTimeout(() => { isTransitioning.current = false; }, 700);
    return true;
  }, [activeTab, dragY]);

  const handleTabClick = useCallback((tabId: string) => {
    if (activeTab !== null) {
      const curIdx = PAGE_ORDER.indexOf(activeTab as PageId);
      const newIdx = PAGE_ORDER.indexOf(tabId as PageId);
      if (curIdx !== -1 && newIdx !== -1 && curIdx !== newIdx) {
        flushSync(() => setNavDir(newIdx > curIdx ? 'up' : 'down'));
      } else {
        flushSync(() => setNavDir('lateral'));
      }
    } else {
      flushSync(() => setNavDir('up')); // welcome → sub-page always goes "forward" (downward in stack)
    }
    setActiveTab(tabId);
    if (isMobile) setIsSidebarOpen(false);
    setTimeout(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; }, 60);
  }, [activeTab, isMobile]);

  // ── Touch handlers for elastic overscroll ────────────────────────────────
  const onTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    touchStartY.current = e.touches[0].clientY;
    isPulling.current = false;
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (!el || isTransitioning.current) return;

    const dy = e.touches[0].clientY - touchStartY.current;
    const atTop    = el.scrollTop <= 1;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
    const idx = PAGE_ORDER.indexOf(activeTab as PageId);

    if (dy > 6 && atTop && idx > 0) {
      isPulling.current = true;
      dragY.set(rubberBand(dy - 6, PULL_LIMIT));
    } else if (dy < -6 && atBottom && idx < PAGE_ORDER.length - 1) {
      isPulling.current = true;
      dragY.set(rubberBand(dy + 6, PULL_LIMIT));
    } else if (!isPulling.current) {
      if (dragY.get() !== 0) dragY.set(0);
    }
  }, [activeTab, dragY]);

  const onTouchEnd = useCallback(() => {
    if (!isPulling.current) return;
    const y = dragY.get();
    if (y >= PULL_LIMIT * SWITCH_THRESHOLD) {
      navigatePage('prev');
    } else if (y <= -PULL_LIMIT * SWITCH_THRESHOLD) {
      navigatePage('next');
    } else {
      dragY.set(0);
    }
    isPulling.current = false;
  }, [dragY, navigatePage]);

  // ── Wheel handler for desktop overscroll ─────────────────────────────────
  const onWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (!el || isTransitioning.current) return;

    const atTop    = el.scrollTop <= 1;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
    const idx = PAGE_ORDER.indexOf(activeTab as PageId);
    const hasPrev = idx > 0;
    const hasNext = idx < PAGE_ORDER.length - 1;

    if ((e.deltaY < 0 && atTop && hasPrev) || (e.deltaY > 0 && atBottom && hasNext)) {
      wheelAccum.current += e.deltaY;
      if (wheelTimer.current) clearTimeout(wheelTimer.current);
      wheelTimer.current = setTimeout(() => {
        wheelAccum.current = 0;
        dragY.set(0);
      }, 500);
      if (Math.abs(wheelAccum.current) >= WHEEL_ACCUM_THRESHOLD) {
        if (navigatePage(wheelAccum.current < 0 ? 'prev' : 'next')) {
          wheelAccum.current = 0;
          if (wheelTimer.current) clearTimeout(wheelTimer.current);
        }
      }
    }
  }, [activeTab, dragY, navigatePage]);

  // ── Derived values ───────────────────────────────────────────────────────
  const currentIdx = activeTab ? PAGE_ORDER.indexOf(activeTab as PageId) : -1;
  const prevPage   = currentIdx > 0 ? PAGE_ORDER[currentIdx - 1] : null;
  const nextPage   = currentIdx < PAGE_ORDER.length - 1 ? PAGE_ORDER[currentIdx + 1] : null;

  // Page transition variants
  const variants = {
    initial: navDir === 'up'   ? { opacity: 0, y: 28, x: 0 }
            : navDir === 'down' ? { opacity: 0, y: -28, x: 0 }
            :                     { opacity: 0, y: 0, x: 16 },
    animate: { opacity: 1, y: 0, x: 0 },
    exit:    navDir === 'up'   ? { opacity: 0, y: -28, x: 0 }
            : navDir === 'down' ? { opacity: 0, y: 28, x: 0 }
            :                     { opacity: 0, y: 0, x: -16 },
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

      {/* ── Main content area ──────────────────────────────────────────── */}
      {/* overflow-hidden clips the elastic displacement, revealing indicators */}
      <main className="flex-1 relative overflow-hidden z-10">

        {/* Hamburger — mobile only, stays outside elastic wrapper so it never moves */}
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

        {/* Top indicator — revealed when content is pulled DOWN (→ prev page) */}
        {prevPage && (
          <div className="absolute top-0 inset-x-0 h-20 flex items-center justify-center pointer-events-none z-0 select-none">
            <motion.div style={{ opacity: topOpacity }} className="flex flex-col items-center gap-0.5">
              <motion.div
                animate={{ y: [0, -4, 0] }}
                transition={{ repeat: Infinity, duration: 1.1, ease: 'easeInOut' }}
              >
                <ChevronUp className={`w-5 h-5 ${PAGE_META[prevPage].textColor}`} />
              </motion.div>
              <span className={`text-xs font-bold ${PAGE_META[prevPage].textColor}`}>
                {PAGE_META[prevPage].label}
              </span>
            </motion.div>
          </div>
        )}

        {/* Bottom indicator — revealed when content is pulled UP (→ next page) */}
        {nextPage && (
          <div className="absolute bottom-0 inset-x-0 h-20 flex items-center justify-center pointer-events-none z-0 select-none">
            <motion.div style={{ opacity: bottomOpacity }} className="flex flex-col items-center gap-0.5">
              <span className={`text-xs font-bold ${PAGE_META[nextPage].textColor}`}>
                {PAGE_META[nextPage].label}
              </span>
              <motion.div
                animate={{ y: [0, 4, 0] }}
                transition={{ repeat: Infinity, duration: 1.1, ease: 'easeInOut' }}
              >
                <ChevronDown className={`w-5 h-5 ${PAGE_META[nextPage].textColor}`} />
              </motion.div>
            </motion.div>
          </div>
        )}

        {/* Elastic scroll wrapper — translates on overscroll, springs back */}
        <motion.div style={{ y: springY }} className="h-full">
          {/* Actual scroll container — left padding on mobile clears sidebar peek */}
          <div
            ref={scrollRef}
            className="h-full overflow-y-auto overflow-x-hidden overscroll-none"
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            onWheel={onWheel}
          >
            <AnimatePresence mode="wait">
              {activeTab === null ? (
                <motion.div key="welcome" initial={variants.initial} animate={variants.animate} exit={variants.exit} transition={{ type: 'spring', bounce: 0.18, duration: 0.38 }}>
                  <WelcomePage onStart={() => handleTabClick('grand-hall')} />
                </motion.div>
              ) : (
                <motion.div
                  key={activeTab}
                  initial={variants.initial}
                  animate={variants.animate}
                  exit={variants.exit}
                  transition={{ type: 'spring', bounce: 0.18, duration: 0.38 }}
                  className="min-h-full p-6 md:p-8"
                >
                  <PageContent activeTab={activeTab} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>

        {/* ── Pagination dots — mobile only ──────────────────────────────── */}
        {/* These communicate the "N vertical sub-pages" navigation paradigm  */}
        {isMobile && activeTab && (
          <div className="fixed left-2 top-1/2 -translate-y-1/2 flex flex-col gap-[5px] z-20">
            {PAGE_ORDER.map((pageId) => {
              const isActive = activeTab === pageId;
              const meta = PAGE_META[pageId];
              return (
                <button
                  key={pageId}
                  type="button"
                  onClick={() => handleTabClick(pageId)}
                  aria-label={meta.label}
                  className={`rounded-full transition-all duration-300 cursor-pointer ${
                    isActive
                      ? `w-[5px] h-3.5 ${meta.dotColor}`
                      : 'w-[5px] h-[5px] bg-gray-300/60 hover:bg-pink-300'
                  }`}
                />
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
