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
});

test('RunsService updates run control fields', () => {
  const svc = new RunsService();
  svc.seedRun('run-ctl', { strategyId: 'STRAT_A', mode: 'PAPER', market: 'KRW-XRP' });

  const updated = svc.updateRunControl('run-ctl', {
    strategyId: 'STRAT_C',
    mode: 'AUTO',
    market: 'KRW-BTC',
    fillModelRequested: 'NEXT_OPEN',
    fillModelApplied: 'ON_CLOSE',
    entryPolicy: 'CUSTOM'
  });

  assert.equal(updated?.strategyId, 'STRAT_C');
  assert.equal(updated?.mode, 'AUTO');
  assert.equal(updated?.market, 'KRW-BTC');
  assert.equal(updated?.fillModelRequested, 'NEXT_OPEN');
  assert.equal(updated?.fillModelApplied, 'ON_CLOSE');
  assert.equal(updated?.entryPolicy, 'CUSTOM');
});
