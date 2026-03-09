import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WsEventEnvelopeDto } from '@zenith/contracts';
import {
  buildControlConstraintNote,
  deriveEntryPolicy,
  extractStrategyOverlayLevels,
  getAllowedAppliedFillModels,
  getAllowedModes,
  getAllowedRequestedFillModels,
  normalizeAllowedValue
} from '@zenith/contracts';

function createEvent(
  seq: number,
  eventTs: string,
  payload: Readonly<Record<string, unknown>>
): WsEventEnvelopeDto {
  return {
    runId: 'run-test-1',
    seq,
    traceId: `trace-${seq}`,
    eventType: 'SIGNAL_EMIT',
    eventTs,
    payload
  };
}

test('run control rules constrain strategy modes and fill models', () => {
  assert.deepEqual(getAllowedModes('STRAT_A'), ['PAPER', 'AUTO', 'LIVE']);
  assert.deepEqual(getAllowedModes('STRAT_B'), ['PAPER', 'SEMI_AUTO', 'AUTO', 'LIVE']);
  assert.deepEqual(getAllowedModes('STRAT_C'), ['PAPER', 'AUTO', 'LIVE']);

  assert.deepEqual(getAllowedRequestedFillModels('STRAT_A', 'AUTO'), ['AUTO', 'NEXT_OPEN', 'ON_CLOSE']);
  assert.deepEqual(getAllowedRequestedFillModels('STRAT_B', 'SEMI_AUTO'), ['AUTO', 'NEXT_OPEN']);
  assert.deepEqual(getAllowedRequestedFillModels('STRAT_C', 'AUTO'), ['AUTO', 'NEXT_MINUTE_OPEN']);

  assert.deepEqual(getAllowedAppliedFillModels('STRAT_A', 'AUTO'), ['NEXT_OPEN', 'ON_CLOSE']);
  assert.deepEqual(getAllowedAppliedFillModels('STRAT_B', 'SEMI_AUTO'), ['NEXT_OPEN']);
  assert.deepEqual(getAllowedAppliedFillModels('STRAT_C', 'AUTO'), ['NEXT_MINUTE_OPEN']);
});

test('run control rules normalize invalid selections and derive entry policies', () => {
  assert.equal(normalizeAllowedValue('SEMI_AUTO', getAllowedModes('STRAT_A')), 'PAPER');
  assert.equal(normalizeAllowedValue('ON_CLOSE', getAllowedAppliedFillModels('STRAT_B', 'SEMI_AUTO')), 'NEXT_OPEN');

  assert.equal(deriveEntryPolicy('STRAT_A', 'AUTO', 'ON_CLOSE'), 'A_CONFIRM_ON_CLOSE');
  assert.equal(deriveEntryPolicy('STRAT_B', 'SEMI_AUTO', 'NEXT_OPEN'), 'B_SEMI_AUTO_NEXT_OPEN_AFTER_APPROVAL');
  assert.equal(deriveEntryPolicy('STRAT_B', 'AUTO', 'ON_CLOSE'), 'B_POI_TOUCH_CONFIRM_ON_CLOSE');
  assert.equal(deriveEntryPolicy('STRAT_C', 'AUTO', 'NEXT_MINUTE_OPEN'), 'C_NEXT_MINUTE_OPEN');

  assert.equal(
    buildControlConstraintNote('STRAT_B', 'SEMI_AUTO'),
    'STRAT_B SEMI_AUTO는 승인 후 NEXT_OPEN만 허용합니다.'
  );
});

test('overlay extraction prefers the latest numeric payload values per strategy', () => {
  const stratB = extractStrategyOverlayLevels('STRAT_B', [
    createEvent(1, '2026-03-08T00:00:00.000Z', { zoneHigh: 101, zoneLow: 97, targetPrice: 110 }),
    createEvent(2, '2026-03-08T00:01:00.000Z', { zoneLow: 98 }),
    createEvent(3, '2026-03-08T00:02:00.000Z', { targetPrice: 112 })
  ]);
  assert.deepEqual(stratB, {
    zoneHigh: 101,
    zoneLow: 98,
    targetPrice: 112
  });

  const stratC = extractStrategyOverlayLevels('STRAT_C', [
    createEvent(4, '2026-03-08T00:03:00.000Z', { lastBreakoutLevel: 502 }),
    createEvent(5, '2026-03-08T00:04:00.000Z', { breakoutLevel: 505 })
  ]);
  assert.deepEqual(stratC, {
    breakoutLevel: 505
  });
});
