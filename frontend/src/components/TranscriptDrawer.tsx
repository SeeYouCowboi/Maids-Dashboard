import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, User, Bot, Wrench, ChevronDown } from 'lucide-react';
import { apiGet } from '../lib/api';
import type { Session } from '../lib/types';

interface Message {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp?: string;
}

interface TranscriptResponse {
  messages: Message[];
  total?: number;
}

interface TranscriptDrawerProps {
  session: Session | null;
  onClose: () => void;
}

const ROLE_ICON = {
  user: User,
  assistant: Bot,
  tool: Wrench,
};

const ROLE_COLOR = {
  user: 'bg-pink-100 text-pink-700 border-pink-200',
  assistant: 'bg-blue-100 text-blue-700 border-blue-200',
  tool: 'bg-amber-100 text-amber-700 border-amber-200',
};

export default function TranscriptDrawer({ session, onClose }: TranscriptDrawerProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const PAGE_SIZE = 50;

  useEffect(() => {
    if (!session) return;
    setMessages([]);
    setPage(0);
    setError(null);
    fetchMessages(session.key, 0);
  }, [session?.key]);

  async function fetchMessages(key: string, pageNum: number) {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<TranscriptResponse>(
        `/api/v1/sessions/${encodeURIComponent(key)}/messages?offset=${pageNum * PAGE_SIZE}&limit=${PAGE_SIZE}`
      );
      const msgs = data.messages ?? [];
      setMessages(prev => pageNum === 0 ? msgs : [...prev, ...msgs]);
      setHasMore(msgs.length === PAGE_SIZE);
    } catch {
      setError('Could not load transcript.');
    } finally {
      setLoading(false);
    }
  }

  function loadMore() {
    if (!session) return;
    const next = page + 1;
    setPage(next);
    fetchMessages(session.key, next);
  }

  return (
    <AnimatePresence>
      {session && (
        <>
          {/* Overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40"
            onClick={onClose}
          />

          {/* Drawer */}
          <motion.aside
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', bounce: 0.1, duration: 0.4 }}
            className="fixed right-0 top-0 h-full w-full max-w-[600px] z-50 bg-white/60 backdrop-blur-xl border-l border-white/60 shadow-2xl flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/60">
              <div>
                <h2 className="text-lg font-bold text-gray-800">Transcript</h2>
                <p className="text-xs text-gray-500 font-mono truncate max-w-[400px]">{session.key}</p>
              </div>
              <button
                onClick={onClose}
                className="p-2 rounded-2xl hover:bg-white/60 transition-colors text-gray-500 hover:text-gray-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
              {loading && messages.length === 0 && (
                <div className="flex items-center justify-center py-12 text-gray-400">
                  <div className="w-6 h-6 border-2 border-pink-300 border-t-transparent rounded-full animate-spin mr-3" />
                  Loading messages...
                </div>
              )}
              {error && (
                <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-red-600 text-sm">
                  {error}
                </div>
              )}
              {!loading && !error && messages.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                  <Bot className="w-12 h-12 mb-3 opacity-30" />
                  <p className="text-sm">No messages found for this session.</p>
                </div>
              )}
              {messages.map((msg, i) => {
                const Icon = ROLE_ICON[msg.role] ?? User;
                const colorClass = ROLE_COLOR[msg.role] ?? ROLE_COLOR.user;
                return (
                  <div key={i} className="flex gap-3">
                    <div className={`shrink-0 w-8 h-8 rounded-xl border flex items-center justify-center ${colorClass}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-xs font-bold capitalize ${colorClass.split(' ')[1]}`}>
                          {msg.role}
                        </span>
                        {msg.timestamp && (
                          <span className="text-xs text-gray-400">{msg.timestamp}</span>
                        )}
                      </div>
                      <div className="bg-white/60 rounded-2xl px-4 py-3 text-sm text-gray-700 whitespace-pre-wrap break-words">
                        {typeof msg.content === 'string'
                          ? msg.content
                          : JSON.stringify(msg.content, null, 2)}
                      </div>
                    </div>
                  </div>
                );
              })}

              {hasMore && (
                <button
                  onClick={loadMore}
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2 py-3 text-sm text-pink-500 hover:text-pink-600 font-semibold transition-colors"
                >
                  {loading ? (
                    <div className="w-4 h-4 border-2 border-pink-300 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                  Load more
                </button>
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
