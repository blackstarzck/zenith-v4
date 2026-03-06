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
        },
        {
          maxAttempts: 3,
          baseDelayMs: 100,
          timeoutMs: 2000,
          source: 'infra.db.supabase.safeInsertRunEvent',
          timeoutEventType: SYSTEM_EVENT_TYPE.SUPABASE_TIMEOUT,
          retryFailedEventType: SYSTEM_EVENT_TYPE.SUPABASE_WRITE_FAILED,
          isNonRetriable: isDuplicateSupabaseError
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

function isDuplicateSupabaseError(error: unknown): boolean {
  const parsed = parseSupabaseError(error);
  return parsed.code === '23505' || parsed.message.includes('duplicate key value');
}
