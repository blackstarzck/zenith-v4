import type { ConnectionState } from './connection-state';

export type RealtimeStatusDto = Readonly<{
  connectionState: ConnectionState;
  lastEventAt?: string;
  queueDepth?: number;
  retryCount?: number;
  nextRetryInMs?: number;
  staleThresholdMs: number;
}>;
