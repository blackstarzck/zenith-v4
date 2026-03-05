import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  evaluateMomentumCandle,
  INITIAL_MOMENTUM_STATE,
  type MomentumState
} from '../src/modules/execution/engine/simple-momentum.strategy';

test('momentum strategy emits entry events on strong bullish candle', () => {
  const result = evaluateMomentumCandle(INITIAL_MOMENTUM_STATE, {
    time: 1,
    open: 100,
    high: 101,
    low: 99,
    close: 100.3
  });

  assert.equal(result.nextState.inPosition, true);
  assert.equal(result.decisions.length, 4);
  assert.equal(result.decisions[0]?.eventType, 'SIGNAL_EMIT');
  assert.equal(result.decisions[1]?.eventType, 'ORDER_INTENT');
  assert.equal(result.decisions[2]?.eventType, 'FILL');
  assert.equal(result.decisions[3]?.eventType, 'POSITION_UPDATE');
});

test('momentum strategy emits exit events on take profit', () => {
  const state: MomentumState = {
    inPosition: true,
    entryPrice: 100,
    entryTime: 1,
    barsHeld: 1,
    recentCandles: []
  };

  const result = evaluateMomentumCandle(state, {
    time: 2,
    open: 100,
    high: 101,
    low: 99.8,
    close: 100.4
  });

  assert.equal(result.nextState.inPosition, false);
  assert.equal(result.decisions.length, 4);
  assert.equal(result.decisions[0]?.eventType, 'EXIT');
  assert.equal(result.decisions[1]?.eventType, 'ORDER_INTENT');
  assert.equal(result.decisions[2]?.eventType, 'FILL');
  assert.equal(result.decisions[3]?.eventType, 'POSITION_UPDATE');
});
