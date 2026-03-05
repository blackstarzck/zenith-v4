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

  const pendingState = {
    ...state,
    stratA: { pendingConfirmAt: 30 }
  };
  const confirm = evaluateStrategyCandle(cfg.strategyId, pendingState, {
    time: 31,
    open: 99.9,
    high: 100.4,
    low: 99.85,
    close: 100.25
  }, cfg.momentum);
  assert.equal(confirm.decisions.some((d) => d.eventType === 'ORDER_INTENT'), true);
});

test('STRAT_B requires stronger range+close confirmation', () => {
  const cfg = resolveStrategyConfig('STRAT_B');
  const weak = evaluateStrategyCandle(cfg.strategyId, INITIAL_MOMENTUM_STATE, {
    time: 1,
    open: 100,
    high: 100.12,
    low: 99.95,
    close: 100.05
  }, cfg.momentum);
  assert.equal(weak.decisions.length, 0);

  const impulse = evaluateStrategyCandle(cfg.strategyId, weak.nextState, {
    time: 2,
    open: 100.0,
    high: 100.55,
    low: 99.95,
    close: 100.45
  }, cfg.momentum);

  const strong = evaluateStrategyCandle(cfg.strategyId, impulse.nextState, {
    time: 3,
    open: 100,
    high: 100.52,
    low: 100.1,
    close: 100.4
  }, cfg.momentum);
  assert.equal(strong.decisions.length > 0, true);
});

test('STRAT_C breakout threshold is strict', () => {
  const cfg = resolveStrategyConfig('STRAT_C');
  let state = INITIAL_MOMENTUM_STATE;
  for (let i = 0; i < 20; i += 1) {
    const r = evaluateStrategyCandle(cfg.strategyId, state, {
      time: i + 1,
      open: 100,
      high: 100.15,
      low: 99.9,
      close: 100.02
    }, cfg.momentum);
    state = r.nextState;
  }

  const low = evaluateStrategyCandle(cfg.strategyId, state, {
    time: 21,
    open: 100.1,
    high: 100.18,
    low: 100.0,
    close: 100.13
  }, cfg.momentum);
  assert.equal(low.decisions.length, 0);

  const high = evaluateStrategyCandle(cfg.strategyId, low.nextState, {
    time: 22,
    open: 100.1,
    high: 100.55,
    low: 100.05,
    close: 100.48
  }, cfg.momentum);
  assert.equal(high.decisions[0]?.eventType, 'SIGNAL_EMIT');
});
