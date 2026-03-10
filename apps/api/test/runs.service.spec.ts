import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { CONNECTION_STATE, type WsEventEnvelopeDto } from '@zenith/contracts';
import { RunsService } from '../src/modules/runs/runs.service';

function createRunsService(): RunsService {
  return new RunsService({
    listRuns: async () => [],
    getRun: async () => undefined,
    listRunEvents: async () => [],
    getLatestRunEventByType: async () => undefined,
    updateRunShell: async () => undefined,
    listAllStrategyFillEvents: async () => [],
    syncRunArtifacts: async () => undefined
  } as unknown as ConstructorParameters<typeof RunsService>[0]);
}

function createFillEvent(
  runId: string,
  seq: number,
  payload?: Readonly<Record<string, unknown>>
): WsEventEnvelopeDto {
  return {
    runId,
    seq,
    traceId: `trace-${runId}-${seq}`,
    eventType: 'FILL',
    eventTs: new Date(1_700_000_000_000 + seq * 1000).toISOString(),
    payload: {
      side: 'BUY',
      fillPrice: 100,
      qty: 1,
      ...(payload ?? {})
    }
  };
}

test('RunsService returns run history and run detail', async () => {
  const svc = createRunsService();
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

  const history = await svc.listRuns();
  assert.ok(history.length >= 1);
  assert.ok(history.some((item) => item.runId === 'run-1'));

  const run = await svc.getRun('run-1');
  assert.ok(run);
  assert.equal(run?.events.length, 1);
});

test('RunsService builds export artifacts', async () => {
  const svc = createRunsService();

  const events: WsEventEnvelopeDto[] = [
    {
      runId: 'run-2',
      seq: 1,
      traceId: 'trace-1',
      eventType: 'FILL',
      eventTs: new Date().toISOString(),
      payload: { side: 'BUY', fillPrice: 100, qty: 1 }
    },
    {
      runId: 'run-2',
      seq: 2,
      traceId: 'trace-2',
      eventType: 'EXIT',
      eventTs: new Date().toISOString(),
      payload: { reason: 'TP1', pnlPct: 1.25 }
    },
    {
      runId: 'run-2',
      seq: 3,
      traceId: 'trace-3',
      eventType: 'FILL',
      eventTs: new Date().toISOString(),
      payload: { side: 'SELL', fillPrice: 101.25, qty: 1 }
    }
  ];

  events.forEach((e) => svc.ingestEvent(e));

  const jsonl = await svc.getEventsJsonl('run-2');
  const csv = await svc.getTradesCsv('run-2');
  const report = await svc.getRunReport('run-2');

  assert.ok(jsonl?.includes('"eventType":"FILL"'));
  assert.ok(csv?.startsWith('tradeId,entryTime,exitReason,netReturnPct,seq'));
  assert.ok(csv?.includes('TP1'));
  assert.equal(report?.execution.fillModelApplied, 'ON_CLOSE');
  assert.equal(report?.results.trades.count, 1);
  assert.equal(report?.results.exitReasonBreakdown.TP1, 1);
  assert.equal(report?.artifacts.runReportJson, 'run-artifacts/run-2/run_report.json');
});

test('RunsService persists text_trades/text_run_reports when building run_report', async () => {
  let persisted:
    | Readonly<{
      runId: string;
      trades: readonly Record<string, unknown>[];
      report: Record<string, unknown>;
      runReportJson: string;
      tradesCsv: string;
      eventsJsonl: string;
    }>
    | undefined;

  const svc = new RunsService({
    listRuns: async () => [],
    getRun: async () => undefined,
    listRunEvents: async () => [],
    getLatestRunEventByType: async () => undefined,
    updateRunShell: async () => undefined,
    listAllStrategyFillEvents: async () => [],
    syncRunArtifacts: async (input: Readonly<{
      runId: string;
      trades: readonly Record<string, unknown>[];
      report: Record<string, unknown>;
      runReportJson: string;
      tradesCsv: string;
      eventsJsonl: string;
    }>) => {
      persisted = {
        runId: input.runId,
        trades: input.trades,
        report: input.report,
        runReportJson: input.runReportJson,
        tradesCsv: input.tradesCsv,
        eventsJsonl: input.eventsJsonl
      };
    }
  } as unknown as ConstructorParameters<typeof RunsService>[0]);

  const events: WsEventEnvelopeDto[] = [
    {
      runId: 'run-persist-artifacts',
      seq: 1,
      traceId: 'persist-1',
      eventType: 'FILL',
      eventTs: '2026-03-08T00:00:00.000Z',
      payload: { side: 'BUY', fillPrice: 100, qty: 2 }
    },
    {
      runId: 'run-persist-artifacts',
      seq: 2,
      traceId: 'persist-2',
      eventType: 'EXIT',
      eventTs: '2026-03-08T00:01:00.000Z',
      payload: { reason: 'TP1', pnlPct: 2.5 }
    },
    {
      runId: 'run-persist-artifacts',
      seq: 3,
      traceId: 'persist-3',
      eventType: 'FILL',
      eventTs: '2026-03-08T00:01:01.000Z',
      payload: { side: 'SELL', fillPrice: 102.5, qty: 2 }
    }
  ];

  events.forEach((event) => svc.ingestEvent(event));

  const report = await svc.getRunReport('run-persist-artifacts');

  assert.equal(report?.results.trades.count, 1);
  assert.equal(persisted?.runId, 'run-persist-artifacts');
  assert.equal(persisted?.trades.length, 1);
  assert.deepEqual(persisted?.trades[0], {
    trade_id: 'run-persist-artifacts:T-0001',
    run_id: 'run-persist-artifacts',
    entry_ts: '2026-03-08T00:00:00.000Z',
    exit_ts: '2026-03-08T00:01:01.000Z',
    entry_price: 100,
    exit_price: 102.5,
    qty: 2,
    notional_krw: 200,
    exit_reason: 'TP1',
    gross_return_pct: 2.5,
    net_return_pct: 2.3976,
    bars_delay: 0
  });
  assert.equal(persisted?.report.runId, 'run-persist-artifacts');
  assert.equal((persisted?.report.artifacts as { runReportJson?: string }).runReportJson, 'run-artifacts/run-persist-artifacts/run_report.json');
  assert.ok(persisted?.runReportJson.includes('"runId": "run-persist-artifacts"'));
  assert.ok(persisted?.tradesCsv.includes('tradeId,entryTime,exitReason,netReturnPct,seq'));
  assert.ok(persisted?.eventsJsonl.includes('"eventType":"FILL"'));
});

test('RunsService returns candle snapshot from market tick events', async () => {
  const svc = createRunsService();

  const events: WsEventEnvelopeDto[] = [
    {
      runId: 'run-3',
      seq: 1,
      traceId: 'trace-1',
      eventType: 'MARKET_TICK',
      eventTs: new Date().toISOString(),
      payload: {
        candle: { time: 120, open: 1, high: 3, low: 1, close: 2 }
      }
    },
    {
      runId: 'run-3',
      seq: 2,
      traceId: 'trace-2',
      eventType: 'MARKET_TICK',
      eventTs: new Date().toISOString(),
      payload: {
        candle: { time: 120, open: 1, high: 4, low: 1, close: 3 }
      }
    },
    {
      runId: 'run-3',
      seq: 3,
      traceId: 'trace-3',
      eventType: 'MARKET_TICK',
      eventTs: new Date().toISOString(),
      payload: {
        candle: { time: 180, open: 3, high: 5, low: 2, close: 4 }
      }
    }
  ];

  events.forEach((event) => svc.ingestEvent(event));

  const candles = await svc.getCandles('run-3', 300);
  assert.equal(candles?.length, 2);
  assert.deepEqual(candles?.[0], { time: 120, open: 1, high: 4, low: 1, close: 3 });
  assert.deepEqual(candles?.[1], { time: 180, open: 3, high: 5, low: 2, close: 4 });
});

test('RunsService normalizes off-minute candle timestamps to minute buckets', async () => {
  const svc = createRunsService();

  const events: WsEventEnvelopeDto[] = [
    {
      runId: 'run-3b',
      seq: 1,
      traceId: 'trace-1',
      eventType: 'MARKET_TICK',
      eventTs: new Date().toISOString(),
      payload: {
        candle: { time: 1772888934, open: 2015, high: 2015, low: 2014, close: 2014 }
      }
    },
    {
      runId: 'run-3b',
      seq: 2,
      traceId: 'trace-2',
      eventType: 'MARKET_TICK',
      eventTs: new Date().toISOString(),
      payload: {
        candle: { time: 1772888939, open: 2015, high: 2016, low: 2014, close: 2016 }
      }
    }
  ];

  events.forEach((event) => svc.ingestEvent(event));

  const candles = await svc.getCandles('run-3b', 300);
  assert.equal(candles?.length, 1);
  assert.deepEqual(candles?.[0], { time: 1772888880, open: 2015, high: 2016, low: 2014, close: 2016 });
});

test('RunsService computes KPI from EXIT pnl events', async () => {
  const svc = createRunsService();
  svc.seedRun('run-kpi');

  const events: WsEventEnvelopeDto[] = [
    {
      runId: 'run-kpi',
      seq: 1,
      traceId: 't1',
      eventType: 'FILL',
      eventTs: new Date().toISOString(),
      payload: { side: 'BUY', fillPrice: 100, qty: 1 }
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
      eventType: 'FILL',
      eventTs: new Date().toISOString(),
      payload: { side: 'SELL', fillPrice: 102, qty: 1 }
    },
    {
      runId: 'run-kpi',
      seq: 4,
      traceId: 't4',
      eventType: 'FILL',
      eventTs: new Date().toISOString(),
      payload: { side: 'BUY', fillPrice: 100, qty: 1 }
    },
    {
      runId: 'run-kpi',
      seq: 5,
      traceId: 't5',
      eventType: 'EXIT',
      eventTs: new Date().toISOString(),
      payload: { reason: 'SL', pnlPct: -0.7 }
    },
    {
      runId: 'run-kpi',
      seq: 6,
      traceId: 't6',
      eventType: 'FILL',
      eventTs: new Date().toISOString(),
      payload: { side: 'SELL', fillPrice: 99.4, qty: 1 }
    },
    {
      runId: 'run-kpi',
      seq: 7,
      traceId: 't7',
      eventType: 'EXIT',
      eventTs: new Date().toISOString(),
      payload: { reason: 'IGNORED_EXTRA_EXIT', pnlPct: -0.1 }
    }
  ];
  events.forEach((event) => svc.ingestEvent(event));

  const run = await svc.getRun('run-kpi');
  assert.equal(run?.kpi.trades, 2);
  assert.equal(run?.kpi.exits, 3);
  assert.equal(run?.kpi.winRate, 50);
  assert.equal(run?.kpi.sumReturnPct, 1.1987);
  assert.equal(run?.kpi.mddPct, -0.6994);
  assert.equal(run?.kpi.profitFactor, 2.7139);
  assert.equal(run?.kpi.avgWinPct, 1.8981);
  assert.equal(run?.kpi.avgLossPct, -0.6994);
});

test('RunsService ignores legacy fill events without side/fillPrice in trade counts', async () => {
  const svc = createRunsService();
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
      payload: { side: 'BUY', fillPrice: 100, qty: 1 }
    },
    {
      runId: 'run-legacy-fill',
      seq: 3,
      traceId: 'exit-fill',
      eventType: 'EXIT',
      eventTs: new Date().toISOString(),
      payload: { reason: 'TP2', pnlPct: 2.5 }
    },
    {
      runId: 'run-legacy-fill',
      seq: 4,
      traceId: 'flat-fill',
      eventType: 'FILL',
      eventTs: new Date().toISOString(),
      payload: { side: 'SELL', fillPrice: 102.5, qty: 1 }
    }
  ];

  events.forEach((event) => svc.ingestEvent(event));

  const run = await svc.getRun('run-legacy-fill');
  const csv = await svc.getTradesCsv('run-legacy-fill');

  assert.equal(run?.kpi.trades, 1);
  assert.ok(csv?.includes('T-0001'));
  assert.ok(!csv?.includes('T-0002'));
});

test('RunsService seeds strategy-specific execution policy defaults', () => {
  const svc = createRunsService();

  svc.seedRun('run-a-default', { strategyId: 'STRAT_A', mode: 'PAPER' });
  svc.seedRun('run-b-paper-default', { strategyId: 'STRAT_B', mode: 'PAPER' });
  svc.seedRun('run-b-semi-default', { strategyId: 'STRAT_B', mode: 'SEMI_AUTO' });
  svc.seedRun('run-c-default', { strategyId: 'STRAT_C', mode: 'AUTO' });

  const runA = svc.getRunConfig('run-a-default');
  const runBPaper = svc.getRunConfig('run-b-paper-default');
  const runBSemi = svc.getRunConfig('run-b-semi-default');
  const runC = svc.getRunConfig('run-c-default');

  assert.equal(runA?.fillModelApplied, 'NEXT_OPEN');
  assert.equal(runA?.entryPolicy, 'A_CONFIRM_NEXT_OPEN');
  assert.equal(runBPaper?.fillModelApplied, 'ON_CLOSE');
  assert.equal(runBPaper?.entryPolicy, 'B_POI_TOUCH_CONFIRM_ON_CLOSE');
  assert.equal(runBSemi?.fillModelApplied, 'NEXT_OPEN');
  assert.equal(runBSemi?.entryPolicy, 'B_SEMI_AUTO_NEXT_OPEN_AFTER_APPROVAL');
  assert.equal(runC?.fillModelApplied, 'NEXT_MINUTE_OPEN');
  assert.equal(runC?.entryPolicy, 'C_NEXT_MINUTE_OPEN');
});

test('RunsService hydrates persisted entryPolicy from the run shell snapshot', async () => {
  const svc = new RunsService({
    listRuns: async () => [],
    getRun: async () => ({
      runId: 'run-persisted-policy',
      strategyId: 'STRAT_B',
      strategyVersion: 'v9',
      mode: 'SEMI_AUTO',
      market: 'KRW-BTC',
      fillModelRequested: 'AUTO',
      fillModelApplied: 'NEXT_OPEN',
      entryPolicy: 'B_SEMI_AUTO_NEXT_OPEN_AFTER_APPROVAL',
      createdAt: '2026-03-08T00:00:00.000Z',
      updatedAt: '2026-03-08T00:10:00.000Z'
    }),
    listRunEvents: async () => [],
    getLatestRunEventByType: async () => undefined,
    updateRunShell: async () => undefined,
    listAllStrategyFillEvents: async () => [],
    syncRunArtifacts: async () => undefined
  } as unknown as ConstructorParameters<typeof RunsService>[0]);

  const run = await svc.getRun('run-persisted-policy');

  assert.equal(run?.entryPolicy, 'B_SEMI_AUTO_NEXT_OPEN_AFTER_APPROVAL');
  assert.equal(run?.runConfig.entryPolicy, 'B_SEMI_AUTO_NEXT_OPEN_AFTER_APPROVAL');
});

test('RunsService restores latest entry readiness even after runtime ticks repopulate the in-memory run', async () => {
  let latestEntryReadinessFetches = 0;

  const svc = new RunsService({
    listRuns: async () => [],
    getRun: async () => ({
      runId: 'run-strat-a-0001',
      strategyId: 'STRAT_A',
      strategyVersion: 'v1',
      mode: 'PAPER',
      market: 'KRW-BTC',
      fillModelRequested: 'AUTO',
      fillModelApplied: 'ON_CLOSE',
      entryPolicy: 'A_ON_CLOSE',
      createdAt: '2026-03-09T00:00:00.000Z',
      updatedAt: '2026-03-09T00:05:00.000Z'
    }),
    listRunEvents: async () => [],
    getLatestRunEventByType: async () => {
      latestEntryReadinessFetches += 1;
      return {
        runId: 'run-strat-a-0001',
        seq: 7,
        traceId: 'persisted-entry-readiness',
        eventType: 'ENTRY_READINESS',
        eventTs: '2026-03-09T00:04:00.000Z',
        payload: {
          entryReadinessPct: 78,
          entryReady: false,
          entryExecutable: false,
          reason: 'ENTRY_WAIT',
          inPosition: false
        }
      };
    },
    updateRunShell: async () => undefined,
    listAllStrategyFillEvents: async () => [],
    syncRunArtifacts: async () => undefined
  } as unknown as ConstructorParameters<typeof RunsService>[0]);

  svc.seedRun('run-strat-a-0001', {
    strategyId: 'STRAT_A',
    strategyVersion: 'v1',
    mode: 'PAPER',
    market: 'KRW-BTC'
  });
  svc.ingestEvent({
    runId: 'run-strat-a-0001',
    seq: 1,
    traceId: 'runtime-market-tick',
    eventType: 'MARKET_TICK',
    eventTs: '2026-03-09T00:05:00.000Z',
    payload: {
      strategyId: 'STRAT_A',
      candle: { time: 1772985900, open: 100, high: 102, low: 99, close: 101 }
    }
  });

  const run = await svc.getRun('run-strat-a-0001');

  assert.equal(run?.latestEntryReadiness?.entryReadinessPct, 78);
  assert.equal(run?.latestEntryReadiness?.reason, 'ENTRY_WAIT');
  assert.equal(latestEntryReadinessFetches, 1);
});

test('RunsService merges persisted fill ledger rows with runtime fills without duplicates', async () => {
  const persisted = [
    createFillEvent('run-strat-b-0001', 1, { side: 'BUY', fillPrice: 100, qty: 2 })
  ];
  const svc = new RunsService({
    listRuns: async () => [],
    getRun: async () => undefined,
    listRunEvents: async () => [],
    getLatestRunEventByType: async () => undefined,
    updateRunShell: async () => undefined,
    listAllStrategyFillEvents: async () => persisted,
    syncRunArtifacts: async () => undefined
  } as unknown as ConstructorParameters<typeof RunsService>[0]);

  svc.seedRun('run-strat-b-0001', {
    strategyId: 'STRAT_B',
    strategyVersion: 'v1',
    mode: 'PAPER',
    market: 'KRW-XRP'
  });
  svc.ingestEvent(createFillEvent('run-strat-b-0001', 1, { side: 'BUY', fillPrice: 100, qty: 2 }));
  svc.ingestEvent(createFillEvent('run-strat-b-0001', 2, { side: 'SELL', fillPrice: 105, qty: 2 }));

  const page = await svc.listStrategyFills('STRAT_B', 1, 50);

  assert.equal(page.total, 2);
  assert.deepEqual(page.items.map((item) => item.seq), [2, 1]);
});

test('RunsService account summary uses persisted fill ledger rows as the source of truth', async () => {
  const svc = new RunsService({
    listRuns: async () => [],
    getRun: async () => undefined,
    listRunEvents: async () => [],
    getLatestRunEventByType: async () => undefined,
    updateRunShell: async () => undefined,
    listAllStrategyFillEvents: async () => [
      createFillEvent('run-strat-a-0001', 1, { side: 'BUY', fillPrice: 100, qty: 2 }),
      createFillEvent('run-strat-a-0001', 2, { side: 'SELL', fillPrice: 110, qty: 1 })
    ],
    syncRunArtifacts: async () => undefined
  } as unknown as ConstructorParameters<typeof RunsService>[0]);

  const summary = await svc.getStrategyAccountSummary('STRAT_A');

  assert.equal(summary.fillCount, 2);
  assert.equal(summary.positionQty, 1);
  assert.equal(summary.cashKrw, 999909.84);
  assert.equal(summary.avgEntryPriceKrw, 100.05);
  assert.equal(summary.markPriceKrw, 110);
  assert.equal(summary.realizedPnlKrw, 9.89);
  assert.equal(summary.marketValueKrw, 110);
  assert.equal(summary.equityKrw, 1000019.84);
  assert.equal(summary.totalPnlKrw, 19.84);
});

test('RunsService account summary marks open position to the latest strategy candle close', async () => {
  const svc = new RunsService({
    listRuns: async () => [],
    getRun: async () => undefined,
    listRunEvents: async () => [],
    getLatestRunEventByType: async () => undefined,
    updateRunShell: async () => undefined,
    listAllStrategyFillEvents: async () => [
      createFillEvent('run-strat-a-0001', 1, { side: 'BUY', fillPrice: 100, qty: 2 }),
      createFillEvent('run-strat-a-0001', 2, { side: 'SELL', fillPrice: 110, qty: 1 })
    ],
    syncRunArtifacts: async () => undefined
  } as unknown as ConstructorParameters<typeof RunsService>[0]);

  svc.seedRun('run-strat-a-0001', {
    strategyId: 'STRAT_A',
    strategyVersion: 'v1',
    mode: 'PAPER',
    market: 'KRW-BTC'
  });
  svc.ingestEvent({
    runId: 'run-strat-a-0001',
    seq: 3,
    traceId: 'trace-run-strat-a-0001-3',
    eventType: 'MARKET_TICK',
    eventTs: new Date(1_700_000_003_000).toISOString(),
    payload: {
      strategyId: 'STRAT_A',
      candle: { time: 180, open: 108, high: 121, low: 107, close: 120 }
    }
  });

  const summary = await svc.getStrategyAccountSummary('STRAT_A');

  assert.equal(summary.fillCount, 2);
  assert.equal(summary.positionQty, 1);
  assert.equal(summary.markPriceKrw, 120);
  assert.equal(summary.marketValueKrw, 120);
  assert.equal(summary.equityKrw, 1000029.84);
  assert.equal(summary.unrealizedPnlKrw, 19.95);
  assert.equal(summary.totalPnlKrw, 29.84);
});

test('RunsService updates run control fields', async () => {
  const svc = createRunsService();
  svc.seedRun('run-ctl', { strategyId: 'STRAT_A', mode: 'PAPER', market: 'KRW-XRP' });

  const updated = await svc.updateRunControl('run-ctl', {
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
  assert.equal(config?.riskSnapshot.seedKrw, 1_000_000);
  assert.equal(config?.riskSnapshot.maxPositionRatio, 0.2);
});

test('RunsService filters run history by strategy/mode/market', async () => {
  const svc = createRunsService();
  svc.seedRun('run-a-paper', { strategyId: 'STRAT_A', strategyVersion: 'v1', mode: 'PAPER', market: 'KRW-BTC' });
  svc.seedRun('run-a-auto', { strategyId: 'STRAT_A', strategyVersion: 'v2', mode: 'AUTO', market: 'KRW-XRP' });
  svc.seedRun('run-b-paper', { strategyId: 'STRAT_B', strategyVersion: 'v2', mode: 'PAPER', market: 'KRW-XRP' });

  const byStrategy = await svc.listRuns({ strategyId: 'STRAT_A' });
  assert.ok(byStrategy.some((item) => item.runId === 'run-a-paper'));
  assert.ok(byStrategy.some((item) => item.runId === 'run-a-auto'));

  const byMode = await svc.listRuns({ mode: 'PAPER' });
  assert.ok(byMode.some((item) => item.runId === 'run-a-paper'));
  assert.ok(byMode.some((item) => item.runId === 'run-b-paper'));

  const byMarket = await svc.listRuns({ market: 'KRW-XRP' });
  assert.ok(byMarket.some((item) => item.runId === 'run-a-auto'));
  assert.ok(byMarket.some((item) => item.runId === 'run-b-paper'));

  const byVersion = await svc.listRuns({ strategyVersion: 'v2' });
  assert.ok(byVersion.some((item) => item.runId === 'run-a-auto'));
  assert.ok(byVersion.some((item) => item.runId === 'run-b-paper'));

  const composite = await svc.listRuns({ strategyId: 'STRAT_A', mode: 'AUTO', market: 'KRW-XRP' });
  assert.equal(composite.length, 1);
  assert.equal(composite[0]?.runId, 'run-a-auto');
});

test('RunsService validates event payload against runConfig snapshot', () => {
  const svc = createRunsService();
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
  const svc = createRunsService();
  svc.seedRun('run-approve');

  const approved = svc.approvePendingEntry('run-approve');
  const consumedFirst = svc.consumeApproval('run-approve');
  const consumedSecond = svc.consumeApproval('run-approve');

  assert.equal(approved, true);
  assert.equal(consumedFirst, true);
  assert.equal(consumedSecond, false);
});

test('RunsService derives realtime status from snapshot delay, persistence backlog, transport state, and stale last event', async () => {
  const svc = createRunsService();
  svc.seedRun('run-rt');

  const live = svc.getRealtimeStatus('run-rt');
  assert.equal(live?.connectionState, CONNECTION_STATE.LIVE);

  const snapshotDelayed = svc.setSnapshotDelay('run-rt', true, 5_000);
  assert.equal(snapshotDelayed.connectionState, CONNECTION_STATE.DELAYED);

  svc.setSnapshotDelay('run-rt', false, 5_000);
  const backlog = svc.setPersistenceBacklog('run-rt', {
    queueDepth: 2,
    retryCount: 1,
    nextRetryInMs: 500
  });
  assert.equal(backlog.connectionState, CONNECTION_STATE.DELAYED);
  assert.equal(backlog.queueDepth, 2);
  assert.equal(backlog.retryCount, 1);
  assert.equal(backlog.nextRetryInMs, 500);

  svc.setPersistenceBacklog('run-rt', { queueDepth: 0 });
  const reconnecting = svc.setTransportState('run-rt', CONNECTION_STATE.RECONNECTING, {
    retryCount: 2,
    nextRetryInMs: 2000
  });
  assert.equal(reconnecting.connectionState, CONNECTION_STATE.RECONNECTING);
  assert.equal(reconnecting.retryCount, 2);
  assert.equal(reconnecting.nextRetryInMs, 2000);

  svc.setTransportState('run-rt', CONNECTION_STATE.LIVE, {
    staleThresholdMs: 1_000
  });
  svc.ingestEvent({
    runId: 'run-rt',
    seq: 1,
    traceId: 'trace-stale',
    eventType: 'MARKET_TICK',
    eventTs: new Date(Date.now() - 5_000).toISOString(),
    payload: {
      candle: { time: 120, open: 1, high: 1, low: 1, close: 1 }
    }
  });

  const staleRun = await svc.getRun('run-rt');
  assert.equal(staleRun?.realtimeStatus?.connectionState, CONNECTION_STATE.DELAYED);
});
