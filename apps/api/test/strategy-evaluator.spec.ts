import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateStrategyCandle } from '../src/modules/execution/engine/strategy-evaluator';
import { INITIAL_MOMENTUM_STATE } from '../src/modules/execution/engine/simple-momentum.strategy';
import { resolveStrategyConfig } from '../src/modules/execution/engine/strategy-config';

test('STRAT_A enters on mean-reversion style candle', () => {
  const cfg = resolveStrategyConfig('STRAT_A');
  let state = INITIAL_MOMENTUM_STATE;
  for (let i = 0; i < 20; i += 1) {
    const r = evaluateStrategyCandle(cfg.strategyId, state, {
      time: i + 1,
      open: 100 + i * 0.01,
      high: 100.2 + i * 0.01,
      low: 99.9 + i * 0.01,
      close: 100.05 + i * 0.01
    }, cfg.momentum);
    state = r.nextState;
  }

  const pendingState = { ...state, stratA: { pendingConfirmAt: 30 } };
  const confirm = evaluateStrategyCandle(cfg.strategyId, pendingState, {
    time: 31,
    open: 99.9,
    high: 100.4,
    low: 99.85,
    close: 100.25
  }, cfg.momentum);
  assert.equal(confirm.decisions.some((d) => d.eventType === 'ORDER_INTENT'), true);
});

test('STRAT_A blocks excluded entry hour (KST 13시)', () => {
  const cfg = resolveStrategyConfig('STRAT_A');
  const pendingState = {
    ...INITIAL_MOMENTUM_STATE,
    recentCandles: Array.from({ length: 30 }, (_, i) => ({
      time: i + 1,
      open: 100,
      high: 100.2,
      low: 99.8,
      close: 100.05
    })),
    stratA: { pendingConfirmAt: 100 }
  };
  const kst13 = 1741147200; // 2025-03-05T04:00:00Z => KST 13:00
  const out = evaluateStrategyCandle(cfg.strategyId, pendingState, {
    time: kst13,
    open: 100,
    high: 100.3,
    low: 99.9,
    close: 100.2
  }, cfg.momentum);
  assert.equal(out.decisions.length, 0);
});

test('STRAT_B creates POI from impulse then enters on touch+bullish', () => {
  const cfg = resolveStrategyConfig('STRAT_B');
  let state = INITIAL_MOMENTUM_STATE;
  for (let i = 0; i < 20; i += 1) {
    const out = evaluateStrategyCandle(cfg.strategyId, state, {
      time: i + 1,
      open: 100,
      high: 100.15,
      low: 99.95,
      close: 100.03
    }, cfg.momentum);
    state = out.nextState;
  }

  const impulse = evaluateStrategyCandle(cfg.strategyId, state, {
    time: 21,
    open: 100.0,
    high: 100.8,
    low: 99.95,
    close: 100.7
  }, cfg.momentum);

  const strong = evaluateStrategyCandle(cfg.strategyId, impulse.nextState, {
    time: 22,
    open: 100.5,
    high: 100.72,
    low: 100.0,
    close: 100.65
  }, cfg.momentum);
  assert.equal(strong.decisions.length > 0, true);
});

test('STRAT_B POI expires by validBars', () => {
  const cfg = resolveStrategyConfig('STRAT_B');
  const seeded = {
    ...INITIAL_MOMENTUM_STATE,
    recentCandles: [
      { time: 1, open: 100, high: 100.6, low: 99.9, close: 100.5 },
      { time: 2, open: 100.5, high: 100.7, low: 100.2, close: 100.3 }
    ],
    stratB: { poiLow: 100.1, poiHigh: 100.6, poiExpiresAt: 10 }
  };
  const expired = evaluateStrategyCandle(cfg.strategyId, seeded, {
    time: 11,
    open: 100.2,
    high: 100.6,
    low: 100.1,
    close: 100.5
  }, cfg.momentum);
  assert.equal(expired.decisions.length, 0);
});

test('STRAT_C breakout+value spike+ratio filters trigger entry', () => {
  const cfg = resolveStrategyConfig('STRAT_C');
  let state = INITIAL_MOMENTUM_STATE;
  for (let i = 0; i < 40; i += 1) {
    const r = evaluateStrategyCandle(cfg.strategyId, state, {
      time: 1741165200 + i * 60, // KST 10시대 포함
      open: 100 + i * 0.01,
      high: 100.2 + i * 0.01,
      low: 99.95 + i * 0.01,
      close: 100.05 + i * 0.01
    }, cfg.momentum);
    state = r.nextState;
  }

  const out = evaluateStrategyCandle(cfg.strategyId, state, {
    time: 1741138800,
    open: 101.0,
    high: 102.0,
    low: 100.95,
    close: 101.95
  }, cfg.momentum);
  assert.equal(out.decisions[0]?.eventType, 'SIGNAL_EMIT');
});

test('STRAT_C blocks entry outside allowed KST hours', () => {
  const cfg = resolveStrategyConfig('STRAT_C');
  const seeded = {
    ...INITIAL_MOMENTUM_STATE,
    recentCandles: Array.from({ length: 40 }, (_, i) => ({
      time: 1741140000 + i * 60,
      open: 100 + i * 0.01,
      high: 100.3 + i * 0.01,
      low: 99.9 + i * 0.01,
      close: 100.1 + i * 0.01
    }))
  };
  const out = evaluateStrategyCandle(cfg.strategyId, seeded, {
    time: 1741129200, // KST 00시
    open: 101,
    high: 102,
    low: 100.9,
    close: 101.9
  }, cfg.momentum);
  assert.equal(out.decisions.length, 0);
});
