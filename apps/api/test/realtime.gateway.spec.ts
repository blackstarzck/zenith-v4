import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WsEventEnvelopeDto } from '@zenith/contracts';
import { RuntimeMetricsService } from '../src/modules/observability/runtime-metrics.service';
import { SequenceGuardService } from '../src/modules/resilience/idempotency/sequence-guard';
import { RunsService } from '../src/modules/runs/runs.service';
import { RealtimeGateway } from '../src/modules/ws/gateways/realtime.gateway';
import { RunEventPersistenceBuffer } from '../src/modules/ws/gateways/run-event-persistence-buffer';

class FakeLogger {
  info(): void {}
  warn(): void {}
  error(): void {}
}

class FakeScheduler {
  readonly timeouts: Array<Readonly<{ delayMs: number; fn: () => void }>> = [];

  setTimeout(fn: () => void, delayMs: number): unknown {
    const handle = { delayMs, fn };
    this.timeouts.push(handle);
    return handle;
  }

  clearTimeout(handle: unknown): void {
    const idx = this.timeouts.indexOf(handle as { delayMs: number; fn: () => void });
    if (idx >= 0) {
      this.timeouts.splice(idx, 1);
    }
  }
}

test('RealtimeGateway emits PAUSE when runConfig mismatch block is enabled', async () => {
  const previous = process.env.RUNCONFIG_MISMATCH_BLOCK;
  process.env.RUNCONFIG_MISMATCH_BLOCK = 'true';

  try {
    const inserted: WsEventEnvelopeDto[] = [];
    const logger = new FakeLogger();
    const metrics = new RuntimeMetricsService();
    const sequenceGuard = new SequenceGuardService(logger as unknown as ConstructorParameters<typeof SequenceGuardService>[0]);
    const runsService = new RunsService({} as ConstructorParameters<typeof RunsService>[0]);
    const db = {
      safeInsertRunEvent: async (event: WsEventEnvelopeDto) => {
        inserted.push(event);
        return { ok: true } as const;
      }
    };
    const gateway = new RealtimeGateway(
      logger as unknown as ConstructorParameters<typeof RealtimeGateway>[0],
      metrics,
      db as unknown as ConstructorParameters<typeof RealtimeGateway>[2],
      sequenceGuard,
      runsService
    );

    runsService.seedRun('run-strat-a-0001', {
      strategyId: 'STRAT_A',
      strategyVersion: 'v1',
      mode: 'PAPER',
      market: 'KRW-XRP'
    });

    const event: WsEventEnvelopeDto = {
      runId: 'run-mismatch',
      seq: 1,
      traceId: 'trace-1',
      eventType: 'SIGNAL_EMIT',
      eventTs: new Date().toISOString(),
      payload: {
        strategyId: 'STRAT_A',
        strategyVersion: 'v2',
        market: 'KRW-BTC'
      }
    };

    await gateway.ingestEngineEvent(event);

    const run = await runsService.getRun('run-strat-a-0001');
    assert.equal(run?.events.length, 1);
    assert.equal(run?.events[0]?.eventType, 'PAUSE');
    assert.equal(run?.events[0]?.payload.blockedEventType, 'SIGNAL_EMIT');
    assert.equal(inserted.length, 1);
    assert.equal(inserted[0]?.eventType, 'PAUSE');
  } finally {
    if (typeof previous === 'string') {
      process.env.RUNCONFIG_MISMATCH_BLOCK = previous;
    } else {
      delete process.env.RUNCONFIG_MISMATCH_BLOCK;
    }
  }
});

test('RealtimeGateway buffers failed DB writes and flushes queued events in order after recovery', async () => {
  const inserted: WsEventEnvelopeDto[] = [];
  const emitted: WsEventEnvelopeDto[] = [];
  const logger = new FakeLogger();
  const metrics = new RuntimeMetricsService();
  const sequenceGuard = new SequenceGuardService(logger as unknown as ConstructorParameters<typeof SequenceGuardService>[0]);
  const runsService = new RunsService({
    listRuns: async () => [],
    getRun: async () => undefined,
    listRunEvents: async () => [],
    getLatestRunEventByType: async () => undefined,
    updateRunShell: async () => undefined,
    listAllStrategyFillEvents: async () => []
  } as unknown as ConstructorParameters<typeof RunsService>[0]);

  let shouldFail = true;
  const db = {
    safeInsertRunEvent: async (event: WsEventEnvelopeDto) => {
      if (shouldFail) {
        shouldFail = false;
        return { ok: false, reason: 'write_failed' } as const;
      }
      inserted.push(event);
      return { ok: true } as const;
    }
  };

  const gateway = new RealtimeGateway(
    logger as unknown as ConstructorParameters<typeof RealtimeGateway>[0],
    metrics,
    db as unknown as ConstructorParameters<typeof RealtimeGateway>[2],
    sequenceGuard,
    runsService
  );
  const scheduler = new FakeScheduler();
  (gateway as unknown as {
    persistenceBuffer: RunEventPersistenceBuffer;
    server: Readonly<{ emit: (channel: string, event: WsEventEnvelopeDto) => void }>;
  }).persistenceBuffer = new RunEventPersistenceBuffer({
    persist: (event) => db.safeInsertRunEvent(event),
    publish: (event) => {
      emitted.push(event);
    },
    logger: logger as unknown as ConstructorParameters<typeof RunEventPersistenceBuffer>[0]['logger'],
    metrics,
    runsService,
    scheduler
  });
  (gateway as unknown as {
    server: Readonly<{ emit: (channel: string, event: WsEventEnvelopeDto) => void }>;
  }).server = {
    emit: (_channel, event) => {
      emitted.push(event);
    }
  };

  const event1: WsEventEnvelopeDto = {
    runId: 'runtime-run-1',
    seq: 1,
    traceId: 'trace-1',
    eventType: 'SIGNAL_EMIT',
    eventTs: new Date().toISOString(),
    payload: {
      strategyId: 'STRAT_B',
      strategyVersion: 'v1',
      market: 'KRW-XRP'
    }
  };
  const event2: WsEventEnvelopeDto = {
    ...event1,
    seq: 2,
    traceId: 'trace-2'
  };

  await gateway.ingestEngineEvent(event1);
  await gateway.ingestEngineEvent(event2);

  const delayedRun = await runsService.getRun('run-strat-b-0001');
  assert.equal(delayedRun?.realtimeStatus?.connectionState, 'DELAYED');
  assert.equal(delayedRun?.realtimeStatus?.queueDepth, 2);
  assert.equal(delayedRun?.realtimeStatus?.retryCount, 1);
  assert.equal(scheduler.timeouts.length, 1);
  assert.equal(emitted.length, 0);

  scheduler.timeouts[0]?.fn();
  await new Promise<void>((resolve) => setImmediate(resolve));

  const recoveredRun = await runsService.getRun('run-strat-b-0001');
  assert.deepEqual(inserted.map((event) => event.seq), [1, 2]);
  assert.deepEqual(emitted.map((event) => event.seq), [1, 2]);
  assert.equal(recoveredRun?.realtimeStatus?.queueDepth, undefined);
  assert.equal(metrics.snapshot().dbWriteFailures, 1);
});

test('RealtimeGateway drops duplicate seq while still accepting out-of-order events', async () => {
  const inserted: WsEventEnvelopeDto[] = [];
  const logger = new FakeLogger();
  const metrics = new RuntimeMetricsService();
  const sequenceGuard = new SequenceGuardService(logger as unknown as ConstructorParameters<typeof SequenceGuardService>[0]);
  const runsService = new RunsService({
    listRuns: async () => [],
    getRun: async () => undefined,
    listRunEvents: async () => [],
    getLatestRunEventByType: async () => undefined,
    updateRunShell: async () => undefined,
    listAllStrategyFillEvents: async () => []
  } as unknown as ConstructorParameters<typeof RunsService>[0]);
  const db = {
    safeInsertRunEvent: async (event: WsEventEnvelopeDto) => {
      inserted.push(event);
      return { ok: true } as const;
    }
  };
  const gateway = new RealtimeGateway(
    logger as unknown as ConstructorParameters<typeof RealtimeGateway>[0],
    metrics,
    db as unknown as ConstructorParameters<typeof RealtimeGateway>[2],
    sequenceGuard,
    runsService
  );

  const baseEvent: WsEventEnvelopeDto = {
    runId: 'runtime-run-2',
    seq: 2,
    traceId: 'trace-2',
    eventType: 'MARKET_TICK',
    eventTs: new Date().toISOString(),
    payload: {
      strategyId: 'STRAT_B',
      strategyVersion: 'v1',
      market: 'KRW-XRP',
      candle: { time: 120, open: 1, high: 1, low: 1, close: 1 }
    }
  };

  await gateway.ingestEngineEvent(baseEvent);
  await gateway.ingestEngineEvent(baseEvent);
  await gateway.ingestEngineEvent({
    ...baseEvent,
    seq: 1,
    traceId: 'trace-1'
  });

  assert.deepEqual(inserted.map((event) => event.seq), [2, 1]);
});
