import { motion } from 'motion/react';
import React from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}

export function PageHeader({ title, subtitle, children }: PageHeaderProps) {
  return (
    <motion.header
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', bounce: 0.3, duration: 0.6 }}
      className="flex flex-wrap justify-between items-start sm:items-end gap-4"
    >
      <div className="flex-1 min-w-[200px]">
        <h2 className="text-3xl sm:text-4xl font-extrabold bg-gradient-to-r from-pink-500 to-purple-600 bg-clip-text text-transparent mb-2">
          {title}
        </h2>
        {subtitle && <p className="text-gray-500 font-medium">{subtitle}</p>}
      </div>
      {children}
    </motion.header>
  );
}
