import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WsEventEnvelopeDto } from '@zenith/contracts';
import { RuntimeMetricsService } from '../src/modules/observability/runtime-metrics.service';
import { evaluateStrategyCandleDetailed } from '../src/modules/execution/engine/strategy-evaluator';
import { resolveStrategyConfig } from '../src/modules/execution/engine/strategy-config';
import { UpbitRealtimeEngine } from '../src/modules/execution/engine/upbit-realtime-engine';
import { INITIAL_MOMENTUM_STATE } from '../src/modules/execution/engine/simple-momentum.strategy';

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

function createEngineWithCapturedEvents(
  captured: WsEventEnvelopeDto[],
  logger = new FakeLogger()
): Readonly<{ engine: UpbitRealtimeEngine; logger: FakeLogger }> {
  const metrics = new RuntimeMetricsService();
  const gateway = {
    ingestEngineEvent: async (event: WsEventEnvelopeDto) => {
      captured.push(event);
    }
  };

  return {
    engine: new UpbitRealtimeEngine(
      gateway as unknown as ConstructorParameters<typeof UpbitRealtimeEngine>[0],
      logger as unknown as ConstructorParameters<typeof UpbitRealtimeEngine>[1],
      metrics,
      {
        consumeApproval: () => false,
        setSnapshotDelay: () => undefined,
        setTransportState: () => undefined
      } as unknown as ConstructorParameters<typeof UpbitRealtimeEngine>[3],
      {} as ConstructorParameters<typeof UpbitRealtimeEngine>[4]
    ),
    logger
  };
}

test('UpbitRealtimeEngine keeps STRAT_B entry readiness on the original candle evaluation', async () => {
  const captured: WsEventEnvelopeDto[] = [];
  const { engine } = createEngineWithCapturedEvents(captured);
  const cfg = resolveStrategyConfig('STRAT_B');
  const runtime = (engine as unknown as {
    runtimeByStrategy: Record<'STRAT_A' | 'STRAT_B' | 'STRAT_C', {
      strategyState: typeof INITIAL_MOMENTUM_STATE;
    }>;
    processClosedCandleForStrategy: (
      runtimeState: unknown,
      candle: Readonly<{ time: number; open: number; high: number; low: number; close: number }>,
      eventTsMs: number
    ) => Promise<void>;
  }).runtimeByStrategy.STRAT_B;

  runtime.strategyState = {
    ...INITIAL_MOMENTUM_STATE,
    recentCandles: Array.from({ length: 20 }, (_, index) => ({
      time: index + 1,
      open: 100,
      high: 100.15,
      low: 99.95,
      close: 100.03
    }))
  };
  const impulseCandle = {
    time: 21,
    open: 100.0,
    high: 100.8,
    low: 99.95,
    close: 100.7
  };
  const expectedImpulse = evaluateStrategyCandleDetailed(cfg.strategyId, runtime.strategyState, impulseCandle, cfg.momentum);

  await (engine as unknown as {
    processClosedCandleForStrategy: (
      runtimeState: unknown,
      candle: Readonly<{ time: number; open: number; high: number; low: number; close: number }>,
      eventTsMs: number
    ) => Promise<void>;
  }).processClosedCandleForStrategy(runtime, impulseCandle, 21_000);

  const impulseReadiness = captured.filter((event) => event.eventType === 'ENTRY_READINESS').at(-1);
  assert.equal(impulseReadiness?.payload.entryReadinessPct, expectedImpulse.readiness.entryReadinessPct);
  assert.equal(impulseReadiness?.payload.entryReady, expectedImpulse.readiness.entryReady);

  await (engine as unknown as {
    processClosedCandleForStrategy: (
      runtimeState: unknown,
      candle: Readonly<{ time: number; open: number; high: number; low: number; close: number }>,
      eventTsMs: number
    ) => Promise<void>;
  }).processClosedCandleForStrategy(runtime, {
    time: 22,
    open: 100.6,
    high: 100.72,
    low: 100.3,
    close: 100.4
  }, 22_000);

  const pullbackReadiness = captured.filter((event) => event.eventType === 'ENTRY_READINESS').at(-1);
  assert.equal(pullbackReadiness?.payload.entryReadinessPct, 85);
  assert.equal(pullbackReadiness?.payload.entryReady, false);
});

test('UpbitRealtimeEngine hydrates runtime candle history from RunsService', async () => {
  const logger = new FakeLogger();
  const metrics = new RuntimeMetricsService();
  const engine = new UpbitRealtimeEngine(
    { ingestEngineEvent: async () => undefined } as unknown as ConstructorParameters<typeof UpbitRealtimeEngine>[0],
    logger as unknown as ConstructorParameters<typeof UpbitRealtimeEngine>[1],
    metrics,
    {
      getCandles: async () => ([
        { time: 1, open: 100, high: 101, low: 99, close: 100.5 },
        { time: 2, open: 100.5, high: 101.2, low: 100.4, close: 101.1 }
      ])
    } as unknown as ConstructorParameters<typeof UpbitRealtimeEngine>[3],
    {} as ConstructorParameters<typeof UpbitRealtimeEngine>[4]
  );

  const runtime = (engine as unknown as {
    runtimeByStrategy: Record<'STRAT_A' | 'STRAT_B' | 'STRAT_C', {
      strategyState: typeof INITIAL_MOMENTUM_STATE;
    }>;
    hydrateRuntimeRecentCandles: (runtimeState: unknown) => Promise<void>;
  }).runtimeByStrategy.STRAT_B;

  await (engine as unknown as {
    hydrateRuntimeRecentCandles: (runtimeState: unknown) => Promise<void>;
  }).hydrateRuntimeRecentCandles(runtime);

  assert.equal(runtime.strategyState.recentCandles.length, 2);
  assert.equal(runtime.strategyState.recentCandles[1]?.close, 101.1);
});

test('UpbitRealtimeEngine aligns snapshot candle time to the candle start minute', async () => {
  const captured: WsEventEnvelopeDto[] = [];
  const { engine } = createEngineWithCapturedEvents(captured);

  await (engine as unknown as {
    emitSnapshotCandle: (candle: {
      candle_date_time_utc: string;
      opening_price: number;
      high_price: number;
      low_price: number;
      trade_price: number;
      candle_acc_trade_volume?: number;
      timestamp: number;
    }) => Promise<void>;
  }).emitSnapshotCandle({
    candle_date_time_utc: '2026-03-07T13:08:00',
    opening_price: 2015,
    high_price: 2015,
    low_price: 2014,
    trade_price: 2014,
    candle_acc_trade_volume: 3469.63378075,
    timestamp: 1772888934713
  });

  const snapshotTick = captured.find((event) => event.eventType === 'MARKET_TICK');
  const snapshotPayload = snapshotTick?.payload as Readonly<{
    candle: Readonly<{ time: number; close: number }>;
  }> | undefined;
  assert.equal(snapshotTick?.eventTs, '2026-03-07T13:08:00.000Z');
  assert.equal(snapshotPayload?.candle.time, 1772888880);
  assert.equal(snapshotPayload?.candle.close, 2014);
});

test('UpbitRealtimeEngine emits semi-auto approved entry in the shared execution order', async () => {
  const captured: WsEventEnvelopeDto[] = [];
  const { engine } = createEngineWithCapturedEvents(captured);
  const runtime = (engine as unknown as {
    runtimeByStrategy: Record<'STRAT_A' | 'STRAT_B' | 'STRAT_C', {
      pendingSemiAutoEntry?: Readonly<{ signalTime: number; suggestedPrice: number }>;
      strategyState: typeof INITIAL_MOMENTUM_STATE;
    }>;
    emitSemiAutoApprovedEntry: (
      runtimeState: unknown,
      candle: Readonly<{ time: number; open: number; high: number; low: number; close: number }>,
      eventTsMs: number
    ) => Promise<void>;
  }).runtimeByStrategy.STRAT_B;

  runtime.pendingSemiAutoEntry = {
    signalTime: 22,
    suggestedPrice: 2027
  };

  await (engine as unknown as {
    emitSemiAutoApprovedEntry: (
      runtimeState: unknown,
      candle: Readonly<{ time: number; open: number; high: number; low: number; close: number }>,
      eventTsMs: number
    ) => Promise<void>;
  }).emitSemiAutoApprovedEntry(runtime, {
    time: 23,
    open: 2027,
    high: 2032,
    low: 2021,
    close: 2025
  }, 23_000);

  assert.deepEqual(captured.map((event) => event.eventType), [
    'ORDER_INTENT',
    'FILL',
    'POSITION_UPDATE'
  ]);
  assert.equal(runtime.strategyState.inPosition, true);
  assert.equal(runtime.strategyState.entryPrice, 2027);
  assert.equal(runtime.pendingSemiAutoEntry, undefined);
});

test('UpbitRealtimeEngine ignores stale snapshot candles after live candle state advanced', async () => {
  const captured: WsEventEnvelopeDto[] = [];
  const logger = new FakeLogger();
  const { engine } = createEngineWithCapturedEvents(captured, logger);

  (engine as unknown as {
    candleState: Readonly<{ bucketMs: number; open: number; high: number; low: number; close: number; volume: number }>;
  }).candleState = {
    bucketMs: Date.parse('2026-03-07T13:20:00.000Z'),
    open: 2017,
    high: 2018,
    low: 2017,
    close: 2018,
    volume: 100
  };

  await (engine as unknown as {
    emitSnapshotCandle: (candle: {
      candle_date_time_utc: string;
      opening_price: number;
      high_price: number;
      low_price: number;
      trade_price: number;
      candle_acc_trade_volume?: number;
      timestamp: number;
    }) => Promise<void>;
  }).emitSnapshotCandle({
    candle_date_time_utc: '2026-03-07T13:08:00',
    opening_price: 2015,
    high_price: 2015,
    low_price: 2014,
    trade_price: 2014,
    candle_acc_trade_volume: 3469.63378075,
    timestamp: 1772888934713
  });

  assert.equal(captured.length, 0);
  assert.equal(logger.warns.length, 1);
});

test('UpbitRealtimeEngine skips stale closed candle produced by corrupted internal state', async () => {
  const captured: WsEventEnvelopeDto[] = [];
  const logger = new FakeLogger();
  const { engine } = createEngineWithCapturedEvents(captured, logger);

  (engine as unknown as {
    candleState: Readonly<{ bucketMs: number; open: number; high: number; low: number; close: number; volume: number }>;
  }).candleState = {
    bucketMs: Date.parse('2026-03-07T11:00:00.000Z'),
    open: 2024,
    high: 2024,
    low: 2021,
    close: 2021,
    volume: 10
  };

  await (engine as unknown as {
    handleUpbitMessage: (raw: unknown) => Promise<void>;
  }).handleUpbitMessage(JSON.stringify({
    code: 'KRW-XRP',
    trade_price: 2014,
    trade_volume: 1.25,
    trade_timestamp: Date.parse('2026-03-07T13:08:39.533Z')
  }));

  const marketTicks = captured.filter((event) => event.eventType === 'MARKET_TICK');
  const readiness = captured.filter((event) => event.eventType === 'ENTRY_READINESS');
  assert.equal(marketTicks.length, 3);
  assert.equal(readiness.length, 0);
  assert.equal(logger.warns.length, 1);
});

test('UpbitRealtimeEngine clears snapshot delay after the first recovered live trade', async () => {
  const captured: WsEventEnvelopeDto[] = [];
  const logger = new FakeLogger();
  const snapshotDelayCalls: Array<Readonly<{ runId: string; delayed: boolean }>> = [];
  const metrics = new RuntimeMetricsService();
  const engine = new UpbitRealtimeEngine(
    {
      ingestEngineEvent: async (event: WsEventEnvelopeDto) => {
        captured.push(event);
      }
    } as unknown as ConstructorParameters<typeof UpbitRealtimeEngine>[0],
    logger as unknown as ConstructorParameters<typeof UpbitRealtimeEngine>[1],
    metrics,
    {
      consumeApproval: () => false,
      setSnapshotDelay: (runId: string, delayed: boolean) => {
        snapshotDelayCalls.push({ runId, delayed });
      },
      setTransportState: () => undefined
    } as unknown as ConstructorParameters<typeof UpbitRealtimeEngine>[3],
    {} as ConstructorParameters<typeof UpbitRealtimeEngine>[4]
  );

  (engine as unknown as { snapshotRecoveryPending: boolean }).snapshotRecoveryPending = true;

  await (engine as unknown as {
    handleUpbitMessage: (raw: unknown) => Promise<void>;
  }).handleUpbitMessage(JSON.stringify({
    code: 'KRW-XRP',
    trade_price: 2014,
    trade_volume: 1.25,
    trade_timestamp: Date.parse('2026-03-07T13:08:39.533Z')
  }));

  assert.equal((engine as unknown as { snapshotRecoveryPending: boolean }).snapshotRecoveryPending, false);
  assert.deepEqual(snapshotDelayCalls.map((item) => item.delayed), [false, false, false]);
  assert.equal(captured.filter((event) => event.eventType === 'MARKET_TICK').length, 3);
  assert.equal(logger.infos.some((entry) => entry.message === 'Runtime snapshot delay cleared by live trade recovery'), true);
});
