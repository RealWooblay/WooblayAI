import type { WooblayEvent, WooblayEventType } from '@wooblay/types';

export interface SSEOptions {
  url: string;
  types?: WooblayEventType[];
  lastEventId?: string;
  onEvent: (event: WooblayEvent & { id: string }) => void;
  onError?: (error: Error) => void;
}

/**
 * Subscribe to the Gate SSE event stream with auto-reconnect.
 * Returns a cleanup function.
 */
export function subscribeSSE(opts: SSEOptions): () => void {
  let aborted = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let lastId = opts.lastEventId;

  function connect() {
    if (aborted) return;

    const params = new URLSearchParams();
    if (opts.types?.length) params.set('types', opts.types.join(','));
    if (lastId) params.set('since', lastId);

    const url = `${opts.url}?${params.toString()}`;
    const es = new EventSource(url);

    es.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data) as WooblayEvent;
        lastId = e.lastEventId;
        opts.onEvent({ ...parsed, id: e.lastEventId });
      } catch (err) {
        opts.onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    };

    es.onerror = () => {
      es.close();
      if (!aborted) {
        reconnectTimer = setTimeout(connect, 3000);
      }
    };
  }

  connect();

  return () => {
    aborted = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
  };
}
