import {
  CONNECTION_STATE,
  type ConnectionState
} from '@zenith/contracts';
import { RuntimeMetricsService } from '../../observability/runtime-metrics.service';
import { SystemEventLogger } from '../../observability/system-events/system-event.logger';

type SocketMessageEvent = Readonly<{
  data: unknown;
}>;

type SocketErrorEvent = Readonly<{
  message?: string;
}>;

export type UpbitRealtimeSocket = Readonly<{
  readyState: number;
  addEventListener: {
    (type: 'open', listener: () => void): void;
    (type: 'message', listener: (event: SocketMessageEvent) => void): void;
    (type: 'error', listener: (event: SocketErrorEvent) => void): void;
    (type: 'close', listener: () => void): void;
  };
  send: (payload: string) => void;
  close: () => void;
}>;

type ConnectionScheduler = Readonly<{
  now: () => number;
  setTimeout: (fn: () => void, delayMs: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  setInterval: (fn: () => void, intervalMs: number) => unknown;
  clearInterval: (handle: unknown) => void;
}>;

export const UPBIT_SOCKET_READY_STATE = Object.freeze({
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3
});

export type UpbitRealtimeConnectionOptions = Readonly<{
  wsUrl: string;
  market: string;
  logger: SystemEventLogger;
  metrics: RuntimeMetricsService;
  getRunId: () => string;
  onMessage: (raw: unknown) => Promise<void> | void;
  onStateChange?: (
    input: Readonly<{
      connectionState: ConnectionState;
      retryCount?: number;
      nextRetryInMs?: number;
    }>
  ) => void;
  createWebSocket?: (url: string) => UpbitRealtimeSocket;
  scheduler?: ConnectionScheduler;
}>;

const DEFAULT_SCHEDULER: ConnectionScheduler = {
  now: () => Date.now(),
  setTimeout: (fn, delayMs) => setTimeout(fn, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
  setInterval: (fn, intervalMs) => setInterval(fn, intervalMs),
  clearInterval: (handle) => clearInterval(handle as NodeJS.Timeout)
};

const PAUSED_RECONNECT_ATTEMPT_THRESHOLD = 3;

export class UpbitRealtimeConnection {
  private socket: UpbitRealtimeSocket | undefined;
  private reconnectTimer: unknown;
  private connectionHealthTimer: unknown;
  private reconnectScheduledAtMs: number | undefined;
  private lastMessageAtMs: number | undefined;
  private reconnectAttempt = 0;
  private closedByOwner = false;
  private readonly createWebSocket: (url: string) => UpbitRealtimeSocket;
  private readonly scheduler: ConnectionScheduler;

  constructor(private readonly options: UpbitRealtimeConnectionOptions) {
    this.createWebSocket = options.createWebSocket ?? ((url) => new WebSocket(url) as unknown as UpbitRealtimeSocket);
    this.scheduler = options.scheduler ?? DEFAULT_SCHEDULER;
  }

  start(): void {
    this.closedByOwner = false;
    this.notifyState(CONNECTION_STATE.RECONNECTING, { retryCount: 0 });
    this.connect();
    this.startConnectionHealthMonitor();
  }

  stop(): void {
    this.closedByOwner = true;
    if (this.reconnectTimer) {
      this.scheduler.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    if (this.connectionHealthTimer) {
      this.scheduler.clearInterval(this.connectionHealthTimer);
      this.connectionHealthTimer = undefined;
    }
    this.notifyState(CONNECTION_STATE.PAUSED, { retryCount: this.reconnectAttempt });
    this.socket?.close();
    this.socket = undefined;
  }

  forceReconnectForTest(): Readonly<{ ok: boolean; reason?: string }> {
    if (!this.socket) {
      return { ok: false, reason: 'WS_UNINITIALIZED' };
    }
    this.socket.close();
    return { ok: true };
  }

  private connect(): void {
    try {
      this.socket = this.createWebSocket(this.options.wsUrl);
    } catch (error: unknown) {
      this.notifyState(CONNECTION_STATE.ERROR, { retryCount: this.reconnectAttempt });
      this.options.logger.error('Failed to construct Upbit websocket client', {
        source: 'modules.execution.upbitRealtime.connect',
        runId: this.options.getRunId(),
        payload: { reason: error instanceof Error ? error.message : 'unknown' }
      });
      this.scheduleReconnect();
      return;
    }

    this.socket.addEventListener('open', () => {
      if (typeof this.reconnectScheduledAtMs === 'number') {
        this.options.metrics.markUpbitReconnectRecovered(this.scheduler.now() - this.reconnectScheduledAtMs);
        this.reconnectScheduledAtMs = undefined;
      }
      this.reconnectAttempt = 0;
      this.lastMessageAtMs = this.scheduler.now();
      this.notifyState(CONNECTION_STATE.LIVE, { retryCount: 0 });
      this.options.logger.info('Upbit websocket connected', {
        source: 'modules.execution.upbitRealtime.open',
        runId: this.options.getRunId(),
        payload: { market: this.options.market }
      });
      this.subscribeTradeStream();
    });

    this.socket.addEventListener('message', (event) => {
      this.lastMessageAtMs = this.scheduler.now();
      void this.options.onMessage(event.data);
    });

    this.socket.addEventListener('error', (event) => {
      this.notifyState(CONNECTION_STATE.ERROR, { retryCount: this.reconnectAttempt });
      this.options.logger.warn('Upbit websocket error event', {
        source: 'modules.execution.upbitRealtime.error',
        runId: this.options.getRunId(),
        payload: { message: String(event.message ?? 'unknown') }
      });
    });

    this.socket.addEventListener('close', () => {
      this.options.logger.warn('Upbit websocket closed', {
        source: 'modules.execution.upbitRealtime.close',
        runId: this.options.getRunId(),
        payload: { market: this.options.market, closedByModuleDestroy: this.closedByOwner }
      });
      this.socket = undefined;
      if (!this.closedByOwner) {
        this.scheduleReconnect();
      }
    });
  }

  private subscribeTradeStream(): void {
    if (!this.socket || this.socket.readyState !== UPBIT_SOCKET_READY_STATE.OPEN) {
      return;
    }

    const payload = JSON.stringify([
      { ticket: `zenith-multi-${this.options.market}` },
      { type: 'trade', codes: [this.options.market], isOnlyRealtime: true }
    ]);

    this.socket.send(payload);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.closedByOwner) {
      return;
    }

    this.reconnectAttempt += 1;
    const delayMs = Math.min(30_000, 1_000 * 2 ** Math.min(this.reconnectAttempt, 5));
    this.reconnectScheduledAtMs = this.scheduler.now();
    this.options.metrics.markUpbitReconnectAttempt();
    this.notifyState(
      this.reconnectAttempt >= PAUSED_RECONNECT_ATTEMPT_THRESHOLD
        ? CONNECTION_STATE.PAUSED
        : CONNECTION_STATE.RECONNECTING,
      {
        retryCount: this.reconnectAttempt,
        nextRetryInMs: delayMs
      }
    );
    this.reconnectTimer = this.scheduler.setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, delayMs);

    this.options.logger.warn('Scheduled Upbit websocket reconnect', {
      source: 'modules.execution.upbitRealtime.scheduleReconnect',
      runId: this.options.getRunId(),
      payload: { reconnectAttempt: this.reconnectAttempt, delayMs }
    });
  }

  private startConnectionHealthMonitor(): void {
    if (this.connectionHealthTimer) {
      return;
    }
    const intervalMs = 10 * 60_000;
    this.connectionHealthTimer = this.scheduler.setInterval(() => {
      const wsReadyState = this.socket?.readyState;
      this.options.logger.info('Upbit websocket health check', {
        source: 'modules.execution.upbitRealtime.health',
        runId: this.options.getRunId(),
        payload: {
          market: this.options.market,
          connected: wsReadyState === UPBIT_SOCKET_READY_STATE.OPEN,
          readyState: toReadyStateLabel(wsReadyState),
          reconnectAttempt: this.reconnectAttempt,
          lastMessageAgeMs: typeof this.lastMessageAtMs === 'number' ? this.scheduler.now() - this.lastMessageAtMs : null
        }
      });
    }, intervalMs);
  }

  private notifyState(
    connectionState: ConnectionState,
    input?: Readonly<{
      retryCount?: number;
      nextRetryInMs?: number;
    }>
  ): void {
    this.options.onStateChange?.({
      connectionState,
      ...(typeof input?.retryCount === 'number' ? { retryCount: input.retryCount } : {}),
      ...(typeof input?.nextRetryInMs === 'number' ? { nextRetryInMs: input.nextRetryInMs } : {})
    });
  }
}

function toReadyStateLabel(state: number | undefined): string {
  if (state === UPBIT_SOCKET_READY_STATE.CONNECTING) {
    return 'CONNECTING';
  }
  if (state === UPBIT_SOCKET_READY_STATE.OPEN) {
    return 'OPEN';
  }
  if (state === UPBIT_SOCKET_READY_STATE.CLOSING) {
    return 'CLOSING';
  }
  if (state === UPBIT_SOCKET_READY_STATE.CLOSED) {
    return 'CLOSED';
  }
  return 'UNINITIALIZED';
}
