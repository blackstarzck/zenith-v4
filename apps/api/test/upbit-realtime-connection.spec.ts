import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { CONNECTION_STATE } from '@zenith/contracts';
import { RuntimeMetricsService } from '../src/modules/observability/runtime-metrics.service';
import {
  UPBIT_SOCKET_READY_STATE,
  UpbitRealtimeConnection,
  type UpbitRealtimeSocket
} from '../src/modules/execution/engine/upbit-realtime-connection';

class FakeLogger {
  readonly infos: Array<Readonly<{ message: string; input?: unknown }>> = [];
  readonly warns: Array<Readonly<{ message: string; input?: unknown }>> = [];
  readonly errors: Array<Readonly<{ message: string; input?: unknown }>> = [];

  info(message: string, input?: unknown): void {
    this.infos.push({ message, input });
  }

  warn(message: string, input?: unknown): void {
    this.warns.push({ message, input });
  }

  error(message: string, input?: unknown): void {
    this.errors.push({ message, input });
  }
}

class FakeScheduler {
  nowMs = 0;
  readonly timeouts: Array<Readonly<{ delayMs: number; fn: () => void }>> = [];
  readonly intervals: Array<Readonly<{ intervalMs: number; fn: () => void }>> = [];

  now(): number {
    return this.nowMs;
  }

  setTimeout(fn: () => void, delayMs: number): unknown {
    const record = { delayMs, fn };
    this.timeouts.push(record);
    return record;
  }

  clearTimeout(handle: unknown): void {
    const idx = this.timeouts.indexOf(handle as { delayMs: number; fn: () => void });
    if (idx >= 0) {
      this.timeouts.splice(idx, 1);
    }
  }

  setInterval(fn: () => void, intervalMs: number): unknown {
    const record = { intervalMs, fn };
    this.intervals.push(record);
    return record;
  }

  clearInterval(handle: unknown): void {
    const idx = this.intervals.indexOf(handle as { intervalMs: number; fn: () => void });
    if (idx >= 0) {
      this.intervals.splice(idx, 1);
    }
  }
}

class FakeSocket implements UpbitRealtimeSocket {
  readyState: number = UPBIT_SOCKET_READY_STATE.CONNECTING;
  readonly sent: string[] = [];
  private readonly openListeners: Array<() => void> = [];
  private readonly messageListeners: Array<(event: { data: unknown }) => void> = [];
  private readonly errorListeners: Array<(event: { message?: string }) => void> = [];
  private readonly closeListeners: Array<() => void> = [];

  addEventListener(type: 'open' | 'message' | 'error' | 'close', listener: unknown): void {
    if (type === 'open') {
      this.openListeners.push(listener as () => void);
      return;
    }
    if (type === 'message') {
      this.messageListeners.push(listener as (event: { data: unknown }) => void);
      return;
    }
    if (type === 'error') {
      this.errorListeners.push(listener as (event: { message?: string }) => void);
      return;
    }
    this.closeListeners.push(listener as () => void);
  }

  send(payload: string): void {
    this.sent.push(payload);
  }

  close(): void {
    this.readyState = UPBIT_SOCKET_READY_STATE.CLOSED;
    for (const listener of this.closeListeners) {
      listener();
    }
  }

  emitOpen(): void {
    this.readyState = UPBIT_SOCKET_READY_STATE.OPEN;
    for (const listener of this.openListeners) {
      listener();
    }
  }

  emitMessage(data: unknown): void {
    for (const listener of this.messageListeners) {
      listener({ data });
    }
  }

  emitError(message: string): void {
    for (const listener of this.errorListeners) {
      listener({ message });
    }
  }

  emitClose(): void {
    this.readyState = UPBIT_SOCKET_READY_STATE.CLOSED;
    for (const listener of this.closeListeners) {
      listener();
    }
  }
}

test('UpbitRealtimeConnection subscribes to the trade stream on open and forwards raw messages', async () => {
  const logger = new FakeLogger();
  const metrics = new RuntimeMetricsService();
  const scheduler = new FakeScheduler();
  const socket = new FakeSocket();
  const received: unknown[] = [];
  const states: Array<Readonly<{ connectionState: string; retryCount?: number; nextRetryInMs?: number }>> = [];
  const connection = new UpbitRealtimeConnection({
    wsUrl: 'wss://example.test/websocket',
    market: 'KRW-XRP',
    logger: logger as unknown as ConstructorParameters<typeof UpbitRealtimeConnection>[0]['logger'],
    metrics,
    getRunId: () => 'run-strat-b-0001',
    onMessage: async (raw) => {
      received.push(raw);
    },
    onStateChange: (state) => {
      states.push(state);
    },
    createWebSocket: () => socket,
    scheduler
  });

  connection.start();
  socket.emitOpen();
  socket.emitMessage('payload-1');

  assert.equal(socket.sent.length, 1);
  assert.deepEqual(JSON.parse(socket.sent[0] ?? '[]'), [
    { ticket: 'zenith-multi-KRW-XRP' },
    { type: 'trade', codes: ['KRW-XRP'], isOnlyRealtime: true }
  ]);
  assert.deepEqual(received, ['payload-1']);
  assert.equal(logger.infos.some((entry) => entry.message === 'Upbit websocket connected'), true);
  assert.equal(scheduler.intervals.length, 1);
  assert.deepEqual(states.map((state) => state.connectionState), [
    CONNECTION_STATE.RECONNECTING,
    CONNECTION_STATE.LIVE
  ]);
});

test('UpbitRealtimeConnection schedules reconnect after close and marks recovery on the next open', () => {
  const logger = new FakeLogger();
  const metrics = new RuntimeMetricsService();
  const scheduler = new FakeScheduler();
  const sockets = [new FakeSocket(), new FakeSocket()];
  let created = 0;
  const states: Array<Readonly<{ connectionState: string; retryCount?: number; nextRetryInMs?: number }>> = [];
  const connection = new UpbitRealtimeConnection({
    wsUrl: 'wss://example.test/websocket',
    market: 'KRW-XRP',
    logger: logger as unknown as ConstructorParameters<typeof UpbitRealtimeConnection>[0]['logger'],
    metrics,
    getRunId: () => 'run-strat-b-0001',
    onMessage: () => undefined,
    onStateChange: (state) => {
      states.push(state);
    },
    createWebSocket: (): UpbitRealtimeSocket => {
      const socket = sockets[created] ?? sockets[sockets.length - 1]!;
      created += 1;
      return socket;
    },
    scheduler
  });

  connection.start();
  sockets[0]?.emitClose();

  assert.equal(metrics.snapshot().upbitReconnectAttempts, 1);
  assert.equal(scheduler.timeouts.length, 1);
  assert.equal(scheduler.timeouts[0]?.delayMs, 2000);

  scheduler.nowMs = 2500;
  scheduler.timeouts[0]?.fn();
  sockets[1]?.emitOpen();

  assert.equal(metrics.snapshot().upbitReconnectRecoveries, 1);
  assert.equal(metrics.snapshot().upbitAvgRecoveryMs, 2500);
  assert.equal(logger.warns.some((entry) => entry.message === 'Scheduled Upbit websocket reconnect'), true);
  assert.equal(states.some((state) => (
    state.connectionState === CONNECTION_STATE.RECONNECTING &&
    state.retryCount === 1 &&
    state.nextRetryInMs === 2000
  )), true);
  assert.equal(states.at(-1)?.connectionState, CONNECTION_STATE.LIVE);
});

test('UpbitRealtimeConnection stop prevents reconnect scheduling on owned close', () => {
  const logger = new FakeLogger();
  const metrics = new RuntimeMetricsService();
  const scheduler = new FakeScheduler();
  const socket = new FakeSocket();
  const states: Array<Readonly<{ connectionState: string; retryCount?: number; nextRetryInMs?: number }>> = [];
  const connection = new UpbitRealtimeConnection({
    wsUrl: 'wss://example.test/websocket',
    market: 'KRW-XRP',
    logger: logger as unknown as ConstructorParameters<typeof UpbitRealtimeConnection>[0]['logger'],
    metrics,
    getRunId: () => 'run-strat-b-0001',
    onMessage: () => undefined,
    onStateChange: (state) => {
      states.push(state);
    },
    createWebSocket: () => socket,
    scheduler
  });

  connection.start();
  connection.stop();

  assert.equal(scheduler.timeouts.length, 0);
  assert.equal(metrics.snapshot().upbitReconnectAttempts, 0);
  assert.equal(states.at(-1)?.connectionState, CONNECTION_STATE.PAUSED);
});

test('UpbitRealtimeConnection escalates reconnect status to PAUSED after repeated reconnect attempts', () => {
  const logger = new FakeLogger();
  const metrics = new RuntimeMetricsService();
  const scheduler = new FakeScheduler();
  const sockets = [new FakeSocket(), new FakeSocket(), new FakeSocket(), new FakeSocket()];
  let created = 0;
  const states: Array<Readonly<{ connectionState: string; retryCount?: number; nextRetryInMs?: number }>> = [];
  const connection = new UpbitRealtimeConnection({
    wsUrl: 'wss://example.test/websocket',
    market: 'KRW-XRP',
    logger: logger as unknown as ConstructorParameters<typeof UpbitRealtimeConnection>[0]['logger'],
    metrics,
    getRunId: () => 'run-strat-b-0001',
    onMessage: () => undefined,
    onStateChange: (state) => {
      states.push(state);
    },
    createWebSocket: (): UpbitRealtimeSocket => {
      const socket = sockets[created] ?? sockets[sockets.length - 1]!;
      created += 1;
      return socket;
    },
    scheduler
  });

  connection.start();
  sockets[0]?.emitClose();
  scheduler.timeouts[0]?.fn();
  sockets[1]?.emitClose();
  scheduler.timeouts[0]?.fn();
  sockets[2]?.emitClose();

  assert.equal(states.at(-1)?.connectionState, CONNECTION_STATE.PAUSED);
  assert.equal(states.at(-1)?.retryCount, 3);
  assert.equal(metrics.snapshot().upbitReconnectAttempts, 3);
});
