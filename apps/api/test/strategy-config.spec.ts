import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveStrategyConfig } from '../src/modules/execution/engine/strategy-config';

test('resolveStrategyConfig resolves STRAT_A/B/C and falls back to STRAT_B', () => {
  const a = resolveStrategyConfig('STRAT_A');
  const b = resolveStrategyConfig('STRAT_B');
  const c = resolveStrategyConfig('STRAT_C');
  assert.equal(a.strategyId, 'STRAT_A');
  assert.equal(b.strategyId, 'STRAT_B');
  assert.equal(c.strategyId, 'STRAT_C');
  assert.equal(typeof a.momentum.stratA?.bbPeriod, 'number');
  assert.equal(typeof b.momentum.stratB?.poiValidBars, 'number');
  assert.equal(typeof c.momentum.stratC?.valueSpikeMult, 'number');
  assert.equal(resolveStrategyConfig('unknown').strategyId, 'STRAT_B');
  assert.equal(resolveStrategyConfig(undefined).strategyId, 'STRAT_B');
});
