import { useState } from 'react';
import { ChefHat, Send, CheckCircle, XCircle } from 'lucide-react';
import { GlassCard } from '../components/ui';
import { apiPost } from '../lib/api';

interface CommitResult {
  ok: boolean;
  rev_id?: string;
  error?: string;
  quality_gate?: {
    passed: boolean;
    score?: number;
    issues?: string[];
  };
}

interface CommitForm {
  world_id: string;
  branch_id: string;
  play_id: string;
  author: string;
  summary: string;
  base_revision: string;
  patch: string;
}

const INITIAL_FORM: CommitForm = {
  world_id: '',
  branch_id: '',
  play_id: '',
  author: '',
  summary: '',
  base_revision: '',
  patch: '{}',
};

export default function KitchenPage() {
  const [form, setForm] = useState<CommitForm>(INITIAL_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<CommitResult | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  function setField(key: keyof CommitForm, value: string) {
    setForm(prev => ({ ...prev, [key]: value }));
    setResult(null);
    setValidationError(null);
  }

  async function handleSubmit() {
    // Validate JSON patch
    try {
      JSON.parse(form.patch);
    } catch {
      setValidationError('Patch must be valid JSON');
      return;
    }

    if (!form.world_id.trim() || !form.branch_id.trim() || !form.author.trim() || !form.summary.trim()) {
      setValidationError('World ID, Branch ID, Author and Summary are required');
      return;
    }

    setSubmitting(true);
    setValidationError(null);
    setResult(null);

    try {
      let patch: unknown;
      try { patch = JSON.parse(form.patch); } catch { patch = {}; }

      const data = await apiPost<CommitResult>('/api/v1/commit', {
        world_id: form.world_id,
        branch_id: form.branch_id,
        play_id: form.play_id || undefined,
        author: form.author,
        summary: form.summary,
        base_revision: form.base_revision || undefined,
        patch,
      });
      setResult(data);
    } catch (e: unknown) {
      const msg = (e as { message?: string }).message ?? 'Commit failed';
      setResult({ ok: false, error: msg });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-3 bg-blue-100 rounded-2xl">
          <ChefHat className="w-6 h-6 text-blue-500" />
        </div>
        <div>
          <h2 className="text-3xl font-black text-gray-800">Kitchen</h2>
          <p className="text-gray-500 font-medium mt-0.5">MAID_COMMIT editor</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Commit fields */}
        <GlassCard title="Commit Details" color="blue">
          <div className="space-y-4">
            {[
              { key: 'world_id' as const, label: 'World ID', placeholder: 'e.g. default', required: true },
              { key: 'branch_id' as const, label: 'Branch ID', placeholder: 'e.g. main', required: true },
              { key: 'play_id' as const, label: 'Play ID', placeholder: 'Optional' },
              { key: 'author' as const, label: 'Author', placeholder: 'e.g. atlas', required: true },
              { key: 'summary' as const, label: 'Summary', placeholder: 'What changed?', required: true },
              { key: 'base_revision' as const, label: 'Base Revision', placeholder: 'Optional rev ID' },
            ].map(({ key, label, placeholder, required }) => (
              <div key={key}>
                <label className="block text-xs font-bold text-gray-600 mb-1.5">
                  {label} {required && <span className="text-pink-500">*</span>}
                </label>
                <input
                  type="text"
                  value={form[key]}
                  onChange={e => setField(key, e.target.value)}
                  placeholder={placeholder}
                  className="w-full bg-white/80 border-2 border-blue-50 rounded-2xl px-4 py-2.5 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 transition-all duration-300"
                />
              </div>
            ))}
          </div>
        </GlassCard>

        {/* Patch editor */}
        <GlassCard title="Patch (JSON)" color="blue">
          <div className="space-y-3">
            <textarea
              value={form.patch}
              onChange={e => setField('patch', e.target.value)}
              rows={16}
              spellCheck={false}
              className="w-full bg-white/80 border-2 border-blue-50 rounded-2xl px-4 py-3 font-mono text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 transition-all duration-300 resize-none"
              placeholder='{"entities": [], "facts": []}'
            />
            <p className="text-xs text-gray-400">Paste a valid JSON patch object describing the world changes.</p>
          </div>
        </GlassCard>
      </div>

      {/* Validation error */}
      {validationError && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-red-600 text-sm flex items-center gap-2">
          <XCircle className="w-4 h-4 shrink-0" />
          {validationError}
        </div>
      )}

      {/* Result */}
      {result && (
        <div className={`rounded-2xl p-4 flex items-start gap-3 text-sm ${
          result.ok
            ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
            : 'bg-red-50 border border-red-200 text-red-600'
        }`}>
          {result.ok ? <CheckCircle className="w-5 h-5 shrink-0 mt-0.5" /> : <XCircle className="w-5 h-5 shrink-0 mt-0.5" />}
          <div>
            {result.ok ? (
              <>
                <p className="font-bold">Commit successful!</p>
                {result.rev_id && <p className="font-mono text-xs mt-1">Rev: {result.rev_id}</p>}
                {result.quality_gate && (
                  <div className="mt-2">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${result.quality_gate.passed ? 'bg-emerald-100' : 'bg-amber-100 text-amber-700'}`}>
                      Quality Gate: {result.quality_gate.passed ? 'PASS' : 'FAIL'}
                    </span>
                    {result.quality_gate.issues?.map((issue, i) => (
                      <p key={i} className="text-xs mt-1 text-gray-600">• {issue}</p>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <>
                <p className="font-bold">Commit failed</p>
                <p className="text-xs mt-1">{result.error}</p>
              </>
            )}
          </div>
        </div>
      )}

      <button
        onClick={handleSubmit}
        disabled={submitting}
        className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-500 to-purple-500 text-white font-bold rounded-2xl hover:shadow-lg hover:shadow-blue-500/25 transition-all duration-300 disabled:opacity-60 disabled:cursor-not-allowed"
      >
        <Send className="w-4 h-4" />
        {submitting ? 'Committing...' : 'Submit Commit'}
      </button>
    </div>
  );
}
