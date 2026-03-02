import { useEffect, useRef, useState, useCallback } from 'react';

export type SSEState = 'connecting' | 'connected' | 'disconnected';

export interface SSEEvent {
  type: string;
  data: unknown;
  timestamp: number;
}

// Global SSE singleton — shared across all components
let globalEventSource: EventSource | null = null;
export const globalListeners = new Map<string, Set<(data: unknown) => void>>();
let globalState: SSEState = 'disconnected';
const stateListeners = new Set<(state: SSEState) => void>();

function getSSEUrl(secret: string | null): string {
  const base = '/api/v1/stream';
  return secret ? `${base}?secret=${encodeURIComponent(secret)}` : base;
}

function connectSSE(secret: string | null) {
  if (globalEventSource) return;
  globalState = 'connecting';
  stateListeners.forEach(fn => fn(globalState));

  const es = new EventSource(getSSEUrl(secret));
  globalEventSource = es;

  es.onopen = () => {
    globalState = 'connected';
    stateListeners.forEach(fn => fn(globalState));
  };

  es.onerror = () => {
    globalState = 'disconnected';
    stateListeners.forEach(fn => fn(globalState));
    es.close();
    globalEventSource = null;
    // Reconnect after 3 seconds
    setTimeout(() => connectSSE(secret), 3000);
  };

  es.onmessage = (event) => {
    try {
      const parsed = JSON.parse(event.data);
      const type = parsed.type || 'message';
      const listeners = globalListeners.get(type);
      if (listeners) {
        listeners.forEach(fn => fn(parsed));
      }
      // Also dispatch to '*' wildcard listeners
      const wildcard = globalListeners.get('*');
      if (wildcard) wildcard.forEach(fn => fn(parsed));
    } catch {
      // ignore parse errors
    }
  };
}

export function useSSE(secret: string | null) {
  const [state, setState] = useState<SSEState>(globalState);
  const connectedRef = useRef(false);

  useEffect(() => {
    if (connectedRef.current) return; // Strict Mode guard
    connectedRef.current = true;

    stateListeners.add(setState);
    if (!globalEventSource) {
      connectSSE(secret);
    }

    return () => {
      stateListeners.delete(setState);
      // Don't close the global connection on component unmount
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const reconnect = useCallback(() => {
    if (globalEventSource) {
      globalEventSource.close();
      globalEventSource = null;
    }
    connectSSE(secret);
  }, [secret]);

  return { state, reconnect };
}
