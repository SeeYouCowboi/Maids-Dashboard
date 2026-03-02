import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Save, Download } from 'lucide-react';
import { apiPut } from '../lib/api';
import type { CharacterCard } from '../lib/types';

interface CharacterEditorDrawerProps {
  character: CharacterCard | null;
  onClose: () => void;
  onSaved: (updated: CharacterCard) => void;
}

const FIELDS: Array<{ key: keyof CharacterCard; label: string; multiline?: boolean }> = [
  { key: 'name', label: 'Name' },
  { key: 'description', label: 'Description', multiline: true },
  { key: 'personality', label: 'Personality', multiline: true },
  { key: 'scenario', label: 'Scenario', multiline: true },
  { key: 'first_mes', label: 'First Message', multiline: true },
  { key: 'mes_example', label: 'Message Example', multiline: true },
  { key: 'system_prompt', label: 'System Prompt', multiline: true },
  { key: 'creator_notes', label: 'Creator Notes', multiline: true },
  { key: 'character_version', label: 'Character Version' },
];

export default function CharacterEditorDrawer({ character, onClose, onSaved }: CharacterEditorDrawerProps) {
  const [form, setForm] = useState<Partial<CharacterCard>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (character) setForm({ ...character });
  }, [character?.id]);

  function setField(key: keyof CharacterCard, value: string) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    if (!character) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await apiPut<CharacterCard>(
        `/api/v1/rp/characters/${encodeURIComponent(character.id)}`,
        form
      );
      onSaved(updated);
      onClose();
    } catch {
      setError('Failed to save character.');
    } finally {
      setSaving(false);
    }
  }

  function handleExportV2() {
    if (!character) return;
    const v2 = {
      spec: 'chara_card_v2',
      spec_version: '2.0',
      data: {
        name: form.name ?? character.name,
        description: form.description ?? '',
        personality: form.personality ?? '',
        scenario: form.scenario ?? '',
        first_mes: form.first_mes ?? '',
        mes_example: form.mes_example ?? '',
        system_prompt: form.system_prompt ?? '',
        creator_notes: form.creator_notes ?? '',
        character_version: form.character_version ?? '',
        tags: [],
      },
    };
    const blob = new Blob([JSON.stringify(v2, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${form.name ?? 'character'}-v2.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <AnimatePresence>
      {character && (
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
              <h2 className="text-lg font-bold text-gray-800">Edit Character</h2>
              <button
                onClick={onClose}
                className="p-2 rounded-2xl hover:bg-white/60 transition-colors text-gray-500 hover:text-gray-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {error && (
                <div className="bg-red-50 border border-red-200 rounded-2xl p-3 text-red-600 text-sm">{error}</div>
              )}
              {FIELDS.map(({ key, label, multiline }) => (
                <div key={key}>
                  <label className="block text-xs font-bold text-gray-600 mb-1">{label}</label>
                  {multiline ? (
                    <textarea
                      value={(form[key] as string) ?? ''}
                      onChange={e => setField(key, e.target.value)}
                      rows={4}
                      className="w-full bg-white/80 border border-white/90 rounded-2xl px-4 py-3 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:border-purple-300 focus:ring-2 focus:ring-purple-100 transition-all duration-300 resize-y"
                    />
                  ) : (
                    <input
                      type="text"
                      value={(form[key] as string) ?? ''}
                      onChange={e => setField(key, e.target.value)}
                      className="w-full bg-white/80 border border-white/90 rounded-2xl px-4 py-3 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:border-purple-300 focus:ring-2 focus:ring-purple-100 transition-all duration-300"
                    />
                  )}
                </div>
              ))}
            </div>

            <div className="px-6 py-4 border-t border-white/60 flex gap-3">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold py-2.5 rounded-2xl hover:shadow-md hover:shadow-purple-500/25 transition-all duration-300 disabled:opacity-60"
              >
                <Save className="w-4 h-4" />
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={handleExportV2}
                className="flex items-center gap-2 px-4 bg-white/60 text-gray-600 font-semibold py-2.5 rounded-2xl border border-white/80 hover:bg-white/80 transition-all duration-300"
              >
                <Download className="w-4 h-4" />
                V2
              </button>
              <button
                onClick={onClose}
                className="px-4 bg-white/60 text-gray-600 font-semibold py-2.5 rounded-2xl border border-white/80 hover:bg-white/80 transition-all duration-300"
              >
                Cancel
              </button>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
