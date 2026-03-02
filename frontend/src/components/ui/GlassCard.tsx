import { motion } from 'motion/react';

interface GlassCardProps {
  title?: string;
  children: React.ReactNode;
  className?: string;
  color?: 'pink' | 'blue' | 'purple' | 'emerald' | 'amber' | 'red';
}

export function GlassCard({ title, children, className = '', color = 'pink' }: GlassCardProps) {
  const colorMap = {
    pink: 'text-pink-600',
    blue: 'text-blue-600',
    purple: 'text-purple-600',
    emerald: 'text-emerald-600',
    amber: 'text-amber-600',
    red: 'text-red-600',
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', bounce: 0.3, duration: 0.6 }}
      className={`bg-white/40 backdrop-blur-xl border border-white/60 shadow-sm rounded-2xl p-6 hover:shadow-md transition-all duration-300 ${className}`}
    >
      {title && <h3 className={`text-lg font-bold mb-4 ${colorMap[color]}`}>{title}</h3>}
      {children}
    </motion.div>
  );
}
