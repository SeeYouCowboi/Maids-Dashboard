import { motion } from 'motion/react';
import { Sparkles, Heart, ChevronDown } from 'lucide-react';

interface WelcomePageProps {
  onStart: () => void;
}

export default function WelcomePage({ onStart }: WelcomePageProps) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden px-6">
      {/* Floating decorative elements */}
      <motion.div
        animate={{ y: [0, -20, 0], rotate: [0, 5, -5, 0] }}
        transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute top-1/4 left-1/4 text-pink-300 pointer-events-none"
      >
        <Sparkles className="w-16 h-16" />
      </motion.div>
      <motion.div
        animate={{ y: [0, 30, 0], rotate: [0, -10, 10, 0] }}
        transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute bottom-1/3 right-1/4 text-purple-300 pointer-events-none"
      >
        <Heart className="w-20 h-20 fill-purple-300" />
      </motion.div>
      <motion.div
        animate={{ y: [0, -15, 0], scale: [1, 1.1, 1] }}
        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute top-1/3 right-1/3 text-blue-300 pointer-events-none"
      >
        <Sparkles className="w-10 h-10" />
      </motion.div>

      <div className="relative z-10 text-center space-y-8">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', bounce: 0.5, duration: 1 }}
          className="w-56 h-56 mx-auto bg-gradient-to-tr from-pink-300 via-purple-300 to-blue-300 rounded-[3rem] p-2 shadow-2xl shadow-pink-200/50 rotate-3 hover:rotate-0 transition-transform duration-500"
        >
          <div className="w-full h-full bg-gradient-to-br from-pink-100 to-purple-100 rounded-[2.5rem] border-4 border-white flex items-center justify-center">
            <Heart className="w-24 h-24 text-pink-400 fill-pink-300" />
          </div>
        </motion.div>

        <div className="space-y-4">
          <motion.h1
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.2, duration: 0.8 }}
            className="text-6xl font-black text-transparent bg-clip-text bg-gradient-to-r from-pink-500 via-purple-500 to-blue-500 drop-shadow-sm tracking-tight"
          >
            Welcome, Master!
          </motion.h1>
          <motion.p
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.4, duration: 0.8 }}
            className="text-xl text-gray-600 font-bold max-w-2xl mx-auto leading-relaxed"
          >
            Your AI maids are ready and waiting.{' '}
            <span className="text-pink-400">Let&apos;s create some wonderful memories today! ✨</span>
          </motion.p>
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.2, duration: 1 }}
        className="absolute bottom-12 flex flex-col items-center gap-3 text-pink-400 cursor-pointer hover:text-pink-500 transition-colors group select-none"
        onClick={onStart}
      >
        <span className="font-bold text-sm tracking-[0.2em] uppercase group-hover:scale-110 transition-transform">
          Click a tab to start
        </span>
        <motion.div animate={{ y: [0, 12, 0] }} transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}>
          <ChevronDown className="w-10 h-10" />
        </motion.div>
      </motion.div>
    </div>
  );
}
