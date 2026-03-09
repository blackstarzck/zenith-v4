import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  evaluateStrategyCandleDetailed,
  evaluateStrategyEntryReadiness,
  evaluateStrategyEventDetailed
} from '../src/modules/execution/engine/strategy-evaluator';
import { INITIAL_MOMENTUM_STATE } from '../src/modules/execution/engine/simple-momentum.strategy';
import { resolveStrategyConfig } from '../src/modules/execution/engine/strategy-config';

test('STRAT_A moves from trigger to confirm wait and enters on the next 15m open', () => {
  const cfg = resolveStrategyConfig('STRAT_A');
  let state = INITIAL_MOMENTUM_STATE;
  for (let i = 0; i < 40; i += 1) {
    const base = 100 + ((i % 2 === 0) ? 0.02 : -0.02);
    state = evaluateStrategyCandleDetailed(cfg.strategyId, state, {
      time: (i + 1) * 900,
      open: base,
      high: base + 0.15,
      low: base - 0.15,
      close: base + ((i % 3 === 0) ? 0.03 : -0.01)
    }, cfg.momentum, '15m').result.nextState;
  }

  const trigger = evaluateStrategyCandleDetailed(cfg.strategyId, state, {
    time: 41 * 900,
    open: 99.8,
    high: 100.4,
    low: 99.6,
    close: 100.3
  }, cfg.momentum, '15m');
  assert.equal(trigger.result.nextState.stratA?.stage, 'WAIT_CONFIRM');

  const confirmClose = evaluateStrategyCandleDetailed(cfg.strategyId, trigger.result.nextState, {
    time: 42 * 900,
    open: 100.1,
    high: 100.5,
    low: 100.0,
    close: 100.35
  }, cfg.momentum, '15m');
  assert.equal(confirmClose.result.nextState.stratA?.stage, 'WAIT_ENTRY');

  const entryOpen = evaluateStrategyEventDetailed(cfg.strategyId, confirmClose.result.nextState, {
    type: 'CANDLE_OPEN',
    timeframe: '15m',
    candle: {
      time: 43 * 900,
      open: 100.36,
      high: 100.36,
      low: 100.36,
      close: 100.36
    }
  }, cfg.momentum);
  assert.deepEqual(entryOpen.result.decisions.map((decision) => decision.eventType), [
    'SIGNAL_EMIT',
    'ORDER_INTENT',
    'FILL',
    'POSITION_UPDATE'
  ]);
  assert.equal(entryOpen.result.nextState.inPosition, true);
});

test('STRAT_A blocks excluded entry hour', () => {
  const cfg = resolveStrategyConfig('STRAT_A');
  const seeded = {
    ...INITIAL_MOMENTUM_STATE,
    candles15m: Array.from({ length: 30 }, (_, index) => ({
      time: 1741113600 + (index * 900),
      open: 100,
      high: 100.2,
      low: 99.8,
      close: 100.05
    }))
  };
  const out = evaluateStrategyCandleDetailed(cfg.strategyId, seeded, {
    time: 1741146300, // next 15m open resolves to KST 13
    open: 100,
    high: 100.3,
    low: 99.2,
    close: 100.15
  }, cfg.momentum, '15m');
  assert.equal(out.result.decisions.length, 0);
});

test('STRAT_B enters only when bull mode and active zone confirmation are present', () => {
  const cfg = resolveStrategyConfig('STRAT_B');
  const seeded = {
    ...INITIAL_MOMENTUM_STATE,
    candles1h: [
      { time: 1, open: 100, high: 101, low: 99.8, close: 100.8 },
      { time: 2, open: 100.8, high: 101.4, low: 100.5, close: 101.1 },
      { time: 3, open: 101.1, high: 101.8, low: 100.9, close: 101.6 },
      { time: 4, open: 101.6, high: 102.1, low: 101.2, close: 101.9 },
      { time: 5, open: 101.9, high: 102.4, low: 101.6, close: 102.2 }
    ],
    stratB: {
      stage: 'WAIT_CONFIRM' as const,
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

  const strong = evaluateStrategyCandleDetailed(cfg.strategyId, seeded, {
    time: 30,
    open: 100.4,
    high: 100.85,
    low: 100.35,
    close: 100.78
  }, cfg.momentum, '15m');
  assert.equal(strong.result.nextState.inPosition, true);
  assert.deepEqual(strong.result.decisions.map((decision) => decision.eventType), [
    'SIGNAL_EMIT',
    'ORDER_INTENT',
    'FILL',
    'POSITION_UPDATE'
  ]);
});

test('STRAT_B expires a stale zone and stays flat', () => {
  const cfg = resolveStrategyConfig('STRAT_B');
  const seeded = {
    ...INITIAL_MOMENTUM_STATE,
    stratB: {
      stage: 'WAIT_CONFIRM' as const,
      bullMode: true,
      activeZone: {
        zoneLow: 100.1,
        zoneHigh: 100.6,
        obLow: 99.9,
        obHigh: 100.7,
        targetPrice: 102,
        createdAt: 1,
        expiresAt: 10,
        sourceTime: 1,
        trendLineSlope: 0.02,
        trendLineBase: 99.9,
        bullModeAtCreation: true
      }
    }
  };
  const expired = evaluateStrategyCandleDetailed(cfg.strategyId, seeded, {
    time: 11,
    open: 100.2,
    high: 100.6,
    low: 100.1,
    close: 100.5
  }, cfg.momentum, '15m');
  assert.equal(expired.result.decisions.length, 0);
  assert.equal(expired.result.nextState.stratB?.activeZone, undefined);
});

test('STRAT_C schedules next-minute entry when breakout, trade value, and buy ratio align', () => {
  const cfg = resolveStrategyConfig('STRAT_C');
  const base = 1741122000;
  const recentCandles = Array.from({ length: 40 }, (_, index) => ({
    time: base - ((40 - index) * 60),
    open: 100 + (index * 0.01),
    high: 100.2 + (index * 0.01),
    low: 99.95 + (index * 0.01),
    close: 100.05 + (index * 0.01),
    tradeValue: 100_000 + (index * 1000),
    buyValue: 60_000 + (index * 800),
    buyRatio: 0.6
  }));
  const seeded = {
    ...INITIAL_MOMENTUM_STATE,
    recentCandles
  };

  const signal = evaluateStrategyCandleDetailed(cfg.strategyId, seeded, {
    time: base,
    open: 101.0,
    high: 102.0,
    low: 100.95,
    close: 101.95,
    tradeValue: 500_000,
    buyValue: 375_000,
    buyRatio: 0.75
  }, cfg.momentum, '1m');

  assert.equal(signal.result.nextState.stratC?.stage, 'ENTRY_PENDING');
  assert.equal(signal.result.decisions[0]?.eventType, 'SIGNAL_EMIT');

  const entry = evaluateStrategyEventDetailed(cfg.strategyId, signal.result.nextState, {
    type: 'CANDLE_OPEN',
    timeframe: '1m',
    candle: {
      time: base + 60,
      open: 102.0,
      high: 102.0,
      low: 102.0,
      close: 102.0
    }
  }, cfg.momentum);
  assert.equal(entry.result.nextState.inPosition, true);
});

test('STRAT_C blocks entry outside allowed KST hours', () => {
  const cfg = resolveStrategyConfig('STRAT_C');
  const seeded = {
    ...INITIAL_MOMENTUM_STATE,
    recentCandles: Array.from({ length: 40 }, (_, i) => ({
      time: 1741140000 + (i * 60),
      open: 100 + (i * 0.01),
      high: 100.3 + (i * 0.01),
      low: 99.9 + (i * 0.01),
      close: 100.1 + (i * 0.01),
      tradeValue: 100_000,
      buyValue: 65_000,
      buyRatio: 0.65
    }))
  };
  const out = evaluateStrategyEntryReadiness(cfg.strategyId, seeded, {
    time: 1741129200,
    open: 101,
    high: 102,
    low: 100.9,
    close: 101.9,
    tradeValue: 500_000,
    buyValue: 450_000,
    buyRatio: 0.9
  }, cfg.momentum, '1m');
  assert.equal(out.entryReady, false);
});
