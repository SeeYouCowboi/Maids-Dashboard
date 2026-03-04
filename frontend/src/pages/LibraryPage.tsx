import { useState, useEffect } from 'react';
import { BookOpen, Plus, Trash2, Search, Zap, User } from 'lucide-react';
import { motion } from 'motion/react';
import { GlassCard, SearchBar, EmptyState, LoadingSpinner, StatusBadge } from '../components/ui';
import CharacterEditorDrawer from '../components/CharacterEditorDrawer';
import { apiGet, apiPost, apiDelete } from '../lib/api';
import type { LoreEntry, CharacterCard } from '../lib/types';

interface LoreResponse { entries: LoreEntry[] }
interface CharResponse { characters: CharacterCard[] }
interface MatchResult { matched: boolean; entries: LoreEntry[] }

export default function LibraryPage() {
  const [loreEntries, setLoreEntries] = useState<LoreEntry[]>([]);
  const [characters, setCharacters] = useState<CharacterCard[]>([]);
  const [loreLoading, setLoreLoading] = useState(true);
  const [charLoading, setCharLoading] = useState(true);
  const [loreQuery, setLoreQuery] = useState('');
  const [matchQuery, setMatchQuery] = useState('');
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null);
  const [matchLoading, setMatchLoading] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newBody, setNewBody] = useState('');
  const [creating, setCreating] = useState(false);
  const [editChar, setEditChar] = useState<CharacterCard | null>(null);
  const [importText, setImportText] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function fetchLore(q = '') {
    setLoreLoading(true);
    try {
      const data = await apiGet<LoreResponse>(
        `/api/v1/rp/lorebook?world_id=default${q ? `&q=${encodeURIComponent(q)}` : ''}`
      );
      setLoreEntries(data.entries ?? []);
    } catch {
      setLoreEntries([]);
    } finally {
      setLoreLoading(false);
    }
  }

  async function fetchCharacters() {
    setCharLoading(true);
    try {
      const data = await apiGet<CharResponse>('/api/v1/rp/characters?world_id=default');
      setCharacters(data.characters ?? []);
    } catch {
      setCharacters([]);
    } finally {
      setCharLoading(false);
    }
  }

  useEffect(() => {
    fetchLore();
    fetchCharacters();
  }, []);

  async function handleCreate() {
    if (!newTitle.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await apiPost('/api/v1/rp/lorebook', {
        world_id: 'default',
        title: newTitle.trim(),
        body: newBody,
      });
      setNewTitle('');
      setNewBody('');
      fetchLore(loreQuery);
    } catch {
      setError('Failed to create entry');
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await apiDelete(`/api/v1/rp/lorebook/${encodeURIComponent(id)}`);
      setLoreEntries(prev => prev.filter(e => e.id !== id));
    } catch {
      setError('Failed to delete entry');
    }
  }

  async function handleMatchPreview() {
    if (!matchQuery.trim()) return;
    setMatchLoading(true);
    setMatchResult(null);
    try {
      const result = await apiPost<MatchResult>('/api/v1/rp/lorebook/match_preview', {
        world_id: 'default',
        message: matchQuery,
      });
      setMatchResult(result);
    } catch {
      setMatchResult(null);
    } finally {
      setMatchLoading(false);
    }
  }

  async function handleCharImport() {
    if (!importText.trim()) return;
    try {
      const parsed = JSON.parse(importText);
      await apiPost('/api/v1/rp/characters/import', { world_id: 'default', card: parsed });
      fetchCharacters();
      setImportText('');
    } catch {
      setError('Failed to import character card');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-3 bg-purple-100 rounded-2xl">
          <BookOpen className="w-6 h-6 text-purple-500" />
        </div>
        <div>
          <h2 className="text-3xl font-black text-gray-800">Library</h2>
          <p className="text-gray-500 font-medium mt-0.5">Lorebook · Characters · Match Preview</p>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-3 text-red-600 text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Lorebook panel */}
        <div className="space-y-4">
          <GlassCard title="Lorebook" color="purple">
            <SearchBar
              placeholder="Search entries..."
              value={loreQuery}
              onChange={(q) => { setLoreQuery(q); fetchLore(q); }}
              actions={
                <button
                  onClick={() => fetchLore(loreQuery)}
                  className="px-3 py-2 bg-purple-100 text-purple-600 rounded-2xl text-sm font-semibold hover:bg-purple-200 transition-colors"
                >
                  Search
                </button>
              }
            />
            <div className="mt-4 space-y-2 max-h-80 sm:max-h-96 overflow-y-auto pr-1">
              {loreLoading ? (
                <div className="flex justify-center py-6"><LoadingSpinner /></div>
              ) : loreEntries.length === 0 ? (
                <EmptyState icon={<BookOpen className="w-8 h-8" />} message="No lorebook entries." />
              ) : (
                loreEntries.map((entry, i) => (
                  <motion.div
                    key={entry.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.03 }}
                    className="flex items-start gap-3 bg-white/50 rounded-2xl p-3 border border-white/70 group"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-sm text-gray-800 truncate">{entry.title}</p>
                      {entry.body && (
                        <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{entry.body}</p>
                      )}
                    </div>
                    <button
                      onClick={() => handleDelete(entry.id)}
                      className="shrink-0 p-1.5 rounded-xl text-gray-400 hover:text-red-500 hover:bg-red-50 transition-all opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </motion.div>
                ))
              )}
            </div>
          </GlassCard>

          {/* New entry */}
          <GlassCard title="New Entry" color="purple">
            <div className="space-y-3">
              <input
                type="text"
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                placeholder="Title"
                className="w-full bg-white/80 border-2 border-purple-50 rounded-2xl px-4 py-2.5 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:border-purple-300 focus:ring-2 focus:ring-purple-100 transition-all duration-300"
              />
              <textarea
                value={newBody}
                onChange={e => setNewBody(e.target.value)}
                placeholder="Body..."
                rows={3}
                className="w-full bg-white/80 border-2 border-purple-50 rounded-2xl px-4 py-2.5 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:border-purple-300 focus:ring-2 focus:ring-purple-100 transition-all duration-300 resize-none"
              />
              <button
                onClick={handleCreate}
                disabled={creating || !newTitle.trim()}
                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold rounded-2xl text-sm hover:shadow-md hover:shadow-purple-500/25 transition-all duration-300 disabled:opacity-60"
              >
                <Plus className="w-4 h-4" />
                {creating ? 'Creating...' : 'Create'}
              </button>
            </div>
          </GlassCard>

          {/* Match preview */}
          <GlassCard title="Match Preview" color="purple">
            <div className="space-y-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={matchQuery}
                  onChange={e => setMatchQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleMatchPreview()}
                  placeholder="Type a message to test matching..."
                  className="flex-1 bg-white/80 border-2 border-purple-50 rounded-2xl px-4 py-2.5 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:border-purple-300 focus:ring-2 focus:ring-purple-100 transition-all duration-300"
                />
                <button
                  onClick={handleMatchPreview}
                  disabled={matchLoading || !matchQuery.trim()}
                  className="flex items-center gap-1 px-4 py-2 bg-purple-500 text-white font-semibold rounded-2xl text-sm hover:bg-purple-600 transition-colors disabled:opacity-60"
                >
                  <Zap className="w-4 h-4" />
                  Test
                </button>
              </div>
              {matchResult && (
                <div className="bg-white/50 rounded-2xl p-3 border border-purple-100">
                  <div className="flex items-center gap-2 mb-2">
                    <StatusBadge
                      status={matchResult.matched ? 'Matched' : 'No match'}
                      variant={matchResult.matched ? 'success' : 'neutral'}
                    />
                    <span className="text-xs text-gray-500">{matchResult.entries.length} entries</span>
                  </div>
                  {matchResult.entries.map(e => (
                    <p key={e.id} className="text-xs text-gray-600 truncate">• {e.title}</p>
                  ))}
                </div>
              )}
              {matchLoading && <LoadingSpinner />}
            </div>
          </GlassCard>
        </div>

        {/* Characters panel */}
        <div className="space-y-4">
          <GlassCard title="Character Cards" color="purple">
            {charLoading ? (
              <div className="flex justify-center py-6"><LoadingSpinner /></div>
            ) : characters.length === 0 ? (
              <EmptyState icon={<User className="w-8 h-8" />} message="No character cards." />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-96 overflow-y-auto pr-1">
                {characters.map((char, i) => (
                  <motion.button
                    key={char.id}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: i * 0.05 }}
                    onClick={() => setEditChar(char)}
                    className="text-left bg-white/60 rounded-2xl p-4 border border-white/80 hover:border-purple-200 hover:shadow-md transition-all duration-300"
                  >
                    <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-purple-200 to-pink-200 flex items-center justify-center font-bold text-purple-600 text-lg mb-2">
                      {char.name.charAt(0).toUpperCase()}
                    </div>
                    <p className="font-bold text-sm text-gray-800 truncate">{char.name}</p>
                    {char.description && (
                      <p className="text-xs text-gray-500 mt-1 line-clamp-2">{char.description}</p>
                    )}
                  </motion.button>
                ))}
              </div>
            )}
          </GlassCard>

          {/* V2 Card import */}
          <GlassCard title="Import V2 Card" color="purple">
            <div className="space-y-3">
              <textarea
                value={importText}
                onChange={e => setImportText(e.target.value)}
                placeholder='Paste V2 Card JSON here...'
                rows={5}
                className="w-full bg-white/80 border-2 border-purple-50 rounded-2xl px-4 py-3 font-mono text-xs text-gray-700 placeholder-gray-400 focus:outline-none focus:border-purple-300 focus:ring-2 focus:ring-purple-100 transition-all duration-300 resize-none"
              />
              <button
                onClick={handleCharImport}
                disabled={!importText.trim()}
                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold rounded-2xl text-sm hover:shadow-md transition-all duration-300 disabled:opacity-60"
              >
                <Search className="w-4 h-4" />
                Import
              </button>
            </div>
          </GlassCard>
        </div>
      </div>

      <CharacterEditorDrawer
        character={editChar}
        onClose={() => setEditChar(null)}
        onSaved={updated => {
          setCharacters(prev => prev.map(c => c.id === updated.id ? updated : c));
        }}
      />
    </div>
  );
}
