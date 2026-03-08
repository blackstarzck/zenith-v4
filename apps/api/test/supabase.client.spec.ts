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
  readonly gets: string[] = [];
  readonly metas: string[] = [];
  postHandler?: (path: string, payload: unknown) => Promise<void>;
  getHandler?: (path: string) => Promise<unknown[]>;
  getWithMetaHandler?: (path: string) => Promise<Readonly<{ data: unknown[]; contentRange?: string }>>;

  async post(path: string, payload: unknown, _signal: AbortSignal): Promise<void> {
    this.posts.push({ path, payload });
    if (this.postHandler) {
      await this.postHandler(path, payload);
    }
  }

  async patch(): Promise<void> {}

  async delete(): Promise<void> {}

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
