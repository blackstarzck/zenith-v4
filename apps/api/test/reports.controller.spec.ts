import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { ReportsController } from '../src/modules/reports/reports.controller';

function createDatasetRef(input: Readonly<{
  market: string;
  timeframes: readonly string[];
  feeds: readonly string[];
  dateRangeLabel: string;
  exact: boolean;
}>) {
  return {
    key: [
      'UPBIT',
      'REPLAY_BACKTEST',
      input.market,
      input.timeframes.join('+'),
      input.feeds.join('+'),
      input.dateRangeLabel,
      '',
      '',
      input.exact ? 'exact' : 'approx'
    ].join('|'),
    source: 'UPBIT' as const,
    profile: 'REPLAY_BACKTEST' as const,
    market: input.market,
    timeframes: [...input.timeframes],
    feeds: [...input.feeds],
    dateRangeLabel: input.dateRangeLabel,
    exact: input.exact
  };
}

test('ReportsController compare prefers persisted run report summaries over in-memory row KPI', async () => {
  const controller = new ReportsController({
    listRuns: async () => ([
      {
        runId: 'run-a-1',
        strategyId: 'STRAT_A',
        strategyVersion: 'v1',
        mode: 'PAPER',
        market: 'KRW-XRP',
        fillModelRequested: 'AUTO',
        fillModelApplied: 'NEXT_OPEN',
        entryPolicy: 'A_CONFIRM_NEXT_OPEN',
        datasetRef: createDatasetRef({
          market: 'KRW-XRP',
          timeframes: ['15m'],
          feeds: ['candle:15m'],
          dateRangeLabel: '2026-02',
          exact: false
        }),
        createdAt: '2026-03-08T00:00:00.000Z',
        eventCount: 10,
        lastSeq: 10,
        trades: 1,
        exits: 1,
        winRate: 10,
        sumReturnPct: 0.5,
        mddPct: -10,
        profitFactor: 0.5,
        avgWinPct: 0.5,
        avgLossPct: -3
      }
    ]),
    listPersistedRunReportSummaries: async () => ([
      {
        runId: 'run-a-1',
        kpi: {
          count: 4,
          exits: 4,
          winCount: 3,
          lossCount: 1,
          winRate: 75,
          profitFactor: 1.8,
          avgWinPct: 2.2,
          avgLossPct: -0.9,
          sumReturnPct: 5.7,
          totalKrw: 57_000,
          mddPct: -1.1
        },
        exitReasonBreakdown: {
          TP1: 3,
          SL: 1
        },
        artifactManifest: {
          runReportJson: 'run-artifacts/run-a-1/run_report.json'
        },
        createdAt: '2026-03-08T00:02:00.000Z'
      }
    ])
  } as unknown as ConstructorParameters<typeof ReportsController>[0]);

  const response = await controller.getCompare();

  const stratA = response.summary.find((row) => row.strategyId === 'STRAT_A');
  assert.deepEqual(stratA, {
    strategyId: 'STRAT_A',
    runs: 1,
    trades: 4,
    winRate: 75,
    sumReturnPct: 5.7,
    mddPct: -1.1,
    profitFactor: 1.8,
    avgWinPct: 2.2,
    avgLossPct: -0.9
  });

  assert.deepEqual(response.trend, [
    {
      strategyVersion: 'v1',
      strategyId: 'STRAT_A',
      runs: 1,
      winRate: 75,
      sumReturnPct: 5.7,
      mddPct: -1.1,
      profitFactor: 1.8
    }
  ]);
});

test('ReportsController compare falls back to run history KPI when persisted summary is absent', async () => {
  const controller = new ReportsController({
    listRuns: async () => ([
      {
        runId: 'run-b-1',
        strategyId: 'STRAT_B',
        strategyVersion: 'v2',
        mode: 'AUTO',
        market: 'KRW-BTC',
        fillModelRequested: 'AUTO',
        fillModelApplied: 'ON_CLOSE',
        entryPolicy: 'B_POI_TOUCH_CONFIRM_ON_CLOSE',
        datasetRef: createDatasetRef({
          market: 'KRW-BTC',
          timeframes: ['15m', '1h'],
          feeds: ['candle:15m', 'candle:1h'],
          dateRangeLabel: 'runtime-window',
          exact: false
        }),
        createdAt: '2026-03-08T00:00:00.000Z',
        eventCount: 8,
        lastSeq: 8,
        trades: 2,
        exits: 2,
        winRate: 50,
        sumReturnPct: 1.25,
        mddPct: -0.7,
        profitFactor: 1.3,
        avgWinPct: 2.1,
        avgLossPct: -0.8
      }
    ]),
    listPersistedRunReportSummaries: async () => []
  } as unknown as ConstructorParameters<typeof ReportsController>[0]);

  const response = await controller.getCompare();

  const stratB = response.summary.find((row) => row.strategyId === 'STRAT_B');
  assert.deepEqual(stratB, {
    strategyId: 'STRAT_B',
    runs: 1,
    trades: 2,
    winRate: 50,
    sumReturnPct: 1.25,
    mddPct: -0.7,
    profitFactor: 1.3,
    avgWinPct: 2.1,
    avgLossPct: -0.8
  });
});

test('ReportsController benchmark compare returns provisional MATCHED when available checks align with STRAT_A doc benchmark', async () => {
  const controller = new ReportsController({
    listRuns: async () => ([
      {
        runId: 'run-a-doc',
        strategyId: 'STRAT_A',
        strategyVersion: 'v3',
        mode: 'PAPER',
        market: 'KRW-XRP',
        fillModelRequested: 'AUTO',
        fillModelApplied: 'NEXT_OPEN',
        entryPolicy: 'A_CONFIRM_NEXT_OPEN',
        datasetRef: createDatasetRef({
          market: 'KRW-XRP',
          timeframes: ['15m'],
          feeds: ['candle:15m'],
          dateRangeLabel: '2026-02',
          exact: false
        }),
        createdAt: '2026-03-08T00:00:00.000Z',
        eventCount: 20,
        lastSeq: 20,
        trades: 10,
        exits: 10,
        winRate: 90,
        sumReturnPct: 10.09,
        mddPct: -0.405,
        profitFactor: 3.5,
        avgWinPct: 1.2,
        avgLossPct: -0.4
      }
    ]),
    listPersistedRunReportSummaries: async () => ([
      {
        runId: 'run-a-doc',
        kpi: {
          count: 10,
          exits: 10,
          winCount: 9,
          lossCount: 1,
          winRate: 90,
          profitFactor: 3.5,
          avgWinPct: 1.2,
          avgLossPct: -0.4,
          sumReturnPct: 10.09,
          totalKrw: 100_900,
          mddPct: -0.405
        },
        exitReasonBreakdown: {
          TP1: 9,
          SL: 1
        },
        artifactManifest: {
          runReportJson: 'run-artifacts/run-a-doc/run_report.json',
          tradesCsv: 'run-artifacts/run-a-doc/trades.csv',
          eventsJsonl: 'run-artifacts/run-a-doc/events.jsonl'
        },
        createdAt: '2026-03-08T00:02:00.000Z'
      }
    ]),
    getRunReport: async () => ({
      runId: 'run-a-doc',
      createdAt: '2026-03-08T00:00:00.000Z',
      strategy: {
        strategyId: 'STRAT_A',
        strategyVersion: 'v3'
      },
      dataset: {
        market: 'KRW-XRP',
        timeframes: ['15m'],
        datasetRef: createDatasetRef({
          market: 'KRW-XRP',
          timeframes: ['15m'],
          feeds: ['candle:15m'],
          dateRangeLabel: '2026-02',
          exact: false
        })
      },
      execution: {
        mode: 'PAPER',
        entryPolicy: 'A_CONFIRM_NEXT_OPEN',
        fillModelRequested: 'AUTO',
        fillModelApplied: 'NEXT_OPEN'
      },
      fees: {
        feeMode: 'PER_SIDE',
        perSide: 0.0005,
        roundtrip: null,
        slippageAssumedPct: 0
      },
      risk: {
        seedKrw: 1_000_000,
        maxPositionRatio: 0.2,
        dailyLossLimitPct: 3,
        maxConsecutiveLosses: 3,
        maxDailyOrders: 20,
        killSwitch: true
      },
      results: {
        trades: {
          count: 10,
          exits: 10,
          winCount: 9,
          lossCount: 1,
          winRate: 90,
          profitFactor: 3.5,
          avgWinPct: 1.2,
          avgLossPct: -0.4,
          sumReturnPct: 10.09
        },
        pnl: {
          totalKrw: 100_900,
          mddPct: -0.405
        },
        exitReasonBreakdown: {
          TP1: 9,
          SL: 1
        }
      },
      artifacts: {
        runReportJson: 'run-artifacts/run-a-doc/run_report.json',
        tradesCsv: 'run-artifacts/run-a-doc/trades.csv',
        eventsJsonl: 'run-artifacts/run-a-doc/events.jsonl'
      }
    })
  } as unknown as ConstructorParameters<typeof ReportsController>[0]);

  const response = await controller.getBenchmarkCompare('STRAT_A');
  const item = response.items[0];

  assert.equal(item?.status, 'MATCHED');
  assert.equal(item?.docClaimEligible, false);
  assert.deepEqual(item?.checks, {
    persistedArtifacts: true,
    dataset: true,
    datasetExact: false,
    execution: true,
    parameters: true,
    metrics: true
  });
  assert.equal(item?.metricComparisons.find((metric) => metric.key === 'avgTradeReturnPct')?.actual, 1.009);
});

test('ReportsController benchmark compare classifies STRAT_A fee drift as PARAMETER_MISMATCH', async () => {
  const controller = new ReportsController({
    listRuns: async () => ([
      {
        runId: 'run-a-fee-drift',
        strategyId: 'STRAT_A',
        strategyVersion: 'v3',
        mode: 'PAPER',
        market: 'KRW-XRP',
        fillModelRequested: 'AUTO',
        fillModelApplied: 'NEXT_OPEN',
        entryPolicy: 'A_CONFIRM_NEXT_OPEN',
        datasetRef: createDatasetRef({
          market: 'KRW-XRP',
          timeframes: ['15m'],
          feeds: ['candle:15m'],
          dateRangeLabel: '2026-02',
          exact: false
        }),
        createdAt: '2026-03-08T00:00:00.000Z',
        eventCount: 20,
        lastSeq: 20,
        trades: 10,
        exits: 10,
        winRate: 90,
        sumReturnPct: 10.09,
        mddPct: -0.405,
        profitFactor: 3.5,
        avgWinPct: 1.2,
        avgLossPct: -0.4
      }
    ]),
    listPersistedRunReportSummaries: async () => ([
      {
        runId: 'run-a-fee-drift',
        kpi: {
          count: 10,
          exits: 10,
          winCount: 9,
          lossCount: 1,
          winRate: 90,
          profitFactor: 3.5,
          avgWinPct: 1.2,
          avgLossPct: -0.4,
          sumReturnPct: 10.09,
          totalKrw: 100_900,
          mddPct: -0.405
        },
        exitReasonBreakdown: {
          TP1: 9,
          SL: 1
        },
        artifactManifest: {
          runReportJson: 'run-artifacts/run-a-fee-drift/run_report.json',
          tradesCsv: 'run-artifacts/run-a-fee-drift/trades.csv',
          eventsJsonl: 'run-artifacts/run-a-fee-drift/events.jsonl'
        },
        createdAt: '2026-03-08T00:02:00.000Z'
      }
    ]),
    getRunReport: async () => ({
      runId: 'run-a-fee-drift',
      createdAt: '2026-03-08T00:00:00.000Z',
      strategy: {
        strategyId: 'STRAT_A',
        strategyVersion: 'v3'
      },
      dataset: {
        market: 'KRW-XRP',
        timeframes: ['15m'],
        datasetRef: createDatasetRef({
          market: 'KRW-XRP',
          timeframes: ['15m'],
          feeds: ['candle:15m'],
          dateRangeLabel: '2026-02',
          exact: false
        })
      },
      execution: {
        mode: 'PAPER',
        entryPolicy: 'A_CONFIRM_NEXT_OPEN',
        fillModelRequested: 'AUTO',
        fillModelApplied: 'NEXT_OPEN'
      },
      fees: {
        feeMode: 'PER_SIDE',
        perSide: 0.001,
        roundtrip: null,
        slippageAssumedPct: 0
      },
      risk: {
        seedKrw: 1_000_000,
        maxPositionRatio: 0.2,
        dailyLossLimitPct: 3,
        maxConsecutiveLosses: 3,
        maxDailyOrders: 20,
        killSwitch: true
      },
      results: {
        trades: {
          count: 10,
          exits: 10,
          winCount: 9,
          lossCount: 1,
          winRate: 90,
          profitFactor: 3.5,
          avgWinPct: 1.2,
          avgLossPct: -0.4,
          sumReturnPct: 10.09
        },
        pnl: {
          totalKrw: 100_900,
          mddPct: -0.405
        },
        exitReasonBreakdown: {
          TP1: 9,
          SL: 1
        }
      },
      artifacts: {
        runReportJson: 'run-artifacts/run-a-fee-drift/run_report.json',
        tradesCsv: 'run-artifacts/run-a-fee-drift/trades.csv',
        eventsJsonl: 'run-artifacts/run-a-fee-drift/events.jsonl'
      }
    })
  } as unknown as ConstructorParameters<typeof ReportsController>[0]);

  const response = await controller.getBenchmarkCompare('STRAT_A');
  assert.equal(response.items[0]?.status, 'PARAMETER_MISMATCH');
});

test('ReportsController benchmark compare marks docClaimEligible when dataset_ref is exact for STRAT_A', async () => {
  const exactDatasetRef = createDatasetRef({
    market: 'KRW-XRP',
    timeframes: ['15m'],
    feeds: ['candle:15m'],
    dateRangeLabel: '2026-02',
    exact: true
  });
  const controller = new ReportsController({
    listRuns: async () => ([
      {
        runId: 'run-a-exact',
        strategyId: 'STRAT_A',
        strategyVersion: 'v3',
        mode: 'PAPER',
        market: 'KRW-XRP',
        fillModelRequested: 'AUTO',
        fillModelApplied: 'NEXT_OPEN',
        entryPolicy: 'A_CONFIRM_NEXT_OPEN',
        datasetRef: exactDatasetRef,
        createdAt: '2026-03-08T00:00:00.000Z',
        eventCount: 20,
        lastSeq: 20,
        trades: 10,
        exits: 10,
        winRate: 90,
        sumReturnPct: 10.09,
        mddPct: -0.405,
        profitFactor: 3.5,
        avgWinPct: 1.2,
        avgLossPct: -0.4
      }
    ]),
    listPersistedRunReportSummaries: async () => ([
      {
        runId: 'run-a-exact',
        kpi: {
          count: 10,
          exits: 10,
          winCount: 9,
          lossCount: 1,
          winRate: 90,
          profitFactor: 3.5,
          avgWinPct: 1.2,
          avgLossPct: -0.4,
          sumReturnPct: 10.09,
          totalKrw: 100_900,
          mddPct: -0.405
        },
        exitReasonBreakdown: {
          TP1: 9,
          SL: 1
        },
        artifactManifest: {
          runReportJson: 'run-artifacts/run-a-exact/run_report.json',
          tradesCsv: 'run-artifacts/run-a-exact/trades.csv',
          eventsJsonl: 'run-artifacts/run-a-exact/events.jsonl'
        },
        createdAt: '2026-03-08T00:02:00.000Z'
      }
    ]),
    getRunReport: async () => ({
      runId: 'run-a-exact',
      createdAt: '2026-03-08T00:00:00.000Z',
      strategy: {
        strategyId: 'STRAT_A',
        strategyVersion: 'v3'
      },
      dataset: {
        market: 'KRW-XRP',
        timeframes: ['15m'],
        datasetRef: exactDatasetRef
      },
      execution: {
        mode: 'PAPER',
        entryPolicy: 'A_CONFIRM_NEXT_OPEN',
        fillModelRequested: 'AUTO',
        fillModelApplied: 'NEXT_OPEN'
      },
      fees: {
        feeMode: 'PER_SIDE',
        perSide: 0.0005,
        roundtrip: null,
        slippageAssumedPct: 0
      },
      risk: {
        seedKrw: 1_000_000,
        maxPositionRatio: 0.2,
        dailyLossLimitPct: 3,
        maxConsecutiveLosses: 3,
        maxDailyOrders: 20,
        killSwitch: true
      },
      results: {
        trades: {
          count: 10,
          exits: 10,
          winCount: 9,
          lossCount: 1,
          winRate: 90,
          profitFactor: 3.5,
          avgWinPct: 1.2,
          avgLossPct: -0.4,
          sumReturnPct: 10.09
        },
        pnl: {
          totalKrw: 100_900,
          mddPct: -0.405
        },
        exitReasonBreakdown: {
          TP1: 9,
          SL: 1
        }
      },
      artifacts: {
        runReportJson: 'run-artifacts/run-a-exact/run_report.json',
        tradesCsv: 'run-artifacts/run-a-exact/trades.csv',
        eventsJsonl: 'run-artifacts/run-a-exact/events.jsonl'
      }
    })
  } as unknown as ConstructorParameters<typeof ReportsController>[0]);

  const response = await controller.getBenchmarkCompare('STRAT_A');
  assert.equal(response.items[0]?.status, 'MATCHED');
  assert.equal(response.items[0]?.docClaimEligible, true);
  assert.equal(response.items[0]?.checks.datasetExact, true);
});

test('ReportsController benchmark compare matches STRAT_B against the provided CSV benchmark', async () => {
  const exactDatasetRef = createDatasetRef({
    market: 'KRW-XRP',
    timeframes: ['15m', '1h'],
    feeds: ['candle:15m', 'candle:1h'],
    dateRangeLabel: '2026-02',
    exact: true
  });
  const controller = new ReportsController({
    listRuns: async () => ([
      {
        runId: 'run-b-doc',
        strategyId: 'STRAT_B',
        strategyVersion: 'v4',
        mode: 'PAPER',
        market: 'KRW-XRP',
        fillModelRequested: 'AUTO',
        fillModelApplied: 'ON_CLOSE',
        entryPolicy: 'B_POI_TOUCH_CONFIRM_ON_CLOSE',
        datasetRef: exactDatasetRef,
        createdAt: '2026-03-08T00:00:00.000Z',
        eventCount: 30,
        lastSeq: 30,
        trades: 11,
        exits: 11,
        winRate: 54.5455,
        sumReturnPct: 6.2533,
        mddPct: -4.697,
        profitFactor: 1.9446,
        avgWinPct: 2.1381,
        avgLossPct: -1.3101
      }
    ]),
    listPersistedRunReportSummaries: async () => ([
      {
        runId: 'run-b-doc',
        kpi: {
          count: 11,
          exits: 11,
          winCount: 6,
          lossCount: 5,
          winRate: 54.5455,
          profitFactor: 1.9446,
          avgWinPct: 2.1381,
          avgLossPct: -1.3101,
          sumReturnPct: 6.2533,
          totalKrw: 61_641,
          mddPct: -4.697
        },
        exitReasonBreakdown: {
          TimeExit: 5,
          TP: 3,
          SL: 2,
          BullModeOffExit: 1
        },
        artifactManifest: {
          runReportJson: 'run-artifacts/run-b-doc/run_report.json',
          tradesCsv: 'run-artifacts/run-b-doc/trades.csv',
          eventsJsonl: 'run-artifacts/run-b-doc/events.jsonl'
        },
        createdAt: '2026-03-08T00:02:00.000Z'
      }
    ]),
    getRunReport: async () => ({
      runId: 'run-b-doc',
      createdAt: '2026-03-08T00:00:00.000Z',
      strategy: {
        strategyId: 'STRAT_B',
        strategyVersion: 'v4'
      },
      dataset: {
        market: 'KRW-XRP',
        timeframes: ['15m', '1h'],
        datasetRef: exactDatasetRef
      },
      execution: {
        mode: 'PAPER',
        entryPolicy: 'B_POI_TOUCH_CONFIRM_ON_CLOSE',
        fillModelRequested: 'AUTO',
        fillModelApplied: 'ON_CLOSE'
      },
      fees: {
        feeMode: 'PER_SIDE',
        perSide: 0.0005,
        roundtrip: null,
        slippageAssumedPct: 0
      },
      risk: {
        seedKrw: 1_000_000,
        maxPositionRatio: 0.2,
        dailyLossLimitPct: 3,
        maxConsecutiveLosses: 3,
        maxDailyOrders: 20,
        killSwitch: true
      },
      results: {
        trades: {
          count: 11,
          exits: 11,
          winCount: 6,
          lossCount: 5,
          winRate: 54.5455,
          profitFactor: 1.9446,
          avgWinPct: 2.1381,
          avgLossPct: -1.3101,
          sumReturnPct: 6.2533
        },
        pnl: {
          totalKrw: 61_641,
          mddPct: -4.697
        },
        exitReasonBreakdown: {
          TimeExit: 5,
          TP: 3,
          SL: 2,
          BullModeOffExit: 1
        }
      },
      artifacts: {
        runReportJson: 'run-artifacts/run-b-doc/run_report.json',
        tradesCsv: 'run-artifacts/run-b-doc/trades.csv',
        eventsJsonl: 'run-artifacts/run-b-doc/events.jsonl'
      }
    })
  } as unknown as ConstructorParameters<typeof ReportsController>[0]);

  const response = await controller.getBenchmarkCompare('STRAT_B');
  const item = response.items[0];

  assert.equal(item?.status, 'MATCHED');
  assert.equal(item?.docClaimEligible, true);
  assert.equal(item?.checks.datasetExact, true);
  assert.equal(item?.metricComparisons.find((metric) => metric.key === 'tradeCount')?.actual, 11);
});
