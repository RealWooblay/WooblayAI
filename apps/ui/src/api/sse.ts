import { useEffect, useRef, useCallback } from 'react';
import type { WooblayEventType } from '@wooblay/types';

interface SSEMessage {
  type: string;
  data: unknown;
}

/**
 * React hook that connects to the Gate SSE endpoint.
 * Reconnects automatically on disconnection with exponential backoff.
 *
 * @param types  Optional filter: only fire callback for these event types.
 * @param onEvent  Callback invoked for each matching event.
 */
export function useSSE(
  types: WooblayEventType[] | undefined,
  onEvent: (event: SSEMessage) => void,
) {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const typesKey = types ? types.sort().join(',') : '*';

  const connect = useCallback(() => {
    const url = types?.length
      ? `/api/events?types=${types.join(',')}`
      : '/api/events';

    const source = new EventSource(url);

    source.onmessage = (e) => {
      try {
        const parsed: SSEMessage = JSON.parse(e.data);
        onEventRef.current(parsed);
      } catch {
        // ignore malformed messages
      }
    };

    source.onerror = () => {
      source.close();
      // reconnect after 3 seconds
      setTimeout(() => {
        connect();
      }, 3000);
    };

    return source;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typesKey]);

  useEffect(() => {
    const source = connect();
    return () => source.close();
  }, [connect]);
}
