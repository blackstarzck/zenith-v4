import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateEntryBlock, initialRiskState, onEntryAccepted, onExitPnl } from '../src/modules/execution/engine/risk-guard';

const cfg = {
  dailyLossLimitPct: -2,
  maxConsecutiveLosses: 3,
  maxDailyOrders: 2,
  killSwitchEnabled: true
} as const;

test('risk guard blocks LIVE when allowLiveTrading is false', () => {
  const base = initialRiskState(Date.parse('2026-03-05T00:00:00.000Z'));
  const result = evaluateEntryBlock(base, cfg, 'LIVE', false, Date.parse('2026-03-05T01:00:00.000Z'));
  assert.equal(result.reason, 'LIVE_GUARD_BLOCKED');
});

test('risk guard blocks by daily order limit', () => {
  let state = initialRiskState(Date.parse('2026-03-05T00:00:00.000Z'));
  state = onEntryAccepted(state, Date.parse('2026-03-05T01:00:00.000Z'));
  state = onEntryAccepted(state, Date.parse('2026-03-05T02:00:00.000Z'));
  const result = evaluateEntryBlock(state, cfg, 'AUTO', true, Date.parse('2026-03-05T03:00:00.000Z'));
  assert.equal(result.reason, 'MAX_DAILY_ORDERS');
});

test('risk guard blocks by consecutive losses and resets on win', () => {
  let state = initialRiskState(Date.parse('2026-03-05T00:00:00.000Z'));
  state = onExitPnl(state, -0.5, Date.parse('2026-03-05T01:00:00.000Z'));
  state = onExitPnl(state, -0.4, Date.parse('2026-03-05T02:00:00.000Z'));
  state = onExitPnl(state, -0.3, Date.parse('2026-03-05T03:00:00.000Z'));
  const blocked = evaluateEntryBlock(state, cfg, 'AUTO', true, Date.parse('2026-03-05T03:10:00.000Z'));
  assert.equal(blocked.reason, 'MAX_CONSECUTIVE_LOSSES');

  const recovered = onExitPnl(state, 0.2, Date.parse('2026-03-05T03:20:00.000Z'));
  const allowed = evaluateEntryBlock(recovered, cfg, 'AUTO', true, Date.parse('2026-03-05T03:30:00.000Z'));
  assert.equal(allowed.reason, undefined);
});

test('risk guard blocks by daily loss limit', () => {
  let state = initialRiskState(Date.parse('2026-03-05T00:00:00.000Z'));
  state = onExitPnl(state, -1.1, Date.parse('2026-03-05T01:00:00.000Z'));
  state = onExitPnl(state, -1.0, Date.parse('2026-03-05T02:00:00.000Z'));
  const result = evaluateEntryBlock(state, cfg, 'AUTO', true, Date.parse('2026-03-05T03:00:00.000Z'));
  assert.equal(result.reason, 'DAILY_LOSS_LIMIT');
});
