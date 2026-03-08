import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { transitionStrategyRuntimeMode } from '../src/modules/execution/engine/strategy-runtime-mode-machine';
import type { StrategyRuntimeMode } from '../src/modules/execution/engine/strategy-runtime-state';

test('mode machine requests approval for SEMI_AUTO entry signals', () => {
  const transition = transitionStrategyRuntimeMode({
    mode: 'SEMI_AUTO',
    currentState: 'FLAT',
    trigger: {
      type: 'STRATEGY_ENTRY_SIGNAL'
    }
  });

  assert.deepEqual(transition, {
    action: 'REQUEST_SEMI_AUTO_APPROVAL',
    nextState: 'WAITING_APPROVAL',
    reason: 'ENTRY_SIGNAL_REQUIRES_APPROVAL'
  });
});

test('mode machine keeps waiting when approval is not yet consumed', () => {
  const transition = transitionStrategyRuntimeMode({
    mode: 'SEMI_AUTO',
    currentState: 'WAITING_APPROVAL',
    trigger: {
      type: 'APPROVAL_TICK',
      approvalConsumed: false
    }
  });

  assert.deepEqual(transition, {
    action: 'EMIT_AWAITING_APPROVAL',
    nextState: 'WAITING_APPROVAL',
    reason: 'AWAITING_APPROVAL'
  });
});

test('mode machine executes approved entry after approval consumption', () => {
  const transition = transitionStrategyRuntimeMode({
    mode: 'SEMI_AUTO',
    currentState: 'WAITING_APPROVAL',
    trigger: {
      type: 'APPROVAL_TICK',
      approvalConsumed: true
    }
  });

  assert.deepEqual(transition, {
    action: 'EXECUTE_APPROVED_ENTRY',
    nextState: 'IN_POSITION',
    reason: 'APPROVAL_CONSUMED'
  });
});

test('mode machine routes PAPER/AUTO/LIVE entry intents to direct execution', () => {
  for (const mode of ['PAPER', 'AUTO', 'LIVE'] as const satisfies readonly StrategyRuntimeMode[]) {
    const transition = transitionStrategyRuntimeMode({
      mode,
      currentState: 'FLAT',
      trigger: {
        type: 'ENTRY_INTENT_READY'
      }
    });

    assert.equal(transition.action, 'PROCESS_DIRECT_ENTRY');
    assert.equal(transition.nextState, 'IN_POSITION');
    assert.equal(transition.reason, `${mode}_DIRECT_ENTRY`);
  }
});
