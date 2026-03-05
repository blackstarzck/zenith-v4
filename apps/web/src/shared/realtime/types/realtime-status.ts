import type { ConnectionState } from '@zenith/contracts';

export type RealtimeStatus = Readonly<{
  connectionState: ConnectionState;
  isPending: boolean;
  isStale: boolean;
  lastEventAt?: string;
  retryCount: number;
  nextRetryInMs?: number;
}>;
