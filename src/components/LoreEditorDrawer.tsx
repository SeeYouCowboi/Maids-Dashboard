import { useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { X, Save } from 'lucide-react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { LoreFormSchema } from '../schemas/forms'
import type { LoreForm, LoreDetail, LoreScope } from '@maidsclaw/contracts/browser.js'
import { createLore, updateLore } from '../api/lore'
import { queryKeys } from '../query/keys'
import { useOffline } from '../hooks/OfflineContext'
import { ApiError } from '../api/client'

interface LoreEditorDrawerProps {
  open: boolean
  lore: LoreDetail | undefined
  onClose: () => void
}

const SCOPE_OPTIONS: readonly LoreScope[] = ['world', 'area'] as const

function formatApiError(err: unknown): string {
  if (err instanceof ApiError) {
    return `${err.code} — ${err.message}`
  }
  if (err instanceof Error) return err.message
  return 'An unexpected error occurred'
}

export function LoreEditorDrawer({ open, lore, onClose }: LoreEditorDrawerProps) {
  const isEdit = lore !== undefined
  const queryClient = useQueryClient()
  const { isOffline } = useOffline()

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isDirty },
  } = useForm<LoreForm>({
    resolver: zodResolver(LoreFormSchema),
    defaultValues: {
      id: '',
      title: '',
      keywords: [''],
      content: '',
      scope: 'world',
      priority: undefined,
      enabled: true,
      tags: undefined,
    },
  })

  const resetToLore = useCallback(
    (l: LoreDetail | undefined) => {
      if (l) {
        reset({
          id: l.id,
          title: l.title,
          keywords: l.keywords,
          content: l.content,
          scope: l.scope,
          priority: l.priority,
          enabled: l.enabled,
          tags: l.tags,
        })
      } else {
        reset({
          id: '',
          title: '',
          keywords: [''],
          content: '',
          scope: 'world',
          priority: undefined,
          enabled: true,
          tags: undefined,
        })
      }
    },
    [reset],
  )

  useEffect(() => {
    if (open) {
      saveMutation.reset()
      resetToLore(lore)
    }
  }, [open, lore, resetToLore]) // saveMutation.reset is a stable TanStack Query function

  const saveMutation = useMutation({
    mutationFn: (data: LoreForm) => (isEdit ? updateLore(data.id, data) : createLore(data)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.lore.all })
      onClose()
    },
  })

  function onSubmit(data: LoreForm) {
    saveMutation.mutate(data)
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40"
            onClick={onClose}
          />
          <motion.aside
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', bounce: 0.1, duration: 0.4 }}
            className="fixed right-0 top-0 h-full w-full max-w-[600px] z-50 bg-white/60 backdrop-blur-xl border-l border-white/60 shadow-2xl flex flex-col"
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/60">
              <h2 className="text-lg font-bold text-gray-800">
                {isEdit ? 'Edit Lore Entry' : 'New Lore Entry'}
              </h2>
              <button
                type="button"
                onClick={onClose}
                className="p-2 rounded-2xl hover:bg-white/60 transition-colors text-gray-500 hover:text-gray-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form
              onSubmit={handleSubmit(onSubmit)}
              className="flex-1 flex flex-col overflow-hidden"
            >
              <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                {saveMutation.error && (
                  <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-600 text-sm">
                    {formatApiError(saveMutation.error)}
                  </div>
                )}

                <FieldWrapper label="ID" error={errors.id?.message}>
                  <input
                    type="text"
                    {...register('id')}
                    disabled={isEdit}
                    placeholder="unique-lore-id"
                    className={fieldInputClass(isEdit)}
                  />
                </FieldWrapper>

                <FieldWrapper label="Title" error={errors.title?.message}>
                  <input
                    type="text"
                    {...register('title')}
                    placeholder="Entry title"
                    className={fieldInputClass()}
                  />
                </FieldWrapper>

                <FieldWrapper label="Keywords (comma-separated)" error={errors.keywords?.message}>
                  <Controller
                    control={control}
                    name="keywords"
                    render={({ field }) => (
                      <input
                        type="text"
                        value={field.value.join(', ')}
                        onChange={(e) => {
                          const raw = e.target.value
                          const parts = raw.split(',').map((s) => s.trim())
                          field.onChange(parts)
                        }}
                        placeholder="keyword1, keyword2"
                        className={fieldInputClass()}
                      />
                    )}
                  />
                </FieldWrapper>

                <FieldWrapper label="Content" error={errors.content?.message}>
                  <textarea
                    {...register('content')}
                    rows={5}
                    placeholder="Lore entry content"
                    className={fieldTextareaClass()}
                  />
                </FieldWrapper>

                <FieldWrapper label="Scope" error={errors.scope?.message}>
                  <select {...register('scope')} className={fieldInputClass()}>
                    {SCOPE_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </FieldWrapper>

                <FieldWrapper label="Priority" error={errors.priority?.message}>
                  <input
                    type="number"
                    {...register('priority', { valueAsNumber: true })}
                    placeholder="0"
                    className={fieldInputClass()}
                  />
                </FieldWrapper>

                <FieldWrapper label="Enabled" error={errors.enabled?.message}>
                  <Controller
                    control={control}
                    name="enabled"
                    render={({ field }) => (
                      <button
                        type="button"
                        onClick={() => field.onChange(!field.value)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ${
                          field.value ? 'bg-purple-500' : 'bg-gray-300'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 rounded-full bg-white transition-transform duration-200 ${
                            field.value ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    )}
                  />
                </FieldWrapper>
              </div>

              <div className="px-6 py-4 border-t border-white/60 flex gap-3">
                <button
                  type="submit"
                  disabled={saveMutation.isPending || isOffline || (!isDirty && isEdit)}
                  className="flex-1 flex items-center justify-center gap-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold py-2.5 rounded-2xl hover:shadow-md hover:shadow-purple-500/25 transition-all duration-300 disabled:opacity-60"
                >
                  <Save className="w-4 h-4" />
                  {saveMutation.isPending ? 'Saving…' : isEdit ? 'Update' : 'Create'}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 bg-white/60 text-gray-600 font-semibold py-2.5 rounded-2xl border border-white/80 hover:bg-white/80 transition-all duration-300"
                >
                  Cancel
                </button>
              </div>
            </form>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}

function FieldWrapper({
  label,
  error,
  children,
}: {
  label: string
  error: string | undefined
  children: React.ReactNode
}) {
  return (
    <div>
      <span className="block text-xs font-bold text-gray-600 mb-1">{label}</span>
      {children}
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  )
}

function fieldInputClass(disabled?: boolean | undefined): string {
  const base =
    'w-full bg-white/80 border border-white/90 rounded-xl px-4 py-2.5 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:border-purple-300 focus:ring-2 focus:ring-purple-100 transition-all duration-300'
  return disabled ? `${base} opacity-60 cursor-not-allowed` : base
}

function fieldTextareaClass(): string {
  return 'w-full bg-white/80 border border-white/90 rounded-xl px-4 py-2.5 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:border-purple-300 focus:ring-2 focus:ring-purple-100 transition-all duration-300 resize-y'
}
