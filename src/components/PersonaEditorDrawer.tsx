import { useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { X, Save, Plus, Trash2 } from 'lucide-react'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { PersonaFormSchema } from '../schemas/forms'
import type { PersonaForm, PersonaDetail } from '@maidsclaw/contracts/browser.js'
import { createPersona, updatePersona } from '../api/personas'
import { queryKeys } from '../query/keys'
import { useOffline } from '../hooks/OfflineContext'
import { ApiError } from '../api/client'

interface PersonaEditorDrawerProps {
  open: boolean
  persona: PersonaDetail | undefined
  onClose: () => void
}

function formatApiError(err: unknown): string {
  if (err instanceof ApiError) {
    return `${err.code} — ${err.message}`
  }
  if (err instanceof Error) return err.message
  return 'An unexpected error occurred'
}

export function PersonaEditorDrawer({ open, persona, onClose }: PersonaEditorDrawerProps) {
  const isEdit = persona !== undefined
  const queryClient = useQueryClient()
  const { isOffline } = useOffline()

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isDirty },
  } = useForm<PersonaForm>({
    resolver: zodResolver(PersonaFormSchema),
    defaultValues: {
      id: '',
      name: '',
      description: '',
      persona: '',
      world: undefined,
      system_prompt: undefined,
      tags: undefined,
      message_examples: undefined,
      hidden_tasks: undefined,
      private_persona: undefined,
    },
  })

  const {
    fields: messageExampleFields,
    append: appendExample,
    remove: removeExample,
  } = useFieldArray({
    control,
    name: 'message_examples',
  })

  const resetToPersona = useCallback(
    (p: PersonaDetail | undefined) => {
      if (p) {
        reset({
          id: p.id,
          name: p.name,
          description: p.description,
          persona: p.persona,
          world: p.world,
          system_prompt: p.system_prompt,
          tags: p.tags,
          message_examples: p.message_examples,
          hidden_tasks: p.hidden_tasks,
          private_persona: p.private_persona,
        })
      } else {
        reset({
          id: '',
          name: '',
          description: '',
          persona: '',
          world: undefined,
          system_prompt: undefined,
          tags: undefined,
          message_examples: undefined,
          hidden_tasks: undefined,
          private_persona: undefined,
        })
      }
    },
    [reset],
  )

  useEffect(() => {
    if (open) {
      resetToPersona(persona)
    }
  }, [open, persona, resetToPersona])

  const saveMutation = useMutation({
    mutationFn: (data: PersonaForm) =>
      isEdit ? updatePersona(data.id, data) : createPersona(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.personas.all })
      onClose()
    },
  })

  function onSubmit(data: PersonaForm) {
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
                {isEdit ? 'Edit Persona' : 'New Persona'}
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
                    placeholder="unique-persona-id"
                    className={fieldInputClass(isEdit)}
                  />
                </FieldWrapper>

                <FieldWrapper label="Name" error={errors.name?.message}>
                  <input
                    type="text"
                    {...register('name')}
                    placeholder="Persona name"
                    className={fieldInputClass()}
                  />
                </FieldWrapper>

                <FieldWrapper label="Description" error={errors.description?.message}>
                  <textarea
                    {...register('description')}
                    rows={2}
                    placeholder="Short description"
                    className={fieldTextareaClass()}
                  />
                </FieldWrapper>

                <FieldWrapper label="Persona" error={errors.persona?.message}>
                  <textarea
                    {...register('persona')}
                    rows={4}
                    placeholder="Persona definition text"
                    className={fieldTextareaClass()}
                  />
                </FieldWrapper>

                <FieldWrapper label="World" error={errors.world?.message}>
                  <textarea
                    {...register('world')}
                    rows={3}
                    placeholder="World / setting description (optional)"
                    className={fieldTextareaClass()}
                  />
                </FieldWrapper>

                <FieldWrapper label="System Prompt" error={errors.system_prompt?.message}>
                  <textarea
                    {...register('system_prompt')}
                    rows={3}
                    placeholder="System prompt override (optional)"
                    className={fieldTextareaClass()}
                  />
                </FieldWrapper>

                <FieldWrapper label="Private Persona" error={errors.private_persona?.message}>
                  <textarea
                    {...register('private_persona')}
                    rows={2}
                    placeholder="Private persona notes (optional)"
                    className={fieldTextareaClass()}
                  />
                </FieldWrapper>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="block text-xs font-bold text-gray-600">Message Examples</span>
                    <button
                      type="button"
                      onClick={() => appendExample({ role: '', content: '' })}
                      className="flex items-center gap-1 text-xs text-purple-600 hover:text-purple-700 font-semibold"
                    >
                      <Plus className="w-3 h-3" />
                      Add
                    </button>
                  </div>
                  {messageExampleFields.map((field, idx) => (
                    <div key={field.id} className="flex gap-2 mb-2">
                      <input
                        type="text"
                        {...register(`message_examples.${idx}.role`)}
                        placeholder="Role"
                        className="w-24 bg-white/80 border border-white/90 rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:border-purple-300 focus:ring-2 focus:ring-purple-100 transition-all"
                      />
                      <input
                        type="text"
                        {...register(`message_examples.${idx}.content`)}
                        placeholder="Content"
                        className="flex-1 bg-white/80 border border-white/90 rounded-xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:border-purple-300 focus:ring-2 focus:ring-purple-100 transition-all"
                      />
                      <button
                        type="button"
                        onClick={() => removeExample(idx)}
                        className="p-2 text-gray-400 hover:text-red-500 rounded-xl hover:bg-red-50 transition-all"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  {errors.message_examples && (
                    <p className="text-xs text-red-500 mt-1">
                      {typeof errors.message_examples.message === 'string'
                        ? errors.message_examples.message
                        : 'Invalid message examples'}
                    </p>
                  )}
                </div>
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
