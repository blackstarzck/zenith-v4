import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveStrategyConfig } from '../src/modules/execution/engine/strategy-config';

test('resolveStrategyConfig resolves STRAT_A/B/C and falls back to STRAT_B', () => {
  assert.equal(resolveStrategyConfig('STRAT_A').strategyId, 'STRAT_A');
  assert.equal(resolveStrategyConfig('STRAT_B').strategyId, 'STRAT_B');
  assert.equal(resolveStrategyConfig('STRAT_C').strategyId, 'STRAT_C');
  assert.equal(resolveStrategyConfig('unknown').strategyId, 'STRAT_B');
  assert.equal(resolveStrategyConfig(undefined).strategyId, 'STRAT_B');
});
