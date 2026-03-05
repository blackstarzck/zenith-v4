import { useCallback, useMemo, useState } from 'react';
import { CONNECTION_STATE, type ConnectionState } from '@zenith/contracts';
import type { RealtimeStatus } from '../types/realtime-status';

type UseRealtimeStatusOptions = Readonly<{
  staleThresholdMs?: number;
}>;

export function useRealtimeStatus(options: UseRealtimeStatusOptions = {}) {
  const staleThresholdMs = options.staleThresholdMs ?? 5_000;

  const [connectionState, setConnectionState] = useState<ConnectionState>(
    CONNECTION_STATE.RECONNECTING,
  );
  const [lastEventAt, setLastEventAt] = useState<string | undefined>();
  const [isPending, setIsPending] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [nextRetryInMs, setNextRetryInMs] = useState<number | undefined>();

  const markEventReceived = useCallback((eventTs?: string) => {
    setLastEventAt(eventTs ?? new Date().toISOString());
  }, []);

  const setReconnectState = useCallback((params: { retryCount: number; nextRetryInMs?: number }) => {
    setConnectionState(CONNECTION_STATE.RECONNECTING);
    setRetryCount(params.retryCount);
    setNextRetryInMs(params.nextRetryInMs);
  }, []);

  const markLive = useCallback(() => {
    setConnectionState(CONNECTION_STATE.LIVE);
    setRetryCount(0);
    setNextRetryInMs(undefined);
  }, []);

  const markPaused = useCallback(() => {
    setConnectionState(CONNECTION_STATE.PAUSED);
  }, []);

  const markError = useCallback(() => {
    setConnectionState(CONNECTION_STATE.ERROR);
  }, []);

  const status = useMemo<RealtimeStatus>(() => {
    const now = Date.now();
    const last = lastEventAt ? Date.parse(lastEventAt) : undefined;
    const stale = typeof last === 'number' && !Number.isNaN(last) && now - last > staleThresholdMs;

    if (connectionState === CONNECTION_STATE.LIVE && stale) {
      return {
        connectionState: CONNECTION_STATE.DELAYED,
        isPending,
        isStale: true,
        retryCount,
        ...(lastEventAt ? { lastEventAt } : {}),
        ...(typeof nextRetryInMs === 'number' ? { nextRetryInMs } : {}),
      };
    }

    return {
      connectionState,
      isPending,
      isStale: stale,
      retryCount,
      ...(lastEventAt ? { lastEventAt } : {}),
      ...(typeof nextRetryInMs === 'number' ? { nextRetryInMs } : {}),
    };
  }, [connectionState, isPending, lastEventAt, nextRetryInMs, retryCount, staleThresholdMs]);

  return {
    status,
    setPending: setIsPending,
    markEventReceived,
    markLive,
    markPaused,
    markError,
    setReconnectState,
    setConnectionState,
  };
}
