import { useState, useMemo } from 'react'
import { motion } from 'motion/react'
import { BookOpen, Plus, User, Trash2, Edit3, ScrollText } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type {
  PersonaItem,
  PersonaDetail,
  LoreItem,
  LoreDetail,
} from '@maidsclaw/contracts/browser.js'
import { PageHeader } from '../components/ui/PageHeader'
import { GlassCard } from '../components/ui/GlassCard'
import { SearchBar } from '../components/ui/SearchBar'
import { EmptyState } from '../components/ui/EmptyState'
import { LoadingSpinner } from '../components/ui/LoadingSpinner'
import { StatusBadge } from '../components/ui/StatusBadge'
import { PersonaEditorDrawer } from '../components/PersonaEditorDrawer'
import { LoreEditorDrawer } from '../components/LoreEditorDrawer'
import { ConfirmDeleteDialog } from '../components/ConfirmDeleteDialog'
import { listPersonas, getPersona, deletePersona } from '../api/personas'
import { listLore, getLore, deleteLore } from '../api/lore'
import { queryKeys } from '../query/keys'
import { useOffline } from '../hooks/OfflineContext'
import { ApiError } from '../api/client'

type Tab = 'personas' | 'lore'

interface DeleteTarget {
  id: string
  name: string
  kind: 'persona' | 'lore'
}

function formatApiError(err: unknown): string {
  if (err instanceof ApiError) {
    return `${err.code} — ${err.message}`
  }
  if (err instanceof Error) return err.message
  return 'An unexpected error occurred'
}

export default function LibraryPage() {
  const [activeTab, setActiveTab] = useState<Tab>('personas')
  const [search, setSearch] = useState('')
  const { isOffline } = useOffline()
  const queryClient = useQueryClient()

  const [personaDrawerOpen, setPersonaDrawerOpen] = useState(false)
  const [editingPersona, setEditingPersona] = useState<PersonaDetail | undefined>(undefined)

  const [loreDrawerOpen, setLoreDrawerOpen] = useState(false)
  const [editingLore, setEditingLore] = useState<LoreDetail | undefined>(undefined)

  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | undefined>(undefined)

  const personasQuery = useQuery({
    queryKey: queryKeys.personas.list(),
    queryFn: listPersonas,
  })

  const loreQuery = useQuery({
    queryKey: queryKeys.lore.list(),
    queryFn: listLore,
  })

  const filteredPersonas = useMemo(() => {
    const items = personasQuery.data?.items
    if (!items) return []
    if (!search) return items
    const q = search.toLowerCase()
    return items.filter(
      (p) => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q),
    )
  }, [personasQuery.data, search])

  const filteredLore = useMemo(() => {
    const items = loreQuery.data?.items
    if (!items) return []
    if (!search) return items
    const q = search.toLowerCase()
    return items.filter(
      (l) =>
        l.title.toLowerCase().includes(q) ||
        l.content.toLowerCase().includes(q) ||
        l.keywords.some((k) => k.toLowerCase().includes(q)),
    )
  }, [loreQuery.data, search])

  const deletePersonaMutation = useMutation({
    mutationFn: (id: string) => deletePersona(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.personas.all })
      setDeleteTarget(undefined)
    },
  })

  const deleteLoreMutation = useMutation({
    mutationFn: (id: string) => deleteLore(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.lore.all })
      setDeleteTarget(undefined)
    },
  })

  const activeMutation =
    deleteTarget?.kind === 'persona' ? deletePersonaMutation : deleteLoreMutation

  function handleDeleteConfirm() {
    if (!deleteTarget) return
    activeMutation.mutate(deleteTarget.id)
  }

  async function openPersonaEditor(persona?: PersonaItem | undefined) {
    if (persona) {
      const detail = await queryClient.fetchQuery({
        queryKey: queryKeys.personas.detail(persona.id),
        queryFn: () => getPersona(persona.id),
      })
      setEditingPersona(detail)
    } else {
      setEditingPersona(undefined)
    }
    setPersonaDrawerOpen(true)
  }

  async function openLoreEditor(lore?: LoreItem | undefined) {
    if (lore) {
      const detail = await queryClient.fetchQuery({
        queryKey: queryKeys.lore.detail(lore.id),
        queryFn: () => getLore(lore.id),
      })
      setEditingLore(detail)
    } else {
      setEditingLore(undefined)
    }
    setLoreDrawerOpen(true)
  }

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'personas', label: 'Personas', icon: <User className="w-4 h-4" /> },
    { key: 'lore', label: 'Lore', icon: <ScrollText className="w-4 h-4" /> },
  ]

  return (
    <div className="space-y-6">
      <PageHeader title="Library" subtitle="Persona & Lore Studio" />

      <div className="flex gap-2">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => {
              setActiveTab(tab.key)
              setSearch('')
            }}
            className={`flex items-center gap-2 px-4 py-2 rounded-2xl text-sm font-semibold transition-all duration-200 ${
              activeTab === tab.key
                ? 'bg-purple-500 text-white shadow-md shadow-purple-500/25'
                : 'bg-white/40 text-gray-600 hover:bg-white/60'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      <SearchBar
        placeholder={activeTab === 'personas' ? 'Search personas…' : 'Search lore entries…'}
        value={search}
        onChange={setSearch}
        actions={
          <button
            type="button"
            onClick={() => (activeTab === 'personas' ? openPersonaEditor() : openLoreEditor())}
            disabled={isOffline}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold rounded-2xl text-sm hover:shadow-md hover:shadow-purple-500/25 transition-all duration-300 disabled:opacity-60"
          >
            <Plus className="w-4 h-4" />
            {activeTab === 'personas' ? 'New Persona' : 'New Entry'}
          </button>
        }
      />

      {activeTab === 'personas' ? (
        <PersonaList
          items={filteredPersonas}
          isLoading={personasQuery.isLoading}
          error={personasQuery.error}
          isOffline={isOffline}
          onEdit={openPersonaEditor}
          onDelete={(p) => setDeleteTarget({ id: p.id, name: p.name, kind: 'persona' })}
        />
      ) : (
        <LoreList
          items={filteredLore}
          isLoading={loreQuery.isLoading}
          error={loreQuery.error}
          isOffline={isOffline}
          onEdit={openLoreEditor}
          onDelete={(l) => setDeleteTarget({ id: l.id, name: l.title, kind: 'lore' })}
        />
      )}

      <PersonaEditorDrawer
        open={personaDrawerOpen}
        persona={editingPersona}
        onClose={() => setPersonaDrawerOpen(false)}
      />

      <LoreEditorDrawer
        open={loreDrawerOpen}
        lore={editingLore}
        onClose={() => setLoreDrawerOpen(false)}
      />

      <ConfirmDeleteDialog
        open={deleteTarget !== undefined}
        name={deleteTarget?.name ?? ''}
        entityLabel={deleteTarget?.kind === 'persona' ? 'Persona' : 'Lore Entry'}
        onConfirm={handleDeleteConfirm}
        onCancel={() => {
          setDeleteTarget(undefined)
          deletePersonaMutation.reset()
          deleteLoreMutation.reset()
        }}
        isPending={activeMutation.isPending}
        error={activeMutation.error ? formatApiError(activeMutation.error) : undefined}
      />
    </div>
  )
}

function PersonaList({
  items,
  isLoading,
  error,
  isOffline,
  onEdit,
  onDelete,
}: {
  items: PersonaItem[]
  isLoading: boolean
  error: Error | null
  isOffline: boolean
  onEdit: (p: PersonaItem) => void
  onDelete: (p: PersonaItem) => void
}) {
  if (isLoading) {
    return (
      <GlassCard color="purple">
        <div className="flex justify-center py-12">
          <LoadingSpinner />
        </div>
      </GlassCard>
    )
  }

  if (error) {
    return (
      <GlassCard color="purple">
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-600 text-sm">
          {formatApiError(error)}
        </div>
      </GlassCard>
    )
  }

  if (items.length === 0) {
    return (
      <GlassCard color="purple">
        <EmptyState icon={<User className="w-8 h-8" />} message="No personas found." />
      </GlassCard>
    )
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {items.map((persona, i) => (
        <motion.div
          key={persona.id}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.04 }}
        >
          <GlassCard color="purple" className="h-full">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 shrink-0 rounded-2xl bg-gradient-to-br from-purple-200 to-pink-200 flex items-center justify-center font-bold text-purple-600 text-lg">
                {persona.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm text-gray-800 truncate">{persona.name}</p>
                {persona.description && (
                  <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{persona.description}</p>
                )}
                {persona.tags && persona.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {persona.tags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-block bg-purple-50 text-purple-600 text-[10px] font-semibold px-2 py-0.5 rounded-full"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="flex gap-2 mt-3 justify-end">
              <button
                type="button"
                onClick={() => onEdit(persona)}
                className="p-1.5 rounded-xl text-gray-400 hover:text-purple-600 hover:bg-purple-50 transition-all"
              >
                <Edit3 className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => onDelete(persona)}
                disabled={isOffline}
                className="p-1.5 rounded-xl text-gray-400 hover:text-red-500 hover:bg-red-50 transition-all disabled:opacity-40"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </GlassCard>
        </motion.div>
      ))}
    </div>
  )
}

function LoreList({
  items,
  isLoading,
  error,
  isOffline,
  onEdit,
  onDelete,
}: {
  items: LoreItem[]
  isLoading: boolean
  error: Error | null
  isOffline: boolean
  onEdit: (l: LoreItem) => void
  onDelete: (l: LoreItem) => void
}) {
  if (isLoading) {
    return (
      <GlassCard color="purple">
        <div className="flex justify-center py-12">
          <LoadingSpinner />
        </div>
      </GlassCard>
    )
  }

  if (error) {
    return (
      <GlassCard color="purple">
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-red-600 text-sm">
          {formatApiError(error)}
        </div>
      </GlassCard>
    )
  }

  if (items.length === 0) {
    return (
      <GlassCard color="purple">
        <EmptyState icon={<BookOpen className="w-8 h-8" />} message="No lore entries found." />
      </GlassCard>
    )
  }

  return (
    <div className="space-y-3">
      {items.map((entry, i) => (
        <motion.div
          key={entry.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.03 }}
        >
          <GlassCard color="purple">
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <p className="font-bold text-sm text-gray-800 truncate">{entry.title}</p>
                  <StatusBadge
                    status={entry.enabled ? 'Enabled' : 'Disabled'}
                    variant={entry.enabled ? 'success' : 'neutral'}
                  />
                  <StatusBadge status={entry.scope} variant="info" />
                </div>
                <p className="text-xs text-gray-500 line-clamp-2">{entry.content}</p>
                {entry.keywords.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {entry.keywords.map((kw) => (
                      <span
                        key={kw}
                        className="inline-block bg-purple-50 text-purple-600 text-[10px] font-semibold px-2 py-0.5 rounded-full"
                      >
                        {kw}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => onEdit(entry)}
                  className="p-1.5 rounded-xl text-gray-400 hover:text-purple-600 hover:bg-purple-50 transition-all"
                >
                  <Edit3 className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(entry)}
                  disabled={isOffline}
                  className="p-1.5 rounded-xl text-gray-400 hover:text-red-500 hover:bg-red-50 transition-all disabled:opacity-40"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          </GlassCard>
        </motion.div>
      ))}
    </div>
  )
}
