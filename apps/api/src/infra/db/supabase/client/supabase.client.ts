import { SYSTEM_EVENT_TYPE, type WsEventEnvelopeDto } from '@zenith/contracts';
import { Injectable } from '@nestjs/common';
import { AxiosError } from 'axios';
import { SupabaseRestClient } from '../../../../modules/supabase/supabase-rest.client';
import { SystemEventLogger } from '../../../../modules/observability/system-events/system-event.logger';
import { RetryPolicyService } from '../../../../modules/resilience/policies/retry.policy';

type SupabaseInsertResult = Readonly<{ ok: boolean; reason?: string }>;
type StrategyId = 'STRAT_A' | 'STRAT_B' | 'STRAT_C';
type RunMode = 'PAPER' | 'SEMI_AUTO' | 'AUTO' | 'LIVE';

export type PersistedRunRow = Readonly<{
  runId: string;
  strategyId: StrategyId;
  strategyVersion: string;
  mode: RunMode;
  market: string;
  fillModelRequested: string;
  fillModelApplied?: string;
  createdAt: string;
  updatedAt?: string;
}>;

type RunShellInsert = Readonly<{
  run_id: string;
  strategy_id: StrategyId;
  strategy_version: string;
  mode: RunMode;
  market: string;
  timeframes: readonly string[];
  fill_model_requested: string;
}>;

type RunShellUpdate = Readonly<{
  strategy_id?: StrategyId;
  strategy_version?: string;
  mode?: RunMode;
  market?: string;
  fill_model_requested?: string;
  fill_model_applied?: string;
  updated_at?: string;
}>;

type PersistedRunEventRawRow = Readonly<{
  id: number;
  payload: Readonly<Record<string, unknown>>;
}>;

type FillLedgerInsert = Readonly<{
  run_id: string;
  seq: number;
  event_ts: string;
  trace_id: string;
  side: 'BUY' | 'SELL';
  qty: number;
  fill_price: number;
  notional_krw: number;
  payload: Readonly<Record<string, unknown>>;
}>;

@Injectable()
export class SupabaseClientService {
  constructor(
    private readonly rest: SupabaseRestClient,
    private readonly logger: SystemEventLogger,
    private readonly retryPolicy: RetryPolicyService
  ) {}

  async safeInsertRunEvent(event: WsEventEnvelopeDto): Promise<SupabaseInsertResult> {
    try {
      await this.retryPolicy.runWithRetry(
        async (signal) => {
          await this.ensureRunExists(event, signal);
          await this.insertRunEventRow(event, signal);
          await this.insertFillLedgerRowIfNeeded(event, signal);
        },
        {
          maxAttempts: 3,
          baseDelayMs: 100,
          timeoutMs: 2000,
          source: 'infra.db.supabase.safeInsertRunEvent',
          timeoutEventType: SYSTEM_EVENT_TYPE.SUPABASE_TIMEOUT,
          retryFailedEventType: SYSTEM_EVENT_TYPE.SUPABASE_WRITE_FAILED
        }
      );

      return { ok: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'unknown';
      const parsed = parseSupabaseError(error);
      const duplicate = isDuplicateSupabaseError(error) || message.includes('duplicate key value');
      const missingParentRun =
        parsed.code === '23503' &&
        parsed.message.includes('text_run_events_run_id_fkey');
      const forbidden = parsed.status === 401 || parsed.status === 403;
      const badRequest = parsed.status === 400;
      const notFound = parsed.status === 404;

      if (duplicate) {
        return { ok: true, reason: 'duplicate' };
      }

      if (missingParentRun) {
        this.logger.error('Run row missing before event insert', {
          source: 'infra.db.supabase.safeInsertRunEvent',
          eventType: SYSTEM_EVENT_TYPE.SUPABASE_WRITE_FAILED,
          runId: event.runId,
          traceId: event.traceId,
          payload: { seq: event.seq, code: parsed.code, reason: parsed.message || message }
        });
        return { ok: false, reason: 'missing_parent_run' };
      }

      if (forbidden || badRequest) {
        this.logger.error('Supabase permission/schema error', {
          source: 'infra.db.supabase.safeInsertRunEvent',
          eventType: SYSTEM_EVENT_TYPE.SUPABASE_WRITE_FAILED,
          runId: event.runId,
          traceId: event.traceId,
          payload: {
            seq: event.seq,
            status: parsed.status,
            code: parsed.code,
            hint: parsed.hint,
            reason: parsed.message || message
          }
        });
        return { ok: false, reason: 'policy_or_schema_error' };
      }

      if (notFound) {
        this.logger.error('Supabase REST endpoint/table not found', {
          source: 'infra.db.supabase.safeInsertRunEvent',
          eventType: SYSTEM_EVENT_TYPE.SUPABASE_WRITE_FAILED,
          runId: event.runId,
          traceId: event.traceId,
          payload: {
            seq: event.seq,
            status: parsed.status,
            code: parsed.code,
            reason: parsed.message || message
          }
        });
        return { ok: false, reason: 'endpoint_or_table_not_found' };
      }

      this.logger.error('Supabase write failed', {
        source: 'infra.db.supabase.safeInsertRunEvent',
        eventType: SYSTEM_EVENT_TYPE.SUPABASE_WRITE_FAILED,
        runId: event.runId,
        traceId: event.traceId,
        payload: { seq: event.seq, reason: message }
      });
      return { ok: false, reason: 'write_failed' };
    }
  }

  async listRuns(limit = 30): Promise<readonly PersistedRunRow[]> {
    const ctrl = new AbortController();
    const rows = await this.rest.get<unknown[]>(
      `text_runs?select=run_id,strategy_id,strategy_version,mode,market,fill_model_requested,fill_model_applied,created_at,updated_at&order=created_at.desc&limit=${Math.max(1, Math.min(limit, 100))}`,
      ctrl.signal
    );
    return rows
      .map(parsePersistedRunRow)
      .filter((row): row is PersistedRunRow => row !== undefined);
  }

  async getRun(runId: string): Promise<PersistedRunRow | undefined> {
    const ctrl = new AbortController();
    const rows = await this.rest.get<unknown[]>(
      `text_runs?select=run_id,strategy_id,strategy_version,mode,market,fill_model_requested,fill_model_applied,created_at,updated_at&run_id=eq.${encodeURIComponent(runId)}&limit=1`,
      ctrl.signal
    );
    const first = Array.isArray(rows) ? rows[0] : undefined;
    return parsePersistedRunRow(first);
  }

  async listRunEvents(runId: string, limit = 500): Promise<readonly WsEventEnvelopeDto[]> {
    const ctrl = new AbortController();
    const rows = await this.rest.get<unknown[]>(
      `text_run_events?select=run_id,seq,event_type,event_ts,payload&run_id=eq.${encodeURIComponent(runId)}&order=seq.asc&limit=${Math.max(1, Math.min(limit, 2000))}`,
      ctrl.signal
    );
    return rows
      .map(parsePersistedEventRow)
      .filter((row): row is WsEventEnvelopeDto => row !== undefined);
  }

  async getLatestRunEventByType(runId: string, eventType: string): Promise<WsEventEnvelopeDto | undefined> {
    const ctrl = new AbortController();
    const rows = await this.rest.get<unknown[]>(
      `text_run_events?select=run_id,seq,event_type,event_ts,payload&run_id=eq.${encodeURIComponent(runId)}&event_type=eq.${encodeURIComponent(eventType)}&order=event_ts.desc,seq.desc,id.desc&limit=1`,
      ctrl.signal
    );
    const first = Array.isArray(rows) ? rows[0] : undefined;
    return parsePersistedEventRow(first);
  }

  async listStrategyFillEvents(
    strategyId: StrategyId,
    page: number,
    pageSize: number
  ): Promise<readonly WsEventEnvelopeDto[]> {
    try {
      return await this.listStrategyFillEventsFromLedger(strategyId, page, pageSize);
    } catch (error: unknown) {
      if (!isMissingFillLedgerError(error)) {
        throw error;
      }
    }

    return this.listStrategyFillEventsFromRunEvents(strategyId, page, pageSize);
  }

  async listAllStrategyFillEvents(strategyId: StrategyId): Promise<readonly WsEventEnvelopeDto[]> {
    const pageSize = 200;
    let page = 1;
    const items: WsEventEnvelopeDto[] = [];

    while (true) {
      const chunk = await this.listStrategyFillEvents(strategyId, page, pageSize);
      if (chunk.length === 0) {
        break;
      }
      items.push(...chunk);
      if (chunk.length < pageSize) {
        break;
      }
      page += 1;
    }

    return items;
  }

  async countStrategyFillEvents(strategyId: StrategyId): Promise<number> {
    try {
      return await this.countStrategyFillEventsFromLedger(strategyId);
    } catch (error: unknown) {
      if (!isMissingFillLedgerError(error)) {
        throw error;
      }
    }

    return this.countStrategyFillEventsFromRunEvents(strategyId);
  }

  async purgeInvalidFillEvents(): Promise<Readonly<{ deleted: number; scanned: number }>> {
    const batchSize = 1000;
    let lastSeenId = 0;
    let scanned = 0;
    let deleted = 0;

    while (true) {
      const ctrl = new AbortController();
      const rows = await this.rest.get<unknown[]>(
        `text_run_events?select=id,payload&event_type=eq.FILL&id=gt.${lastSeenId}&order=id.asc&limit=${batchSize}`,
        ctrl.signal
      );
      const parsed = rows
        .map(parseRunEventRawRow)
        .filter((row): row is PersistedRunEventRawRow => row !== undefined);
      if (parsed.length === 0) {
        break;
      }

      scanned += parsed.length;
      lastSeenId = parsed[parsed.length - 1]?.id ?? lastSeenId;
      const invalidIds = parsed
        .filter((row) => {
          const side = row.payload.side;
          const fillPrice = row.payload.fillPrice;
          const hasValidSide = typeof side === 'string' && side.trim().length > 0;
          const hasValidFillPrice = typeof fillPrice === 'number' && Number.isFinite(fillPrice);
          return !(hasValidSide && hasValidFillPrice);
        })
        .map((row) => row.id);

      if (invalidIds.length > 0) {
        const chunkSize = 200;
        for (let index = 0; index < invalidIds.length; index += chunkSize) {
          const chunk = invalidIds.slice(index, index + chunkSize);
          const filter = chunk.join(',');
          const deleteCtrl = new AbortController();
          await this.rest.delete(`text_run_events?id=in.(${filter})`, deleteCtrl.signal);
          deleted += chunk.length;
        }
      }

      if (parsed.length < batchSize) {
        break;
      }
    }

    return { deleted, scanned };
  }

  async getLastRunEventSeq(runId: string): Promise<number> {
    const ctrl = new AbortController();
    const rows = await this.rest.get<unknown[]>(
      `text_run_events?select=seq&run_id=eq.${encodeURIComponent(runId)}&order=seq.desc&limit=1`,
      ctrl.signal
    );
    const first = Array.isArray(rows) ? rows[0] : undefined;
    if (!first || typeof first !== 'object' || Array.isArray(first)) {
      return 0;
    }
    const seq = (first as Record<string, unknown>).seq;
    return typeof seq === 'number' && Number.isFinite(seq) ? seq : 0;
  }

  async updateRunShell(
    runId: string,
    input: Readonly<{
      strategyId?: StrategyId;
      strategyVersion?: string;
      mode?: RunMode;
      market?: string;
      fillModelRequested?: string;
      fillModelApplied?: string;
    }>
  ): Promise<void> {
    const payload: RunShellUpdate = {
      ...(input.strategyId ? { strategy_id: input.strategyId } : {}),
      ...(input.strategyVersion ? { strategy_version: input.strategyVersion } : {}),
      ...(input.mode ? { mode: input.mode } : {}),
      ...(input.market ? { market: input.market } : {}),
      ...(input.fillModelRequested ? { fill_model_requested: input.fillModelRequested } : {}),
      ...(input.fillModelApplied ? { fill_model_applied: input.fillModelApplied } : {}),
      updated_at: new Date().toISOString()
    };

    if (Object.keys(payload).length === 0) {
      return;
    }

    const ctrl = new AbortController();
    try {
      await this.rest.patch(
        `text_runs?run_id=eq.${encodeURIComponent(runId)}`,
        payload,
        ctrl.signal
      );
    } catch (error: unknown) {
      const parsed = parseSupabaseError(error);
      this.logger.warn('Run control persistence skipped', {
        source: 'infra.db.supabase.updateRunShell',
        eventType: SYSTEM_EVENT_TYPE.SUPABASE_WRITE_FAILED,
        runId,
        payload: {
          status: parsed.status,
          code: parsed.code,
          hint: parsed.hint,
          reason: parsed.message
        }
      });
    }
  }

  private async listStrategyFillEventsFromLedger(
    strategyId: StrategyId,
    page: number,
    pageSize: number
  ): Promise<readonly WsEventEnvelopeDto[]> {
    const ctrl = new AbortController();
    const safePage = Math.max(1, Math.floor(page));
    const safePageSize = Math.max(1, Math.min(Math.floor(pageSize), 200));
    const offset = (safePage - 1) * safePageSize;
    const rows = await this.rest.get<unknown[]>(
      `text_fills?select=run_id,seq,event_ts,trace_id,payload,side,qty,fill_price,text_runs!inner(strategy_id)&text_runs.strategy_id=eq.${encodeURIComponent(strategyId)}&order=event_ts.desc,seq.desc,id.desc&limit=${safePageSize}&offset=${offset}`,
      ctrl.signal
    );
    return rows
      .map(parsePersistedFillRow)
      .filter((row): row is WsEventEnvelopeDto => row !== undefined);
  }

  private async listStrategyFillEventsFromRunEvents(
    strategyId: StrategyId,
    page: number,
    pageSize: number
  ): Promise<readonly WsEventEnvelopeDto[]> {
    const ctrl = new AbortController();
    const safePage = Math.max(1, Math.floor(page));
    const safePageSize = Math.max(1, Math.min(Math.floor(pageSize), 200));
    const offset = (safePage - 1) * safePageSize;
    const rows = await this.rest.get<unknown[]>(
      `text_run_events?select=run_id,seq,event_type,event_ts,payload,text_runs!inner(strategy_id)&event_type=eq.FILL&text_runs.strategy_id=eq.${encodeURIComponent(strategyId)}&order=event_ts.desc,seq.desc,id.desc&limit=${safePageSize}&offset=${offset}`,
      ctrl.signal
    );
    return rows
      .map(parsePersistedEventRow)
      .filter((row): row is WsEventEnvelopeDto => row !== undefined);
  }

  private async countStrategyFillEventsFromLedger(strategyId: StrategyId): Promise<number> {
    const ctrl = new AbortController();
    const { contentRange } = await this.rest.getWithMeta<unknown[]>(
      `text_fills?select=id,text_runs!inner(strategy_id)&text_runs.strategy_id=eq.${encodeURIComponent(strategyId)}&limit=1`,
      ctrl.signal,
      { countExact: true }
    );
    if (!contentRange) {
      return 0;
    }
    const slashIndex = contentRange.lastIndexOf('/');
    if (slashIndex < 0) {
      return 0;
    }
    const totalText = contentRange.slice(slashIndex + 1);
    const total = Number(totalText);
    return Number.isFinite(total) ? total : 0;
  }

  private async countStrategyFillEventsFromRunEvents(strategyId: StrategyId): Promise<number> {
    const ctrl = new AbortController();
    const { contentRange } = await this.rest.getWithMeta<unknown[]>(
      `text_run_events?select=id,text_runs!inner(strategy_id)&event_type=eq.FILL&text_runs.strategy_id=eq.${encodeURIComponent(strategyId)}&limit=1`,
      ctrl.signal,
      { countExact: true }
    );
    if (!contentRange) {
      return 0;
    }
    const slashIndex = contentRange.lastIndexOf('/');
    if (slashIndex < 0) {
      return 0;
    }
    const totalText = contentRange.slice(slashIndex + 1);
    const total = Number(totalText);
    return Number.isFinite(total) ? total : 0;
  }

  private async insertRunEventRow(event: WsEventEnvelopeDto, signal: AbortSignal): Promise<void> {
    try {
      await this.rest.post(
        'text_run_events',
        {
          run_id: event.runId,
          seq: event.seq,
          event_type: event.eventType,
          event_ts: event.eventTs,
          payload: event.payload
        },
        signal
      );
    } catch (error: unknown) {
      if (isDuplicateSupabaseError(error)) {
        return;
      }
      throw error;
    }
  }

  private async insertFillLedgerRowIfNeeded(event: WsEventEnvelopeDto, signal: AbortSignal): Promise<void> {
    const payload = buildFillLedgerInsert(event);
    if (!payload) {
      return;
    }

    try {
      await this.rest.post('text_fills', payload, signal);
    } catch (error: unknown) {
      if (isDuplicateSupabaseError(error)) {
        return;
      }
      if (isMissingFillLedgerError(error)) {
        const parsed = parseSupabaseError(error);
        this.logger.warn('Fill ledger persistence skipped because text_fills is unavailable', {
          source: 'infra.db.supabase.safeInsertRunEvent',
          eventType: SYSTEM_EVENT_TYPE.SUPABASE_WRITE_FAILED,
          runId: event.runId,
          traceId: event.traceId,
          payload: {
            seq: event.seq,
            status: parsed.status,
            code: parsed.code,
            hint: parsed.hint,
            reason: parsed.message
          }
        });
        return;
      }
      throw error;
    }
  }

  private async ensureRunExists(event: WsEventEnvelopeDto, signal: AbortSignal): Promise<void> {
    try {
      await this.rest.post('text_runs', buildRunShellInsert(event), signal);
    } catch (error: unknown) {
      const parsed = parseSupabaseError(error);
      const duplicate = isDuplicateSupabaseError(error);
      const forbiddenInsert =
        parsed.status === 401 ||
        parsed.status === 403 ||
        (parsed.code === '42501' && parsed.message.includes('permission denied for table text_runs'));

      if (duplicate) {
        return;
      }

      if (forbiddenInsert) {
        this.logger.warn('Run bootstrap skipped due to text_runs permission; continuing event insert', {
          source: 'infra.db.supabase.safeInsertRunEvent',
          eventType: SYSTEM_EVENT_TYPE.SUPABASE_WRITE_RETRY,
          runId: event.runId,
          traceId: event.traceId,
          payload: { code: parsed.code, status: parsed.status, reason: parsed.message }
        });
        return;
      }

      throw error;
    }
  }
}

type ParsedSupabaseError = Readonly<{
  status?: number;
  code?: string;
  message: string;
  hint?: string;
}>;

function parseSupabaseError(error: unknown): ParsedSupabaseError {
  if (!(error instanceof AxiosError)) {
    return {
      message: error instanceof Error ? error.message : 'unknown'
    };
  }

  const body = (error.response?.data ?? {}) as Record<string, unknown>;
  return {
    ...(typeof error.response?.status === 'number' ? { status: error.response.status } : {}),
    ...(typeof body.code === 'string' ? { code: body.code } : {}),
    message:
      typeof body.message === 'string'
        ? body.message
        : error.message,
    ...(typeof body.hint === 'string' ? { hint: body.hint } : {})
  };
}

function buildRunShellInsert(event: WsEventEnvelopeDto): RunShellInsert {
  const payload = toRecord(event.payload);

  return {
    run_id: event.runId,
    strategy_id: parseStrategyId(payload.strategyId) ?? parseStrategyId(payload.strategy_id) ?? 'STRAT_A',
    strategy_version: readString(payload, ['strategyVersion', 'strategy_version']) ?? 'unknown',
    mode: parseRunMode(payload.mode) ?? 'PAPER',
    market: readString(payload, ['market']) ?? 'UNKNOWN',
    timeframes: readStringArray(payload, ['timeframes', 'timeFrames']) ?? [],
    fill_model_requested:
      readString(payload, ['fillModelRequested', 'fill_model_requested']) ??
      'AUTO'
  };
}

function toRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function readString(payload: Readonly<Record<string, unknown>>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
}

function readStringArray(
  payload: Readonly<Record<string, unknown>>,
  keys: readonly string[]
): readonly string[] | undefined {
  for (const key of keys) {
    const value = payload[key];
    if (Array.isArray(value)) {
      const normalized = value.filter((item): item is string => typeof item === 'string');
      if (normalized.length > 0) {
        return normalized;
      }
    }
  }
  return undefined;
}

function parseStrategyId(value: unknown): StrategyId | undefined {
  return value === 'STRAT_A' || value === 'STRAT_B' || value === 'STRAT_C'
    ? value
    : undefined;
}

function parseRunMode(value: unknown): RunMode | undefined {
  return value === 'PAPER' || value === 'SEMI_AUTO' || value === 'AUTO' || value === 'LIVE'
    ? value
    : undefined;
}

function parsePersistedRunRow(value: unknown): PersistedRunRow | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const row = value as Record<string, unknown>;
  const runId = row.run_id;
  const strategyId = parseStrategyId(row.strategy_id);
  const strategyVersion = row.strategy_version;
  const mode = parseRunMode(row.mode);
  const market = row.market;
  const fillModelRequested = row.fill_model_requested;
  const createdAt = row.created_at;
  const fillModelApplied = row.fill_model_applied;
  const updatedAt = row.updated_at;

  if (
    typeof runId !== 'string' ||
    !strategyId ||
    typeof strategyVersion !== 'string' ||
    !mode ||
    typeof market !== 'string' ||
    typeof fillModelRequested !== 'string' ||
    typeof createdAt !== 'string'
  ) {
    return undefined;
  }

  return {
    runId,
    strategyId,
    strategyVersion,
    mode,
    market,
    fillModelRequested,
    ...(typeof fillModelApplied === 'string' ? { fillModelApplied } : {}),
    createdAt,
    ...(typeof updatedAt === 'string' ? { updatedAt } : {})
  };
}

function parsePersistedEventRow(value: unknown): WsEventEnvelopeDto | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const row = value as Record<string, unknown>;
  const runId = row.run_id;
  const seq = row.seq;
  const eventType = row.event_type;
  const eventTs = row.event_ts;
  const payload = row.payload;

  if (
    typeof runId !== 'string' ||
    typeof seq !== 'number' ||
    typeof eventType !== 'string' ||
    typeof eventTs !== 'string'
  ) {
    return undefined;
  }

  return {
    runId,
    seq,
    traceId: `persisted-${runId}-${seq}`,
    eventType,
    eventTs,
    payload: toRecord(payload)
  };
}

function parsePersistedFillRow(value: unknown): WsEventEnvelopeDto | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const row = value as Record<string, unknown>;
  const runId = row.run_id;
  const seq = row.seq;
  const eventTs = row.event_ts;
  const traceId = row.trace_id;
  const payload = toRecord(row.payload);
  const side = row.side;
  const qty = row.qty;
  const fillPrice = row.fill_price;

  if (
    typeof runId !== 'string' ||
    typeof seq !== 'number' ||
    typeof eventTs !== 'string'
  ) {
    return undefined;
  }

  return {
    runId,
    seq,
    traceId: typeof traceId === 'string' ? traceId : `persisted-fill-${runId}-${seq}`,
    eventType: 'FILL',
    eventTs,
    payload: {
      ...payload,
      ...(typeof side === 'string' ? { side } : {}),
      ...(typeof qty === 'number' && Number.isFinite(qty) ? { qty } : {}),
      ...(typeof fillPrice === 'number' && Number.isFinite(fillPrice) ? { fillPrice } : {})
    }
  };
}

function parseRunEventRawRow(value: unknown): PersistedRunEventRawRow | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const row = value as Record<string, unknown>;
  const id = row.id;
  const payload = row.payload;
  if (typeof id !== 'number' || !Number.isFinite(id)) {
    return undefined;
  }
  return {
    id,
    payload: toRecord(payload)
  };
}

function isDuplicateSupabaseError(error: unknown): boolean {
  const parsed = parseSupabaseError(error);
  return parsed.code === '23505' || parsed.message.includes('duplicate key value');
}

function buildFillLedgerInsert(event: WsEventEnvelopeDto): FillLedgerInsert | undefined {
  if (event.eventType !== 'FILL') {
    return undefined;
  }

  const payload = toRecord(event.payload);
  const side = normalizeFillSide(payload.side);
  const fillPrice = payload.fillPrice;
  if (!side || typeof fillPrice !== 'number' || !Number.isFinite(fillPrice)) {
    return undefined;
  }

  return {
    run_id: event.runId,
    seq: event.seq,
    event_ts: event.eventTs,
    trace_id: event.traceId,
    side,
    qty: resolveFillQty(payload),
    fill_price: fillPrice,
    notional_krw: resolveFillNotionalKrw(payload, fillPrice),
    payload
  };
}

function normalizeFillSide(value: unknown): 'BUY' | 'SELL' | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim().toUpperCase();
  return normalized === 'BUY' || normalized === 'SELL'
    ? normalized
    : undefined;
}

function resolveFillQty(payload: Readonly<Record<string, unknown>>): number {
  const qty = payload.qty;
  if (typeof qty === 'number' && Number.isFinite(qty) && qty > 0) {
    return qty;
  }

  const quantity = payload.quantity;
  if (typeof quantity === 'number' && Number.isFinite(quantity) && quantity > 0) {
    return quantity;
  }

  return 1;
}

function resolveFillNotionalKrw(
  payload: Readonly<Record<string, unknown>>,
  fillPrice: number
): number {
  const notionalKrw = payload.notionalKrw;
  if (typeof notionalKrw === 'number' && Number.isFinite(notionalKrw) && notionalKrw > 0) {
    return roundMoney(notionalKrw);
  }

  return roundMoney(fillPrice * resolveFillQty(payload));
}

function roundMoney(value: number): number {
  return Number(value.toFixed(2));
}

function isMissingFillLedgerError(error: unknown): boolean {
  const parsed = parseSupabaseError(error);
  return parsed.status === 404 && parsed.message.toLowerCase().includes('text_fills');
}
