import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CONNECTION_STATE,
  type ConnectionState,
  type RealtimeStatusDto
} from '@zenith/contracts';
import type { RealtimeStatus } from '../types/realtime-status';

type UseRealtimeStatusOptions = Readonly<{
  staleThresholdMs?: number;
  checkIntervalMs?: number;
}>;

export function useRealtimeStatus(options: UseRealtimeStatusOptions = {}) {
  const staleThresholdMs = options.staleThresholdMs ?? 5_000;
  const checkIntervalMs = options.checkIntervalMs ?? 5_000;

  const [connectionState, setConnectionState] = useState<ConnectionState>(
    CONNECTION_STATE.RECONNECTING,
  );
  const [lastEventAt, setLastEventAt] = useState<string | undefined>();
  const [isPending, setIsPending] = useState(false);
  const [queueDepth, setQueueDepth] = useState<number | undefined>();
  const [retryCount, setRetryCount] = useState(0);
  const [nextRetryInMs, setNextRetryInMs] = useState<number | undefined>();
  const [remoteStaleThresholdMs, setRemoteStaleThresholdMs] = useState<number | undefined>();
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNowMs(Date.now());
    }, checkIntervalMs);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [checkIntervalMs]);

  const markEventReceived = useCallback(() => {
    const receivedAt = new Date().toISOString();
    setLastEventAt(receivedAt);
    setNowMs(Date.now());
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

  const syncFromRemote = useCallback((remoteStatus?: RealtimeStatusDto | RealtimeStatus) => {
    if (!remoteStatus) {
      return;
    }

    setConnectionState(remoteStatus.connectionState);
    setLastEventAt(remoteStatus.lastEventAt);
    setQueueDepth(remoteStatus.queueDepth);
    setRetryCount(remoteStatus.retryCount ?? 0);
    setNextRetryInMs(remoteStatus.nextRetryInMs);
    setRemoteStaleThresholdMs(remoteStatus.staleThresholdMs);
    setNowMs(Date.now());
  }, []);

  const status = useMemo<RealtimeStatus>(() => {
    const effectiveStaleThresholdMs = remoteStaleThresholdMs ?? staleThresholdMs;
    const last = lastEventAt ? Date.parse(lastEventAt) : undefined;
    const stale = typeof last === 'number' && !Number.isNaN(last) && nowMs - last > effectiveStaleThresholdMs;

    if (connectionState === CONNECTION_STATE.LIVE && stale) {
      return {
        connectionState: CONNECTION_STATE.DELAYED,
        isPending,
        isStale: true,
        retryCount,
        ...(lastEventAt ? { lastEventAt } : {}),
        ...(typeof queueDepth === 'number' ? { queueDepth } : {}),
        ...(typeof nextRetryInMs === 'number' ? { nextRetryInMs } : {}),
        staleThresholdMs: effectiveStaleThresholdMs,
      };
    }

    return {
      connectionState,
      isPending,
      isStale: stale,
      retryCount,
      ...(lastEventAt ? { lastEventAt } : {}),
      ...(typeof queueDepth === 'number' ? { queueDepth } : {}),
      ...(typeof nextRetryInMs === 'number' ? { nextRetryInMs } : {}),
      staleThresholdMs: effectiveStaleThresholdMs,
    };
  }, [
    connectionState,
    isPending,
    lastEventAt,
    nextRetryInMs,
    nowMs,
    queueDepth,
    remoteStaleThresholdMs,
    retryCount,
    staleThresholdMs
  ]);

  return {
    status,
    setPending: setIsPending,
    markEventReceived,
    markLive,
    markPaused,
    markError,
    setReconnectState,
    setConnectionState,
    syncFromRemote,
  };
}
