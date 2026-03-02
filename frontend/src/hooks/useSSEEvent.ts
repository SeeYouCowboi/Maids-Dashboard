import { useEffect } from 'react';
import { globalListeners } from './useSSE';

export function useSSEEvent(eventType: string, handler: (data: unknown) => void) {
  useEffect(() => {
    if (!globalListeners.has(eventType)) {
      globalListeners.set(eventType, new Set());
    }
    globalListeners.get(eventType)!.add(handler);

    return () => {
      globalListeners.get(eventType)?.delete(handler);
    };
  }, [eventType, handler]);
}
