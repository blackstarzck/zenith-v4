import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildExitSequence,
  buildLongEntrySequence,
  buildSemiAutoApprovalSequence
} from '../src/modules/execution/engine/execution-sequence';

test('buildLongEntrySequence returns the canonical entry order', () => {
  const sequence = buildLongEntrySequence({
    price: 101.25,
    qty: 12.5,
    notionalKrw: 1265.63,
    orderReason: 'A_CONFIRM_NEXT_BAR'
  });

  assert.deepEqual(sequence.map((decision) => decision.eventType), [
    'SIGNAL_EMIT',
    'ORDER_INTENT',
    'FILL',
    'POSITION_UPDATE'
  ]);
  assert.equal(sequence[1]?.payload.qty, 12.5);
  assert.equal(sequence[1]?.payload.notionalKrw, 1265.63);
});

test('buildExitSequence returns the canonical exit order', () => {
  const sequence = buildExitSequence({
    price: 102.5,
    orderReason: 'EXIT_TP',
    exitPayload: {
      reason: 'TP',
      pnlPct: 1.2,
      barsHeld: 3
    }
  });

  assert.deepEqual(sequence.map((decision) => decision.eventType), [
    'EXIT',
    'ORDER_INTENT',
    'FILL',
    'POSITION_UPDATE'
  ]);
});

test('buildSemiAutoApprovalSequence preserves signal then approval order', () => {
  const sequence = buildSemiAutoApprovalSequence({
    suggestedPrice: 2027,
    signalPayload: {
      signal: 'LONG_ENTRY',
      reason: 'B_POI_TOUCH_CONFIRM'
    }
  });

  assert.deepEqual(sequence.map((decision) => decision.eventType), [
    'SIGNAL_EMIT',
    'APPROVE_ENTER'
  ]);
});
