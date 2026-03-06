import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WsEventEnvelopeDto } from '@zenith/contracts';
import { RunsService } from '../src/modules/runs/runs.service';

test('RunsService returns run history and run detail', () => {
  const svc = new RunsService();
  svc.seedRun('run-1');

  const event: WsEventEnvelopeDto = {
    runId: 'run-1',
    seq: 1,
    traceId: 'trace-1',
    eventType: 'SIGNAL_EMIT',
    eventTs: new Date().toISOString(),
    payload: { ok: true }
  };

  svc.ingestEvent(event);

  const history = svc.listRuns();
  assert.equal(history.length, 1);
  assert.equal(history[0]?.runId, 'run-1');

  const run = svc.getRun('run-1');
  assert.ok(run);
  assert.equal(run?.events.length, 1);
});

test('RunsService builds export artifacts', () => {
  const svc = new RunsService();

  const fills: WsEventEnvelopeDto[] = [
    {
      runId: 'run-2',
      seq: 1,
      traceId: 'trace-1',
      eventType: 'FILL',
      eventTs: new Date().toISOString(),
      payload: { px: 100 }
    },
    {
      runId: 'run-2',
      seq: 2,
      traceId: 'trace-2',
      eventType: 'FILL',
      eventTs: new Date().toISOString(),
      payload: { px: 101 }
    }
  ];

  fills.forEach((e) => svc.ingestEvent(e));

  const jsonl = svc.getEventsJsonl('run-2');
  const csv = svc.getTradesCsv('run-2');

  assert.ok(jsonl?.includes('"eventType":"FILL"'));
  assert.ok(csv?.startsWith('tradeId,entryTime,exitReason,netReturnPct,seq'));
});

test('RunsService returns candle snapshot from market tick events', () => {
  const svc = new RunsService();

  const events: WsEventEnvelopeDto[] = [
    {
      runId: 'run-3',
      seq: 1,
      traceId: 'trace-1',
      eventType: 'MARKET_TICK',
      eventTs: new Date().toISOString(),
      payload: {
        candle: { time: 100, open: 1, high: 3, low: 1, close: 2 }
      }
    },
    {
      runId: 'run-3',
      seq: 2,
      traceId: 'trace-2',
      eventType: 'MARKET_TICK',
      eventTs: new Date().toISOString(),
      payload: {
        candle: { time: 100, open: 1, high: 4, low: 1, close: 3 }
      }
    },
    {
      runId: 'run-3',
      seq: 3,
      traceId: 'trace-3',
      eventType: 'MARKET_TICK',
      eventTs: new Date().toISOString(),
      payload: {
        candle: { time: 160, open: 3, high: 5, low: 2, close: 4 }
      }
    }
  ];

  events.forEach((event) => svc.ingestEvent(event));

  const candles = svc.getCandles('run-3', 300);
  assert.equal(candles?.length, 2);
  assert.deepEqual(candles?.[0], { time: 100, open: 1, high: 4, low: 1, close: 3 });
  assert.deepEqual(candles?.[1], { time: 160, open: 3, high: 5, low: 2, close: 4 });
});

test('RunsService computes KPI from EXIT pnl events', () => {
  const svc = new RunsService();
  svc.seedRun('run-kpi');

  const events: WsEventEnvelopeDto[] = [
    {
      runId: 'run-kpi',
      seq: 1,
      traceId: 't1',
      eventType: 'FILL',
      eventTs: new Date().toISOString(),
      payload: { side: 'BUY', fillPrice: 100 }
    },
    {
      runId: 'run-kpi',
      seq: 2,
      traceId: 't2',
      eventType: 'EXIT',
      eventTs: new Date().toISOString(),
      payload: { reason: 'TP', pnlPct: 1.2 }
    },
    {
      runId: 'run-kpi',
      seq: 3,
      traceId: 't3',
      eventType: 'EXIT',
      eventTs: new Date().toISOString(),
      payload: { reason: 'SL', pnlPct: -0.7 }
    }
  ];
  events.forEach((event) => svc.ingestEvent(event));

  const run = svc.getRun('run-kpi');
  assert.equal(run?.kpi.trades, 1);
  assert.equal(run?.kpi.exits, 2);
  assert.equal(run?.kpi.winRate, 50);
  assert.equal(run?.kpi.sumReturnPct, 0.5);
  assert.equal(run?.kpi.mddPct, -0.7);
  assert.equal(run?.kpi.profitFactor, 1.7143);
  assert.equal(run?.kpi.avgWinPct, 1.2);
  assert.equal(run?.kpi.avgLossPct, -0.7);
});

test('RunsService ignores legacy fill events without side/fillPrice in trade counts', () => {
  const svc = new RunsService();
  svc.seedRun('run-legacy-fill');

  const events: WsEventEnvelopeDto[] = [
    {
      runId: 'run-legacy-fill',
      seq: 1,
      traceId: 'legacy-fill',
      eventType: 'FILL',
      eventTs: new Date().toISOString(),
      payload: { message: 'simulated event #1' }
    },
    {
      runId: 'run-legacy-fill',
      seq: 2,
      traceId: 'real-fill',
      eventType: 'FILL',
      eventTs: new Date().toISOString(),
      payload: { side: 'BUY', fillPrice: 100 }
    }
  ];

  events.forEach((event) => svc.ingestEvent(event));

  const run = svc.getRun('run-legacy-fill');
  const csv = svc.getTradesCsv('run-legacy-fill');

  assert.equal(run?.kpi.trades, 1);
  assert.ok(csv?.includes('T-0001'));
  assert.ok(!csv?.includes('T-0002'));
});

test('RunsService updates run control fields', () => {
  const svc = new RunsService();
  svc.seedRun('run-ctl', { strategyId: 'STRAT_A', mode: 'PAPER', market: 'KRW-XRP' });

  const updated = svc.updateRunControl('run-ctl', {
    strategyId: 'STRAT_C',
    strategyVersion: 'v2',
    mode: 'AUTO',
    market: 'KRW-BTC',
    fillModelRequested: 'NEXT_OPEN',
    fillModelApplied: 'ON_CLOSE',
    entryPolicy: 'CUSTOM'
  });

  assert.equal(updated?.strategyId, 'STRAT_C');
  assert.equal(updated?.strategyVersion, 'v2');
  assert.equal(updated?.mode, 'AUTO');
  assert.equal(updated?.market, 'KRW-BTC');
  assert.equal(updated?.fillModelRequested, 'NEXT_OPEN');
  assert.equal(updated?.fillModelApplied, 'ON_CLOSE');
  assert.equal(updated?.entryPolicy, 'CUSTOM');

  const config = svc.getRunConfig('run-ctl');
  assert.equal(config?.strategyId, 'STRAT_C');
  assert.equal(config?.strategyVersion, 'v2');
  assert.equal(config?.mode, 'AUTO');
  assert.equal(config?.market, 'KRW-BTC');
});

test('RunsService filters run history by strategy/mode/market', () => {
  const svc = new RunsService();
  svc.seedRun('run-a-paper', { strategyId: 'STRAT_A', strategyVersion: 'v1', mode: 'PAPER', market: 'KRW-BTC' });
  svc.seedRun('run-a-auto', { strategyId: 'STRAT_A', strategyVersion: 'v2', mode: 'AUTO', market: 'KRW-XRP' });
  svc.seedRun('run-b-paper', { strategyId: 'STRAT_B', strategyVersion: 'v2', mode: 'PAPER', market: 'KRW-XRP' });

  const byStrategy = svc.listRuns({ strategyId: 'STRAT_A' });
  assert.equal(byStrategy.length, 2);

  const byMode = svc.listRuns({ mode: 'PAPER' });
  assert.equal(byMode.length, 2);

  const byMarket = svc.listRuns({ market: 'KRW-XRP' });
  assert.equal(byMarket.length, 2);

  const byVersion = svc.listRuns({ strategyVersion: 'v2' });
  assert.equal(byVersion.length, 2);

  const composite = svc.listRuns({ strategyId: 'STRAT_A', mode: 'AUTO', market: 'KRW-XRP' });
  assert.equal(composite.length, 1);
  assert.equal(composite[0]?.runId, 'run-a-auto');
});

test('RunsService validates event payload against runConfig snapshot', () => {
  const svc = new RunsService();
  svc.seedRun('run-match', { strategyId: 'STRAT_B', strategyVersion: 'v1', mode: 'PAPER', market: 'KRW-XRP' });

  const mismatched: WsEventEnvelopeDto = {
    runId: 'run-match',
    seq: 1,
    traceId: 'trace-mismatch',
    eventType: 'SIGNAL_EMIT',
    eventTs: new Date().toISOString(),
    payload: { strategyId: 'STRAT_A', strategyVersion: 'v3', market: 'KRW-BTC' }
  };

  const mismatches = svc.validateEventAgainstRunConfig(mismatched);
  assert.equal(mismatches.length, 3);
  assert.deepEqual(mismatches[0], { field: 'strategyId', expected: 'STRAT_B', actual: 'STRAT_A' });
  assert.deepEqual(mismatches[1], { field: 'strategyVersion', expected: 'v1', actual: 'v3' });
  assert.deepEqual(mismatches[2], { field: 'market', expected: 'KRW-XRP', actual: 'KRW-BTC' });
});

test('RunsService approve token can be queued and consumed once', () => {
  const svc = new RunsService();
  svc.seedRun('run-approve');

  const approved = svc.approvePendingEntry('run-approve');
  const consumedFirst = svc.consumeApproval('run-approve');
  const consumedSecond = svc.consumeApproval('run-approve');

  assert.equal(approved, true);
  assert.equal(consumedFirst, true);
  assert.equal(consumedSecond, false);
});
