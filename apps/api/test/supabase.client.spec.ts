import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { AxiosError } from 'axios';
import type { WsEventEnvelopeDto } from '@zenith/contracts';
import { SupabaseClientService } from '../src/infra/db/supabase/client/supabase.client';

class FakeLogger {
  warn(): void {}
  error(): void {}
}

class FakeRetryPolicy {
  async runWithRetry<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    return fn(new AbortController().signal);
  }
}

class FakeRestClient {
  readonly posts: Array<Readonly<{ path: string; payload: unknown }>> = [];
  readonly patches: Array<Readonly<{ path: string; payload: unknown }>> = [];
  readonly deletes: string[] = [];
  readonly gets: string[] = [];
  readonly metas: string[] = [];
  readonly uploads: Array<Readonly<{
    bucket: string;
    objectPath: string;
    body: string;
    contentType: string;
  }>> = [];
  postHandler?: (path: string, payload: unknown) => Promise<void>;
  patchHandler?: (path: string, payload: unknown) => Promise<void>;
  deleteHandler?: (path: string) => Promise<void>;
  getHandler?: (path: string) => Promise<unknown[]>;
  getWithMetaHandler?: (path: string) => Promise<Readonly<{ data: unknown[]; contentRange?: string }>>;
  uploadHandler?: (bucket: string, objectPath: string, body: string, contentType: string) => Promise<void>;

  async post(path: string, payload: unknown, _signal: AbortSignal): Promise<void> {
    this.posts.push({ path, payload });
    if (this.postHandler) {
      await this.postHandler(path, payload);
    }
  }

  async patch(path: string, payload: unknown, _signal: AbortSignal): Promise<void> {
    this.patches.push({ path, payload });
    if (this.patchHandler) {
      await this.patchHandler(path, payload);
    }
  }

  async delete(path: string, _signal: AbortSignal): Promise<void> {
    this.deletes.push(path);
    if (this.deleteHandler) {
      await this.deleteHandler(path);
    }
  }

  async get<T = unknown>(path: string, _signal: AbortSignal): Promise<T> {
    this.gets.push(path);
    if (this.getHandler) {
      return await this.getHandler(path) as T;
    }
    return [] as T;
  }

  async getWithMeta<T = unknown>(
    path: string,
    _signal: AbortSignal
  ): Promise<Readonly<{ data: T; contentRange?: string }>> {
    this.metas.push(path);
    if (this.getWithMetaHandler) {
      return await this.getWithMetaHandler(path) as Readonly<{ data: T; contentRange?: string }>;
    }
    return { data: [] as T };
  }

  async uploadObject(
    bucket: string,
    objectPath: string,
    body: string,
    contentType: string,
    _signal: AbortSignal
  ): Promise<void> {
    this.uploads.push({ bucket, objectPath, body, contentType });
    if (this.uploadHandler) {
      await this.uploadHandler(bucket, objectPath, body, contentType);
    }
  }
}

function createService(rest: FakeRestClient): SupabaseClientService {
  return new SupabaseClientService(
    rest as unknown as ConstructorParameters<typeof SupabaseClientService>[0],
    new FakeLogger() as unknown as ConstructorParameters<typeof SupabaseClientService>[1],
    new FakeRetryPolicy() as unknown as ConstructorParameters<typeof SupabaseClientService>[2]
  );
}

function createFillEvent(seq = 1): WsEventEnvelopeDto {
  return {
    runId: 'run-strat-b-0001',
    seq,
    traceId: `trace-${seq}`,
    eventType: 'FILL',
    eventTs: new Date(1_700_000_000_000 + seq * 1000).toISOString(),
    payload: {
      strategyId: 'STRAT_B',
      strategyVersion: 'v1',
      market: 'KRW-XRP',
      side: 'BUY',
      qty: 2,
      fillPrice: 100
    }
  };
}

function createSupabaseError(status: number, code: string, message: string): AxiosError {
  return Object.assign(new AxiosError(message), {
    response: {
      status,
      data: {
        code,
        message
      }
    }
  });
}

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

test('SupabaseClientService persists valid fills into text_fills alongside text_run_events', async () => {
  const rest = new FakeRestClient();
  const svc = createService(rest);

  const result = await svc.safeInsertRunEvent(createFillEvent(1));

  assert.equal(result.ok, true);
  assert.deepEqual(rest.posts.map((entry) => entry.path), ['text_runs', 'text_run_events', 'text_fills']);
  assert.deepEqual(rest.posts[2]?.payload, {
    run_id: 'run-strat-b-0001',
    seq: 1,
    event_ts: new Date(1_700_000_001_000).toISOString(),
    trace_id: 'trace-1',
    side: 'BUY',
    qty: 2,
    fill_price: 100,
    notional_krw: 200,
    payload: {
      strategyId: 'STRAT_B',
      strategyVersion: 'v1',
      market: 'KRW-XRP',
      side: 'BUY',
      qty: 2,
      fillPrice: 100
    }
  });
});

test('SupabaseClientService persists run shell policy metadata when present on the event payload', async () => {
  const rest = new FakeRestClient();
  const svc = createService(rest);

  await svc.safeInsertRunEvent({
    ...createFillEvent(11),
    payload: {
      strategyId: 'STRAT_C',
      strategyVersion: 'v2',
      market: 'KRW-XRP',
      side: 'BUY',
      qty: 1,
      fillPrice: 100,
      fillModelRequested: 'AUTO',
      fillModelApplied: 'NEXT_MINUTE_OPEN',
      entryPolicy: 'C_NEXT_MINUTE_OPEN',
      datasetRef: createDatasetRef({
        market: 'KRW-XRP',
        timeframes: ['1m'],
        feeds: ['trade', 'ticker', 'orderbook', 'candle:1m'],
        dateRangeLabel: 'realtime-2026-03',
        exact: false
      })
    }
  });

  assert.deepEqual(rest.posts[0]?.payload, {
    run_id: 'run-strat-b-0001',
    strategy_id: 'STRAT_C',
    strategy_version: 'v2',
    mode: 'PAPER',
    market: 'KRW-XRP',
    timeframes: [],
    fill_model_requested: 'AUTO',
    fill_model_applied: 'NEXT_MINUTE_OPEN',
    entry_policy: { key: 'C_NEXT_MINUTE_OPEN' },
    dataset_ref: {
      key: 'UPBIT|REPLAY_BACKTEST|KRW-XRP|1m|trade+ticker+orderbook+candle:1m|realtime-2026-03|||approx',
      source: 'UPBIT',
      profile: 'REPLAY_BACKTEST',
      market: 'KRW-XRP',
      timeframes: ['1m'],
      feeds: ['trade', 'ticker', 'orderbook', 'candle:1m'],
      dateRangeLabel: 'realtime-2026-03',
      exact: false
    }
  });
});

test('SupabaseClientService falls back to legacy text_runs insert when entry_policy column is unavailable', async () => {
  const rest = new FakeRestClient();
  const svc = createService(rest);

  let firstInsert = true;
  rest.postHandler = async (path) => {
    if (path === 'text_runs' && firstInsert) {
      firstInsert = false;
      throw createSupabaseError(400, 'PGRST204', "Could not find the 'entry_policy' column of 'text_runs' in the schema cache");
    }
  };

  const result = await svc.safeInsertRunEvent({
    ...createFillEvent(12),
    payload: {
      strategyId: 'STRAT_B',
      strategyVersion: 'v2',
      market: 'KRW-XRP',
      side: 'BUY',
      qty: 1,
      fillPrice: 101,
      fillModelRequested: 'AUTO',
      entryPolicy: 'B_POI_TOUCH_CONFIRM_ON_CLOSE'
    }
  });

  assert.equal(result.ok, true);
  assert.equal(rest.posts.filter((entry) => entry.path === 'text_runs').length, 2);
  assert.ok(!('entry_policy' in (rest.posts[1]?.payload as Record<string, unknown>)));
});

test('SupabaseClientService falls back to legacy text_runs insert when dataset_ref column is unavailable', async () => {
  const rest = new FakeRestClient();
  const svc = createService(rest);

  let firstInsert = true;
  rest.postHandler = async (path) => {
    if (path === 'text_runs' && firstInsert) {
      firstInsert = false;
      throw createSupabaseError(400, 'PGRST204', "Could not find the 'dataset_ref' column of 'text_runs' in the schema cache");
    }
  };

  const result = await svc.safeInsertRunEvent({
    ...createFillEvent(13),
    payload: {
      strategyId: 'STRAT_A',
      strategyVersion: 'v2',
      market: 'KRW-XRP',
      side: 'BUY',
      qty: 1,
      fillPrice: 101,
      datasetRef: createDatasetRef({
        market: 'KRW-XRP',
        timeframes: ['15m'],
        feeds: ['candle:15m'],
        dateRangeLabel: '2026-02',
        exact: true
      })
    }
  });

  assert.equal(result.ok, true);
  assert.equal(rest.posts.filter((entry) => entry.path === 'text_runs').length, 2);
  assert.ok(!('dataset_ref' in (rest.posts[1]?.payload as Record<string, unknown>)));
});

test('SupabaseClientService still inserts text_fills when text_run_events already contains the seq', async () => {
  const rest = new FakeRestClient();
  const svc = createService(rest);

  rest.postHandler = async (path) => {
    if (path === 'text_run_events') {
      throw createSupabaseError(409, '23505', 'duplicate key value violates unique constraint');
    }
  };

  const result = await svc.safeInsertRunEvent(createFillEvent(7));

  assert.equal(result.ok, true);
  assert.deepEqual(rest.posts.map((entry) => entry.path), ['text_runs', 'text_run_events', 'text_fills']);
});

test('SupabaseClientService falls back to text_run_events when text_fills is unavailable', async () => {
  const rest = new FakeRestClient();
  const svc = createService(rest);

  rest.getHandler = async (path) => {
    if (path.startsWith('text_fills?')) {
      throw createSupabaseError(404, 'PGRST205', "Could not find the table 'public.text_fills' in the schema cache");
    }

    return [
      {
        run_id: 'run-strat-b-0001',
        seq: 3,
        event_type: 'FILL',
        event_ts: new Date(1_700_000_003_000).toISOString(),
        payload: {
          side: 'SELL',
          fillPrice: 105,
          qty: 2
        }
      }
    ];
  };

  const rows = await svc.listStrategyFillEvents('STRAT_B', 1, 50);

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.eventType, 'FILL');
  assert.equal(rows[0]?.payload.side, 'SELL');
  assert.ok(rest.gets.some((path) => path.startsWith('text_fills?')));
  assert.ok(rest.gets.some((path) => path.startsWith('text_run_events?')));
});

test('SupabaseClientService reads persisted entryPolicy from text_runs', async () => {
  const rest = new FakeRestClient();
  const svc = createService(rest);

  rest.getHandler = async () => ([
    {
      run_id: 'run-persisted',
      strategy_id: 'STRAT_B',
      strategy_version: 'v3',
      mode: 'SEMI_AUTO',
      market: 'KRW-BTC',
      fill_model_requested: 'AUTO',
      fill_model_applied: 'NEXT_OPEN',
      entry_policy: { key: 'B_SEMI_AUTO_NEXT_OPEN_AFTER_APPROVAL' },
      created_at: '2026-03-08T00:00:00.000Z',
      updated_at: '2026-03-08T00:05:00.000Z'
    }
  ]);

  const row = await svc.getRun('run-persisted');

  assert.equal(row?.entryPolicy, 'B_SEMI_AUTO_NEXT_OPEN_AFTER_APPROVAL');
  assert.ok(rest.gets.some((path) => path.includes('entry_policy')));
});

test('SupabaseClientService falls back to legacy text_runs select when entry_policy column is unavailable', async () => {
  const rest = new FakeRestClient();
  const svc = createService(rest);

  let firstQuery = true;
  rest.getHandler = async (path) => {
    if (firstQuery && path.includes('entry_policy')) {
      firstQuery = false;
      throw createSupabaseError(400, 'PGRST204', "Could not find the 'entry_policy' column of 'text_runs' in the schema cache");
    }

    return [
      {
        run_id: 'run-legacy-shell',
        strategy_id: 'STRAT_A',
        strategy_version: 'v1',
        mode: 'PAPER',
        market: 'KRW-XRP',
        fill_model_requested: 'AUTO',
        fill_model_applied: 'NEXT_OPEN',
        created_at: '2026-03-08T00:00:00.000Z',
        updated_at: '2026-03-08T00:01:00.000Z'
      }
    ];
  };

  const row = await svc.getRun('run-legacy-shell');

  assert.equal(row?.runId, 'run-legacy-shell');
  assert.equal(rest.gets.length, 2);
  assert.ok(!rest.gets[1]?.includes('entry_policy'));
});

test('SupabaseClientService falls back to legacy text_runs select when dataset_ref column is unavailable', async () => {
  const rest = new FakeRestClient();
  const svc = createService(rest);

  let firstQuery = true;
  rest.getHandler = async (path) => {
    if (firstQuery && path.includes('dataset_ref')) {
      firstQuery = false;
      throw createSupabaseError(400, 'PGRST204', "Could not find the 'dataset_ref' column of 'text_runs' in the schema cache");
    }

    return [
      {
        run_id: 'run-legacy-dataset',
        strategy_id: 'STRAT_C',
        strategy_version: 'v1',
        mode: 'PAPER',
        market: 'KRW-XRP',
        fill_model_requested: 'AUTO',
        fill_model_applied: 'NEXT_MINUTE_OPEN',
        entry_policy: { key: 'C_NEXT_MINUTE_OPEN' },
        created_at: '2026-03-08T00:00:00.000Z',
        updated_at: '2026-03-08T00:01:00.000Z'
      }
    ];
  };

  const row = await svc.getRun('run-legacy-dataset');

  assert.equal(row?.runId, 'run-legacy-dataset');
  assert.equal(row?.datasetRef, undefined);
  assert.equal(rest.gets.length, 2);
  assert.ok(!rest.gets[1]?.includes('dataset_ref'));
});

test('SupabaseClientService persists entryPolicy during run control updates', async () => {
  const rest = new FakeRestClient();
  const svc = createService(rest);

  await svc.updateRunShell('run-control', {
    strategyId: 'STRAT_B',
    fillModelRequested: 'AUTO',
    fillModelApplied: 'ON_CLOSE',
    entryPolicy: 'B_POI_TOUCH_CONFIRM_ON_CLOSE'
  });

  assert.equal(rest.patches[0]?.path, 'text_runs?run_id=eq.run-control');
  assert.deepEqual(rest.patches[0]?.payload, {
    strategy_id: 'STRAT_B',
    fill_model_requested: 'AUTO',
    fill_model_applied: 'ON_CLOSE',
    entry_policy: { key: 'B_POI_TOUCH_CONFIRM_ON_CLOSE' },
    updated_at: (rest.patches[0]?.payload as { updated_at: string }).updated_at
  });
  assert.equal(typeof (rest.patches[0]?.payload as { updated_at?: string }).updated_at, 'string');
});

test('SupabaseClientService falls back to legacy text_runs patch when entry_policy column is unavailable', async () => {
  const rest = new FakeRestClient();
  const svc = createService(rest);

  let firstPatch = true;
  rest.patchHandler = async (_path, payload) => {
    if (firstPatch && 'entry_policy' in (payload as Record<string, unknown>)) {
      firstPatch = false;
      throw createSupabaseError(400, 'PGRST204', "Could not find the 'entry_policy' column of 'text_runs' in the schema cache");
    }
  };

  await svc.updateRunShell('run-control-legacy', {
    strategyId: 'STRAT_B',
    fillModelRequested: 'AUTO',
    fillModelApplied: 'NEXT_OPEN',
    entryPolicy: 'B_SEMI_AUTO_NEXT_OPEN_AFTER_APPROVAL'
  });

  assert.equal(rest.patches.length, 2);
  assert.ok(!('entry_policy' in (rest.patches[1]?.payload as Record<string, unknown>)));
});

test('SupabaseClientService falls back to legacy text_runs patch when dataset_ref column is unavailable', async () => {
  const rest = new FakeRestClient();
  const svc = createService(rest);

  let firstPatch = true;
  rest.patchHandler = async (_path, payload) => {
    if (firstPatch && 'dataset_ref' in (payload as Record<string, unknown>)) {
      firstPatch = false;
      throw createSupabaseError(400, 'PGRST204', "Could not find the 'dataset_ref' column of 'text_runs' in the schema cache");
    }
  };

  await svc.updateRunShell('run-control-legacy-dataset', {
    strategyId: 'STRAT_A',
    datasetRef: createDatasetRef({
      market: 'KRW-XRP',
      timeframes: ['15m'],
      feeds: ['candle:15m'],
      dateRangeLabel: '2026-02',
      exact: true
    })
  });

  assert.equal(rest.patches.length, 2);
  assert.ok(!('dataset_ref' in (rest.patches[1]?.payload as Record<string, unknown>)));
});

test('SupabaseClientService replaces persisted trades and run report rows', async () => {
  const rest = new FakeRestClient();
  const svc = createService(rest);

  await svc.syncRunArtifacts({
    runId: 'run-sync-1',
    trades: [
      {
        trade_id: 'run-sync-1:T-0001',
        run_id: 'run-sync-1',
        entry_ts: '2026-03-08T00:00:00.000Z',
        exit_ts: '2026-03-08T00:05:00.000Z',
        entry_price: 100,
        exit_price: 102.5,
        qty: 2,
        notional_krw: 200,
        exit_reason: 'TP1',
        gross_return_pct: 2.5,
        net_return_pct: 2.3976,
        bars_delay: 0
      }
    ],
    report: {
      runId: 'run-sync-1',
      createdAt: '2026-03-08T00:00:00.000Z',
      strategy: {
        strategyId: 'STRAT_A',
        strategyVersion: 'v1'
      },
      dataset: {
        market: 'KRW-XRP',
        timeframes: ['15m'],
        datasetRef: createDatasetRef({
          market: 'KRW-XRP',
          timeframes: ['15m'],
          feeds: ['candle:15m'],
          dateRangeLabel: 'doc-window',
          exact: true
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
        slippageAssumedPct: 0.0005
      },
      risk: {
        seedKrw: 1_000_000,
        maxPositionRatio: 0.2,
        dailyLossLimitPct: 0.05,
        maxConsecutiveLosses: 3,
        maxDailyOrders: 20,
        killSwitch: false
      },
      results: {
        trades: {
          count: 1,
          exits: 1,
          winCount: 1,
          lossCount: 0,
          winRate: 100,
          profitFactor: 99,
          avgWinPct: 2.3976,
          avgLossPct: 0,
          sumReturnPct: 2.3976
        },
        pnl: {
          totalKrw: 4.8,
          mddPct: 0
        },
        exitReasonBreakdown: {
          TP1: 1
        }
      },
      artifacts: {
        runReportJson: 'run-artifacts/run-sync-1/run_report.json',
        tradesCsv: 'run-artifacts/run-sync-1/trades.csv',
        eventsJsonl: 'run-artifacts/run-sync-1/events.jsonl'
      }
    },
    runReportJson: '{"runId":"run-sync-1"}',
    tradesCsv: 'tradeId,entryTime\nT-0001,2026-03-08T00:00:00.000Z',
    eventsJsonl: '{"eventType":"FILL"}'
  });

  assert.deepEqual(rest.deletes, [
    'text_trades?run_id=eq.run-sync-1',
    'text_run_reports?run_id=eq.run-sync-1'
  ]);
  assert.equal(rest.patches[0]?.path, 'text_runs?run_id=eq.run-sync-1');
  assert.deepEqual(rest.patches[0]?.payload, {
    dataset_ref: {
      key: 'UPBIT|REPLAY_BACKTEST|KRW-XRP|15m|candle:15m|doc-window|||exact',
      source: 'UPBIT',
      profile: 'REPLAY_BACKTEST',
      market: 'KRW-XRP',
      timeframes: ['15m'],
      feeds: ['candle:15m'],
      dateRangeLabel: 'doc-window',
      exact: true
    },
    updated_at: (rest.patches[0]?.payload as { updated_at: string }).updated_at
  });
  assert.equal(rest.posts[0]?.path, 'text_trades');
  assert.equal(rest.posts[1]?.path, 'text_run_reports');
  assert.deepEqual(rest.posts[0]?.payload, [
    {
      trade_id: 'run-sync-1:T-0001',
      run_id: 'run-sync-1',
      entry_ts: '2026-03-08T00:00:00.000Z',
      exit_ts: '2026-03-08T00:05:00.000Z',
      entry_price: 100,
      exit_price: 102.5,
      qty: 2,
      notional_krw: 200,
      exit_reason: 'TP1',
      gross_return_pct: 2.5,
      net_return_pct: 2.3976,
      bars_delay: 0
    }
  ]);
  assert.deepEqual(rest.posts[1]?.payload, {
    run_id: 'run-sync-1',
    kpi: {
      count: 1,
      exits: 1,
      winCount: 1,
      lossCount: 0,
      winRate: 100,
      profitFactor: 99,
      avgWinPct: 2.3976,
      avgLossPct: 0,
      sumReturnPct: 2.3976,
      totalKrw: 4.8,
      mddPct: 0
    },
    exit_reason_breakdown: {
      TP1: 1
    },
    artifact_manifest: {
      runReportJson: 'run-artifacts/run-sync-1/run_report.json',
      tradesCsv: 'run-artifacts/run-sync-1/trades.csv',
      eventsJsonl: 'run-artifacts/run-sync-1/events.jsonl'
    },
    created_at: '2026-03-08T00:00:00.000Z'
  });
  assert.deepEqual(rest.uploads, [
    {
      bucket: 'run-artifacts',
      objectPath: 'run-sync-1/run_report.json',
      body: '{"runId":"run-sync-1"}',
      contentType: 'application/json; charset=utf-8'
    },
    {
      bucket: 'run-artifacts',
      objectPath: 'run-sync-1/trades.csv',
      body: 'tradeId,entryTime\nT-0001,2026-03-08T00:00:00.000Z',
      contentType: 'text/csv; charset=utf-8'
    },
    {
      bucket: 'run-artifacts',
      objectPath: 'run-sync-1/events.jsonl',
      body: '{"eventType":"FILL"}',
      contentType: 'application/x-ndjson; charset=utf-8'
    }
  ]);
});

test('SupabaseClientService swallows storage upload errors after DB artifact sync', async () => {
  const rest = new FakeRestClient();
  const svc = createService(rest);

  rest.uploadHandler = async () => {
    throw createSupabaseError(404, 'NoSuchBucket', "The resource was not found");
  };

  await svc.syncRunArtifacts({
    runId: 'run-sync-storage-error',
    trades: [],
    report: {
      runId: 'run-sync-storage-error',
      createdAt: '2026-03-08T00:00:00.000Z',
      strategy: {
        strategyId: 'STRAT_C',
        strategyVersion: 'v1'
      },
      dataset: {
        market: 'KRW-XRP',
        timeframes: ['1m'],
        datasetRef: createDatasetRef({
          market: 'KRW-XRP',
          timeframes: ['1m'],
          feeds: ['trade', 'ticker', 'orderbook', 'candle:1m'],
          dateRangeLabel: 'realtime-2026-03',
          exact: false
        })
      },
      execution: {
        mode: 'PAPER',
        entryPolicy: 'C_NEXT_MINUTE_OPEN',
        fillModelRequested: 'AUTO',
        fillModelApplied: 'NEXT_MINUTE_OPEN'
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
          count: 0,
          exits: 0,
          winCount: 0,
          lossCount: 0,
          winRate: 0,
          profitFactor: 0,
          avgWinPct: 0,
          avgLossPct: 0,
          sumReturnPct: 0
        },
        pnl: {
          totalKrw: 0,
          mddPct: 0
        },
        exitReasonBreakdown: {}
      },
      artifacts: {
        runReportJson: 'run-artifacts/run-sync-storage-error/run_report.json',
        tradesCsv: 'run-artifacts/run-sync-storage-error/trades.csv',
        eventsJsonl: 'run-artifacts/run-sync-storage-error/events.jsonl'
      }
    },
    runReportJson: '{}',
    tradesCsv: 'tradeId,entryTime',
    eventsJsonl: ''
  });

  assert.deepEqual(rest.deletes, [
    'text_trades?run_id=eq.run-sync-storage-error',
    'text_run_reports?run_id=eq.run-sync-storage-error'
  ]);
  assert.equal(rest.posts[0]?.path, 'text_run_reports');
  assert.equal(rest.uploads.length, 3);
});

test('SupabaseClientService lists persisted run report summaries', async () => {
  const rest = new FakeRestClient();
  const svc = createService(rest);

  rest.getHandler = async () => ([
    {
      run_id: 'run-report-1',
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
      exit_reason_breakdown: {
        TP1: 3,
        SL: 1
      },
      artifact_manifest: {
        runReportJson: 'runs/run-report-1/run_report.json'
      },
      created_at: '2026-03-08T00:00:00.000Z'
    }
  ]);

  const rows = await svc.listRunReportSummaries(['run-report-1']);

  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    runId: 'run-report-1',
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
      runReportJson: 'runs/run-report-1/run_report.json'
    },
    createdAt: '2026-03-08T00:00:00.000Z'
  });
  assert.ok(rest.gets[0]?.startsWith('text_run_reports?select=run_id,kpi,exit_reason_breakdown,artifact_manifest,created_at&run_id=in.'));
});
