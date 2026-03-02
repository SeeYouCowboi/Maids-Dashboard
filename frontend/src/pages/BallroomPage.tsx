import { useState, useEffect, useRef } from 'react';
import { Music, Send, Plus, Archive, Users, MessageSquare } from 'lucide-react';
import { motion } from 'motion/react';
import { GlassCard, EmptyState, LoadingSpinner, StatusBadge } from '../components/ui';
import { apiGet, apiPost } from '../lib/api';
import { useSSEEvent } from '../hooks';

interface RPRoom {
  id: string;
  name?: string;
  archived?: boolean;
  participants?: string[];
}

interface RPMessage {
  id: string;
  role?: string;
  author?: string;
  content: string;
  ts?: number;
}

interface RoomsResponse { rooms: RPRoom[] }
interface MessagesResponse { messages: RPMessage[] }

export default function BallroomPage() {
  const [rooms, setRooms] = useState<RPRoom[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<RPRoom | null>(null);
  const [messages, setMessages] = useState<RPMessage[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [msgLoading, setMsgLoading] = useState(false);
  const [newParticipant, setNewParticipant] = useState('');
  const [composer, setComposer] = useState('');
  const [sending, setSending] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [creatingRoom, setCreatingRoom] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  async function fetchRooms() {
    setLoading(true);
    try {
      const data = await apiGet<RoomsResponse>('/api/v1/rp/rooms');
      setRooms(data.rooms ?? []);
    } catch {
      setRooms([]);
    } finally {
      setLoading(false);
    }
  }

  async function fetchMessages(room: RPRoom) {
    setMsgLoading(true);
    try {
      const data = await apiGet<MessagesResponse>(
        `/api/v1/rp/rooms/${encodeURIComponent(room.id)}/messages`
      );
      setMessages(data.messages ?? []);
    } catch {
      setMessages([]);
    } finally {
      setMsgLoading(false);
    }
  }

  useEffect(() => { fetchRooms(); }, []);

  useEffect(() => {
    if (selectedRoom) fetchMessages(selectedRoom);
  }, [selectedRoom?.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useSSEEvent('rp_message', (data: unknown) => {
    const msg = data as RPMessage;
    if (selectedRoom && msg) setMessages(prev => [...prev, msg]);
  });

  async function handleSend() {
    if (!composer.trim() || !selectedRoom) return;
    setSending(true);
    try {
      await apiPost(`/api/v1/rp/rooms/${encodeURIComponent(selectedRoom.id)}/messages`, {
        content: composer.trim(),
        role: 'user',
      });
      setComposer('');
      fetchMessages(selectedRoom);
    } catch {
      // noop
    } finally {
      setSending(false);
    }
  }

  async function handleCreateRoom() {
    if (!newRoomName.trim()) return;
    setCreatingRoom(true);
    try {
      const data = await apiPost<{ room: RPRoom }>('/api/v1/rp/rooms', { name: newRoomName.trim() });
      setRooms(prev => [...prev, data.room]);
      setSelectedRoom(data.room);
      setNewRoomName('');
    } catch {
      // noop
    } finally {
      setCreatingRoom(false);
    }
  }

  async function handleAddParticipant() {
    if (!newParticipant.trim() || !selectedRoom) return;
    try {
      await apiPost(`/api/v1/rp/rooms/${encodeURIComponent(selectedRoom.id)}/participants`, {
        character_id: newParticipant.trim(),
      });
      setNewParticipant('');
      fetchRooms();
    } catch {
      // noop
    }
  }

  const visibleRooms = rooms.filter(r => showArchived || !r.archived);
  const participants = selectedRoom?.participants ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-3 bg-amber-100 rounded-2xl">
          <Music className="w-6 h-6 text-amber-500" />
        </div>
        <div>
          <h2 className="text-3xl font-black text-gray-800">Ballroom</h2>
          <p className="text-gray-500 font-medium mt-0.5">RP Rooms · Live Chat</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6" style={{ minHeight: '60vh' }}>
        {/* Room selector + participants */}
        <div className="xl:col-span-1 space-y-4">
          <GlassCard title="Rooms" color="amber">
            <div className="space-y-3">
              {/* Room selector */}
              <div className="flex items-center gap-2">
                <select
                  value={selectedRoom?.id ?? ''}
                  onChange={e => {
                    const room = rooms.find(r => r.id === e.target.value);
                    setSelectedRoom(room ?? null);
                  }}
                  className="flex-1 bg-white/80 border-2 border-amber-50 rounded-2xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:border-amber-300 transition-all duration-300"
                >
                  <option value="">Select room...</option>
                  {visibleRooms.map(r => (
                    <option key={r.id} value={r.id}>
                      {r.name ?? r.id}
                    </option>
                  ))}
                </select>
              </div>

              {/* Show archived toggle */}
              <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={e => setShowArchived(e.target.checked)}
                  className="rounded"
                />
                Show archived
              </label>

              {/* Create room */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newRoomName}
                  onChange={e => setNewRoomName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleCreateRoom()}
                  placeholder="New room name..."
                  className="flex-1 bg-white/80 border-2 border-amber-50 rounded-2xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:border-amber-300 transition-all duration-300"
                />
                <button
                  onClick={handleCreateRoom}
                  disabled={creatingRoom || !newRoomName.trim()}
                  className="p-2 bg-amber-500 text-white rounded-2xl hover:bg-amber-600 transition-colors disabled:opacity-60"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>

              {loading && <LoadingSpinner />}
            </div>
          </GlassCard>

          {/* Participants */}
          <GlassCard title="Participants" color="amber">
            {participants.length === 0 ? (
              <EmptyState icon={<Users className="w-6 h-6" />} message="No participants." />
            ) : (
              <div className="space-y-2">
                {participants.map(p => (
                  <div key={p} className="flex items-center gap-2 bg-white/50 rounded-2xl px-3 py-2">
                    <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-amber-200 to-pink-200 flex items-center justify-center text-xs font-bold text-amber-700">
                      {p.charAt(0).toUpperCase()}
                    </div>
                    <span className="text-sm text-gray-700 font-medium">{p}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2 mt-3">
              <input
                type="text"
                value={newParticipant}
                onChange={e => setNewParticipant(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddParticipant()}
                placeholder="Add character..."
                className="flex-1 bg-white/80 border-2 border-amber-50 rounded-2xl px-3 py-2 text-sm text-gray-700 focus:outline-none focus:border-amber-300 transition-all duration-300"
              />
              <button
                onClick={handleAddParticipant}
                disabled={!newParticipant.trim() || !selectedRoom}
                className="p-2 bg-amber-400 text-white rounded-2xl hover:bg-amber-500 transition-colors disabled:opacity-60"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </GlassCard>
        </div>

        {/* Message area */}
        <div className="xl:col-span-3">
          <GlassCard className="h-full flex flex-col" color="amber">
            <div className="flex items-center gap-2 mb-4">
              <MessageSquare className="w-4 h-4 text-amber-500" />
              <span className="text-sm font-bold text-amber-600">
                {selectedRoom ? (selectedRoom.name ?? selectedRoom.id) : 'No room selected'}
              </span>
              {selectedRoom?.archived && <StatusBadge status="Archived" variant="neutral" />}
            </div>

            {!selectedRoom ? (
              <div className="flex-1 flex items-center justify-center">
                <EmptyState
                  icon={<Music className="w-12 h-12" />}
                  message="Select or create a room to start chatting."
                />
              </div>
            ) : (
              <>
                <div className="flex-1 overflow-y-auto space-y-3 mb-4 min-h-[300px] max-h-[500px]">
                  {msgLoading ? (
                    <div className="flex justify-center py-8"><LoadingSpinner /></div>
                  ) : messages.length === 0 ? (
                    <EmptyState icon={<MessageSquare className="w-8 h-8" />} message="No messages yet." />
                  ) : (
                    messages.map((msg, i) => (
                      <motion.div
                        key={msg.id ?? i}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
                      >
                        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-200 to-pink-200 flex items-center justify-center text-xs font-bold text-amber-700 shrink-0">
                          {(msg.author ?? msg.role ?? '?').charAt(0).toUpperCase()}
                        </div>
                        <div className={`max-w-[80%] ${msg.role === 'user' ? 'items-end' : 'items-start'} flex flex-col`}>
                          <span className="text-xs text-gray-400 mb-1">{msg.author ?? msg.role}</span>
                          <div className={`rounded-2xl px-4 py-2.5 text-sm ${
                            msg.role === 'user'
                              ? 'bg-amber-500 text-white'
                              : 'bg-white/70 text-gray-700 border border-white/80'
                          }`}>
                            {msg.content}
                          </div>
                        </div>
                      </motion.div>
                    ))
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Composer */}
                <div className="flex gap-3 border-t border-white/60 pt-4">
                  <input
                    type="text"
                    value={composer}
                    onChange={e => setComposer(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
                    placeholder="Type a message..."
                    className="flex-1 bg-white/80 border-2 border-amber-50 rounded-2xl px-4 py-3 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-100 transition-all duration-300"
                  />
                  <button
                    onClick={handleSend}
                    disabled={sending || !composer.trim()}
                    className="p-3 bg-gradient-to-r from-amber-500 to-pink-500 text-white rounded-2xl hover:shadow-md hover:shadow-amber-500/25 transition-all duration-300 disabled:opacity-60"
                  >
                    <Send className="w-5 h-5" />
                  </button>
                </div>
              </>
            )}
          </GlassCard>
        </div>
      </div>
    </div>
  );
}
