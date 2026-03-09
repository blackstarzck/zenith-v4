import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeEntryOrderSizing } from '../src/common/trading-risk';
import { type RuntimeCandle } from '../src/modules/execution/engine/realtime-candle-state';
import { StrategyRuntimeProcessor } from '../src/modules/execution/engine/strategy-runtime-processor';
import { createStrategyRuntimeState } from '../src/modules/execution/engine/strategy-runtime-state';

type CapturedEvent = Readonly<{
  strategyId: string;
  eventType: string;
  eventTsMs: number;
  candle: RuntimeCandle;
  payload: Readonly<Record<string, unknown>>;
}>;

function createProcessor(
  captured: CapturedEvent[],
  overrides?: Partial<ConstructorParameters<typeof StrategyRuntimeProcessor>[0]>
): StrategyRuntimeProcessor {
  return new StrategyRuntimeProcessor({
    mode: 'PAPER',
    allowLiveTrading: false,
    e2eForceSemiAutoSignal: false,
    riskConfig: {
      dailyLossLimitPct: -2,
      maxConsecutiveLosses: 3,
      maxDailyOrders: 200,
      killSwitchEnabled: true
    },
    consumeApproval: () => false,
    resolveAccountBaseKrw: async (runtime) => runtime.riskSnapshot.seedKrw,
    emitStrategyEvent: async (runtime, eventType, eventTsMs, candle, payload) => {
      captured.push({
        strategyId: runtime.strategyId,
        eventType,
        eventTsMs,
        candle,
        payload
      });
    },
    ...overrides
  });
}

function createStratBReadyRuntime() {
  const runtime = createStrategyRuntimeState('STRAT_B', 'v1');
  runtime.strategyState = {
    ...runtime.strategyState,
    candles1h: [
      { time: 1, open: 100, high: 101, low: 99.8, close: 100.8 },
      { time: 2, open: 100.8, high: 101.4, low: 100.5, close: 101.1 },
      { time: 3, open: 101.1, high: 101.8, low: 100.9, close: 101.6 },
      { time: 4, open: 101.6, high: 102.1, low: 101.2, close: 101.9 },
      { time: 5, open: 101.9, high: 102.4, low: 101.6, close: 102.2 }
    ],
    stratB: {
      stage: 'WAIT_CONFIRM',
      bullMode: true,
      activeZone: {
        zoneLow: 100.2,
        zoneHigh: 100.7,
        obLow: 99.9,
        obHigh: 100.8,
        targetPrice: 102.8,
        createdAt: 20,
        expiresAt: 60,
        sourceTime: 19,
        trendLineSlope: 0.05,
        trendLineBase: 99.8,
        bullModeAtCreation: true
      }
    }
  };
  return runtime;
}

test('StrategyRuntimeProcessor emits readiness on close for non-executable STRAT_B setups', async () => {
  const captured: CapturedEvent[] = [];
  const processor = createProcessor(captured);
  const runtime = createStrategyRuntimeState('STRAT_B', 'v1');
  runtime.strategyState = {
    ...runtime.strategyState,
    candles1h: [
      { time: 1, open: 100, high: 101, low: 99.8, close: 100.8 },
      { time: 2, open: 100.8, high: 101.4, low: 100.5, close: 101.1 },
      { time: 3, open: 101.1, high: 101.8, low: 100.9, close: 101.6 }
    ],
    stratB: {
      stage: 'WAIT_POI',
      bullMode: true
    }
  };

  await processor.processClosedCandle(runtime, {
    time: 21,
    open: 100.5,
    high: 100.65,
    low: 100.4,
    close: 100.5,
    volume: 1
  }, 21_000, '15m');

  const readiness = captured.filter((event) => event.eventType === 'ENTRY_READINESS').at(-1);
  assert.ok(readiness);
  assert.equal(typeof readiness?.payload.entryReadinessPct, 'number');
  assert.equal(readiness?.payload.entryReady, false);
});

test('StrategyRuntimeProcessor emits semi-auto approved entry in the shared execution order', async () => {
  const captured: CapturedEvent[] = [];
  const processor = createProcessor(captured, {
    mode: 'SEMI_AUTO'
  });
  const runtime = createStrategyRuntimeState('STRAT_B', 'v1');
  runtime.pendingSemiAutoEntry = {
    signalTime: 22,
    suggestedPrice: 2027
  };

  await processor.emitSemiAutoApprovedEntry(runtime, {
    time: 23,
    open: 2027,
    high: 2032,
    low: 2021,
    close: 2025,
    volume: 1
  }, 23_000);

  assert.deepEqual(captured.map((event) => event.eventType), [
    'ORDER_INTENT',
    'FILL',
    'POSITION_UPDATE'
  ]);
  const expectedSizing = computeEntryOrderSizing({
    accountBaseKrw: runtime.riskSnapshot.seedKrw,
    maxPositionRatio: runtime.riskSnapshot.maxPositionRatio,
    price: 2027
  });
  assert.ok(expectedSizing);
  assert.equal(captured[0]?.payload.qty, expectedSizing?.qty);
  assert.equal(captured[1]?.payload.notionalKrw, expectedSizing?.notionalKrw);
  assert.equal(runtime.strategyState.inPosition, true);
  assert.equal(runtime.pendingSemiAutoEntry, undefined);
});

test('StrategyRuntimeProcessor moves SEMI_AUTO runtime into WAITING_APPROVAL on STRAT_B entry signal', async () => {
  const captured: CapturedEvent[] = [];
  const processor = createProcessor(captured, {
    mode: 'SEMI_AUTO'
  });
  const runtime = createStratBReadyRuntime();

  await processor.processClosedCandle(runtime, {
    time: 22,
    open: 100.4,
    high: 100.85,
    low: 100.35,
    close: 100.78,
    volume: 1
  }, 22_000, '15m');

  assert.deepEqual(captured.map((event) => event.eventType), [
    'SIGNAL_EMIT',
    'APPROVE_ENTER',
    'ENTRY_READINESS'
  ]);
  assert.equal(runtime.lifecycleState, 'WAITING_APPROVAL');
  assert.equal(runtime.pendingSemiAutoEntry?.suggestedPrice, 100.78);
});

test('StrategyRuntimeProcessor does not spam duplicate readiness while STRAT_B waits for approval on the same candle', async () => {
  const captured: CapturedEvent[] = [];
  const processor = createProcessor(captured, {
    mode: 'SEMI_AUTO'
  });
  const runtime = createStratBReadyRuntime();

  await processor.processClosedCandle(runtime, {
    time: 22,
    open: 100.4,
    high: 100.85,
    low: 100.35,
    close: 100.78,
    volume: 1
  }, 22_000, '15m');

  const readinessCountAfterSignal = captured.filter((event) => event.eventType === 'ENTRY_READINESS').length;

  await processor.processTradeTick(runtime, {
    market: 'KRW-XRP',
    price: 100.79,
    volume: 0.5,
    tsMs: 22_500
  }, {
    time: 22,
    open: 100.4,
    high: 100.85,
    low: 100.35,
    close: 100.79,
    volume: 1.5
  }, 22_500);

  const readinessEvents = captured.filter((event) => event.eventType === 'ENTRY_READINESS');
  assert.equal(runtime.lifecycleState, 'WAITING_APPROVAL');
  assert.equal(readinessCountAfterSignal, 1);
  assert.equal(readinessEvents.length, 1);
  assert.equal(readinessEvents[0]?.payload.reason, 'AWAITING_APPROVAL');
});

test('StrategyRuntimeProcessor emits one new readiness snapshot when STRAT_B approval wait advances to the next candle', async () => {
  const captured: CapturedEvent[] = [];
  const processor = createProcessor(captured, {
    mode: 'SEMI_AUTO'
  });
  const runtime = createStratBReadyRuntime();

  await processor.processClosedCandle(runtime, {
    time: 22,
    open: 100.4,
    high: 100.85,
    low: 100.35,
    close: 100.78,
    volume: 1
  }, 22_000, '15m');

  await processor.processCandleOpen(runtime, {
    time: 23,
    open: 100.8,
    high: 100.9,
    low: 100.7,
    close: 100.82,
    volume: 0
  }, 23_000, '1m');

  const readinessEvents = captured.filter((event) => event.eventType === 'ENTRY_READINESS');
  assert.equal(readinessEvents.length, 2);
  assert.equal(readinessEvents[0]?.candle.time, 22);
  assert.equal(readinessEvents[1]?.candle.time, 23);
  assert.equal(readinessEvents[1]?.payload.reason, 'AWAITING_APPROVAL');
});

test('StrategyRuntimeProcessor can force a deterministic STRAT_B SEMI_AUTO approval request for E2E', async () => {
  const captured: CapturedEvent[] = [];
  const processor = createProcessor(captured, {
    mode: 'SEMI_AUTO',
    e2eForceSemiAutoSignal: true
  });
  const runtime = createStrategyRuntimeState('STRAT_B', 'v1');

  await processor.processCandleOpen(runtime, {
    time: 31,
    open: 100.2,
    high: 100.4,
    low: 100.1,
    close: 100.3,
    volume: 1
  }, 31_000, '1m');

  assert.deepEqual(captured.map((event) => event.eventType), [
    'SIGNAL_EMIT',
    'APPROVE_ENTER',
    'ENTRY_READINESS'
  ]);
  assert.equal(captured[0]?.payload.reason, 'E2E_FORCE_SEMI_AUTO_SIGNAL');
  assert.equal(captured[0]?.payload.forced, true);
  assert.equal(runtime.lifecycleState, 'WAITING_APPROVAL');
  assert.equal(runtime.pendingSemiAutoEntry?.suggestedPrice, 100.2);
});

test('StrategyRuntimeProcessor sizes direct PAPER entries from risk snapshot for STRAT_B', async () => {
  const captured: CapturedEvent[] = [];
  const processor = createProcessor(captured);
  const runtime = createStratBReadyRuntime();

  await processor.processClosedCandle(runtime, {
    time: 22,
    open: 100.4,
    high: 100.85,
    low: 100.35,
    close: 100.78,
    volume: 1
  }, 22_000, '15m');

  const fillEvent = captured.find((event) => event.eventType === 'FILL');
  const expectedSizing = computeEntryOrderSizing({
    accountBaseKrw: runtime.riskSnapshot.seedKrw,
    maxPositionRatio: runtime.riskSnapshot.maxPositionRatio,
    price: 100.78
  });
  assert.ok(fillEvent);
  assert.ok(expectedSizing);
  assert.equal(fillEvent?.payload.qty, expectedSizing?.qty);
  assert.equal(fillEvent?.payload.notionalKrw, expectedSizing?.notionalKrw);
  assert.equal(runtime.strategyState.positionQty, expectedSizing?.qty);
});
