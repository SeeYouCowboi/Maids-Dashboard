import { useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { AlertTriangle, X } from 'lucide-react'

interface ConfirmDeleteDialogProps {
  open: boolean
  name: string
  entityLabel: string
  onConfirm: () => void
  onCancel: () => void
  isPending: boolean
  error: string | undefined
}

export function ConfirmDeleteDialog({
  open,
  name,
  entityLabel,
  onConfirm,
  onCancel,
  isPending,
  error,
}: ConfirmDeleteDialogProps) {
  const [typed, setTyped] = useState('')

  const matches = typed === name

  function handleCancel() {
    setTyped('')
    onCancel()
  }

  function handleConfirm() {
    if (!matches) return
    onConfirm()
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/20 backdrop-blur-sm z-50"
            onClick={handleCancel}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ type: 'spring', bounce: 0.2, duration: 0.3 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
          >
            <div className="bg-white/80 backdrop-blur-xl border border-white/60 rounded-2xl shadow-2xl max-w-md w-full p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-red-100 rounded-xl">
                    <AlertTriangle className="w-5 h-5 text-red-500" />
                  </div>
                  <h3 className="text-lg font-bold text-gray-800">Delete {entityLabel}</h3>
                </div>
                <button
                  type="button"
                  onClick={handleCancel}
                  className="p-1.5 rounded-xl hover:bg-white/60 transition-colors text-gray-400 hover:text-gray-600"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <p className="text-sm text-gray-600 mb-4">
                This action cannot be undone. Type{' '}
                <span className="font-mono font-bold text-red-600">{name}</span> to confirm
                deletion.
              </p>

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-600 text-sm mb-4">
                  {error}
                </div>
              )}

              <input
                type="text"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={`Type "${name}" to confirm`}
                className="w-full bg-white/80 border border-red-200 rounded-xl px-4 py-2.5 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100 transition-all duration-300 mb-4"
              />

              <div className="flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={handleCancel}
                  className="px-4 py-2 bg-white/60 text-gray-600 font-semibold rounded-xl border border-white/80 hover:bg-white/80 transition-all duration-300 text-sm"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={!matches || isPending}
                  className="px-4 py-2 bg-red-500 text-white font-semibold rounded-xl hover:bg-red-600 transition-all duration-300 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isPending ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
