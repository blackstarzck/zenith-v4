import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeEntryOrderSizing } from '../src/common/trading-risk';
import { type RuntimeCandle } from '../src/modules/execution/engine/realtime-candle-state';
import { StrategyRuntimeProcessor } from '../src/modules/execution/engine/strategy-runtime-processor';
import { resolveStrategyConfig } from '../src/modules/execution/engine/strategy-config';
import { createStrategyRuntimeState } from '../src/modules/execution/engine/strategy-runtime-state';
import { evaluateStrategyCandleDetailed } from '../src/modules/execution/engine/strategy-evaluator';
import { INITIAL_MOMENTUM_STATE } from '../src/modules/execution/engine/simple-momentum.strategy';

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

test('StrategyRuntimeProcessor keeps STRAT_B entry readiness on the original candle evaluation', async () => {
  const captured: CapturedEvent[] = [];
  const processor = createProcessor(captured);
  const runtime = createStrategyRuntimeState('STRAT_B', 'v1');
  const cfg = resolveStrategyConfig('STRAT_B');

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

  const impulseCandle: RuntimeCandle = {
    time: 21,
    open: 100.0,
    high: 100.8,
    low: 99.95,
    close: 100.7,
    volume: 1
  };
  const expectedImpulse = evaluateStrategyCandleDetailed(cfg.strategyId, runtime.strategyState, impulseCandle, cfg.momentum);

  await processor.processClosedCandle(runtime, impulseCandle, 21_000);

  const impulseReadiness = captured.filter((event) => event.eventType === 'ENTRY_READINESS').at(-1);
  assert.equal(impulseReadiness?.payload.entryReadinessPct, expectedImpulse.readiness.entryReadinessPct);
  assert.equal(impulseReadiness?.payload.entryReady, expectedImpulse.readiness.entryReady);

  await processor.processClosedCandle(runtime, {
    time: 22,
    open: 100.6,
    high: 100.72,
    low: 100.3,
    close: 100.4,
    volume: 1
  }, 22_000);

  const pullbackReadiness = captured.filter((event) => event.eventType === 'ENTRY_READINESS').at(-1);
  assert.equal(pullbackReadiness?.payload.entryReadinessPct, 85);
  assert.equal(pullbackReadiness?.payload.entryReady, false);
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
  assert.equal(runtime.strategyState.entryPrice, 2027);
  assert.equal(runtime.strategyState.positionQty, expectedSizing?.qty);
  assert.equal(runtime.pendingSemiAutoEntry, undefined);
  assert.equal(runtime.lifecycleState, 'IN_POSITION');
});

test('StrategyRuntimeProcessor moves SEMI_AUTO runtime into WAITING_APPROVAL on entry signal', async () => {
  const captured: CapturedEvent[] = [];
  const processor = createProcessor(captured, {
    mode: 'SEMI_AUTO'
  });
  const runtime = createStrategyRuntimeState('STRAT_B', 'v1');
  const cfg = resolveStrategyConfig('STRAT_B');

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

  const impulseCandle: RuntimeCandle = {
    time: 21,
    open: 100.0,
    high: 100.8,
    low: 99.95,
    close: 100.7,
    volume: 1
  };
  const impulse = evaluateStrategyCandleDetailed(cfg.strategyId, runtime.strategyState, impulseCandle, cfg.momentum);
  runtime.strategyState = impulse.result.nextState;

  const strongCandle: RuntimeCandle = {
    time: 22,
    open: 100.5,
    high: 100.72,
    low: 100.0,
    close: 100.65,
    volume: 1
  };
  const expectedStrong = evaluateStrategyCandleDetailed(cfg.strategyId, runtime.strategyState, strongCandle, cfg.momentum);
  assert.equal(expectedStrong.result.decisions.some((decision) => decision.eventType === 'SIGNAL_EMIT'), true);

  await processor.processClosedCandle(runtime, strongCandle, 22_000);

  assert.deepEqual(captured.map((event) => event.eventType), [
    'SIGNAL_EMIT',
    'APPROVE_ENTER',
    'ENTRY_READINESS'
  ]);
  assert.equal(runtime.lifecycleState, 'WAITING_APPROVAL');
  assert.equal(runtime.pendingSemiAutoEntry?.suggestedPrice, 100.65);
  assert.equal(captured.at(-1)?.payload.reason, 'AWAITING_APPROVAL');
});

test('StrategyRuntimeProcessor sizes direct PAPER entries from risk snapshot', async () => {
  const captured: CapturedEvent[] = [];
  const processor = createProcessor(captured);
  const runtime = createStrategyRuntimeState('STRAT_B', 'v1');
  const cfg = resolveStrategyConfig('STRAT_B');

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

  await processor.processClosedCandle(runtime, {
    time: 21,
    open: 100.0,
    high: 100.8,
    low: 99.95,
    close: 100.7,
    volume: 1
  }, 21_000);

  const pullback: RuntimeCandle = {
    time: 22,
    open: 100.5,
    high: 100.72,
    low: 100.0,
    close: 100.65,
    volume: 1
  };
  const expectedEntry = evaluateStrategyCandleDetailed(cfg.strategyId, runtime.strategyState, pullback, cfg.momentum);
  assert.equal(expectedEntry.result.decisions.some((decision) => decision.eventType === 'ORDER_INTENT'), true);

  await processor.processClosedCandle(runtime, pullback, 22_000);

  const fillEvent = captured.find((event) => event.eventType === 'FILL');
  const expectedSizing = computeEntryOrderSizing({
    accountBaseKrw: runtime.riskSnapshot.seedKrw,
    maxPositionRatio: runtime.riskSnapshot.maxPositionRatio,
    price: pullback.close
  });
  assert.ok(fillEvent);
  assert.ok(expectedSizing);
  assert.equal(fillEvent?.payload.qty, expectedSizing?.qty);
  assert.equal(fillEvent?.payload.notionalKrw, expectedSizing?.notionalKrw);
  assert.equal(runtime.strategyState.positionQty, expectedSizing?.qty);
});
