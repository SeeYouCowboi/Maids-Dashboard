import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Lock } from 'lucide-react';

interface ConfirmModalProps {
  isOpen: boolean;
  onConfirm: (secret: string) => void;
  onCancel: () => void;
  title?: string;
}

export function ConfirmModal({ isOpen, onConfirm, onCancel, title = 'Confirm Action' }: ConfirmModalProps) {
  const [secret, setSecret] = useState('');

  const handleConfirm = useCallback(() => {
    onConfirm(secret);
    setSecret('');
  }, [secret, onConfirm]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleConfirm();
      }
      if (e.key === 'Escape') {
        onCancel();
      }
    },
    [handleConfirm, onCancel]
  );

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center"
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/20 backdrop-blur-sm"
            onClick={onCancel}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', bounce: 0.3, duration: 0.4 }}
            className="relative bg-white/60 backdrop-blur-xl border border-white/80 shadow-xl rounded-2xl p-6 w-full max-w-md mx-4"
            onKeyDown={handleKeyDown}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="bg-pink-100 p-2 rounded-xl">
                <Lock className="w-5 h-5 text-pink-500" />
              </div>
              <h3 className="text-lg font-bold text-gray-800">{title}</h3>
            </div>
            <p className="text-gray-500 mb-4">
              This action requires confirmation. Please enter the secret key:
            </p>
            <input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="Enter secret key..."
              autoFocus
              className="w-full bg-white/80 border border-white/90 rounded-2xl px-4 py-3 text-gray-700 placeholder-gray-400 focus:outline-none focus:border-pink-300 focus:ring-2 focus:ring-pink-100 transition-all duration-300 mb-4"
            />
            <div className="flex gap-3">
              <button
                onClick={handleConfirm}
                className="flex-1 bg-gradient-to-r from-pink-500 to-purple-500 text-white font-semibold py-2.5 rounded-2xl hover:shadow-md hover:shadow-pink-500/25 transition-all duration-300"
              >
                Confirm
              </button>
              <button
                onClick={onCancel}
                className="flex-1 bg-white/60 text-gray-600 font-semibold py-2.5 rounded-2xl border border-white/80 hover:bg-white/80 transition-all duration-300"
              >
                Cancel
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
