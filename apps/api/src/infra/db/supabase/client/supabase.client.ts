import { SYSTEM_EVENT_TYPE, type DatasetRefDto, type RunReportDto, type WsEventEnvelopeDto } from '@zenith/contracts';
import { Injectable } from '@nestjs/common';
import { AxiosError } from 'axios';
import { SupabaseRestClient } from '../../../../modules/supabase/supabase-rest.client';
import { SystemEventLogger } from '../../../../modules/observability/system-events/system-event.logger';
import { RetryPolicyService } from '../../../../modules/resilience/policies/retry.policy';

type SupabaseInsertResult = Readonly<{ ok: boolean; reason?: string }>;
type StrategyId = 'STRAT_A' | 'STRAT_B' | 'STRAT_C';
type RunMode = 'PAPER' | 'SEMI_AUTO' | 'AUTO' | 'LIVE';
type EntryPolicySnapshot = Readonly<Record<string, unknown>>;
type DatasetRefSnapshot = Readonly<Record<string, unknown>>;

const RUN_SELECT = 'run_id,strategy_id,strategy_version,mode,market,fill_model_requested,fill_model_applied,entry_policy,dataset_ref,created_at,updated_at';
const RUN_SELECT_NO_DATASET_REF = 'run_id,strategy_id,strategy_version,mode,market,fill_model_requested,fill_model_applied,entry_policy,created_at,updated_at';
const RUN_SELECT_NO_ENTRY_POLICY = 'run_id,strategy_id,strategy_version,mode,market,fill_model_requested,fill_model_applied,dataset_ref,created_at,updated_at';
const RUN_SELECT_LEGACY = 'run_id,strategy_id,strategy_version,mode,market,fill_model_requested,fill_model_applied,created_at,updated_at';

export type PersistedRunRow = Readonly<{
  runId: string;
  strategyId: StrategyId;
  strategyVersion: string;
  mode: RunMode;
  market: string;
  fillModelRequested: string;
  fillModelApplied?: string;
  entryPolicy?: string;
  datasetRef?: DatasetRefDto;
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
  fill_model_applied?: string;
  entry_policy?: EntryPolicySnapshot;
  dataset_ref?: DatasetRefSnapshot;
}>;

type RunShellUpdate = Readonly<{
  strategy_id?: StrategyId;
  strategy_version?: string;
  mode?: RunMode;
  market?: string;
  fill_model_requested?: string;
  fill_model_applied?: string;
  entry_policy?: EntryPolicySnapshot;
  dataset_ref?: DatasetRefSnapshot;
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

export type PersistedTradeInsert = Readonly<{
  trade_id: string;
  run_id: string;
  entry_ts: string;
  exit_ts: string;
  entry_price: number;
  exit_price: number;
  qty: number;
  notional_krw: number;
  exit_reason: string;
  gross_return_pct: number;
  net_return_pct: number;
  bars_delay: number;
}>;

export type PersistedRunReportSummary = Readonly<{
  runId: string;
  kpi: Readonly<{
    count: number;
    exits: number;
    winCount: number;
    lossCount: number;
    winRate: number;
    profitFactor: number;
    avgWinPct: number;
    avgLossPct: number;
    sumReturnPct: number;
    totalKrw: number;
    mddPct: number;
  }>;
  exitReasonBreakdown: Readonly<Record<string, number>>;
  artifactManifest: Readonly<Record<string, unknown>>;
  createdAt: string;
}>;

type PersistedRunReportInsert = Readonly<{
  run_id: string;
  kpi: Readonly<Record<string, unknown>>;
  exit_reason_breakdown: Readonly<Record<string, unknown>>;
  artifact_manifest: Readonly<Record<string, unknown>>;
  created_at: string;
}>;

type ArtifactUpload = Readonly<{
  path: string;
  contentType: string;
  body: string;
}>;

const ARTIFACT_BUCKET = 'run-artifacts';

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
    const rows = await this.getRunShellRows(
      `order=created_at.desc&limit=${Math.max(1, Math.min(limit, 100))}`,
      ctrl.signal
    );
    return rows
      .map(parsePersistedRunRow)
      .filter((row): row is PersistedRunRow => row !== undefined);
  }

  async getRun(runId: string): Promise<PersistedRunRow | undefined> {
    const ctrl = new AbortController();
    const rows = await this.getRunShellRows(
      `run_id=eq.${encodeURIComponent(runId)}&limit=1`,
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

  async listRunReportSummaries(runIds: readonly string[]): Promise<readonly PersistedRunReportSummary[]> {
    if (runIds.length === 0) {
      return [];
    }

    const chunks = chunkStrings(runIds, 100);
    const out: PersistedRunReportSummary[] = [];

    for (const chunk of chunks) {
      const ctrl = new AbortController();
      try {
        const rows = await this.rest.get<unknown[]>(
          `text_run_reports?select=run_id,kpi,exit_reason_breakdown,artifact_manifest,created_at&run_id=in.(${chunk.map((runId) => encodeSupabaseTextLiteral(runId)).join(',')})`,
          ctrl.signal
        );
        out.push(
          ...rows
            .map(parsePersistedRunReportSummaryRow)
            .filter((row): row is PersistedRunReportSummary => row !== undefined)
        );
      } catch (error: unknown) {
        const parsed = parseSupabaseError(error);
        if (isMissingRelationSupabaseError(error, 'text_run_reports')) {
          this.logger.warn('Persisted run report summary query skipped because table is unavailable', {
            source: 'infra.db.supabase.listRunReportSummaries',
            eventType: SYSTEM_EVENT_TYPE.SUPABASE_WRITE_FAILED,
            payload: {
              status: parsed.status,
              code: parsed.code,
              hint: parsed.hint,
              reason: parsed.message
            }
          });
          return [];
        }
        throw error;
      }
    }

    return out;
  }

  async syncRunArtifacts(
    input: Readonly<{
      runId: string;
      trades: readonly PersistedTradeInsert[];
      report: RunReportDto;
      runReportJson: string;
      tradesCsv: string;
      eventsJsonl: string;
    }>
  ): Promise<void> {
    const uploads = buildArtifactUploads(input);
    try {
      await this.retryPolicy.runWithRetry(
        async (signal) => {
          await this.rest.delete(`text_trades?run_id=eq.${encodeURIComponent(input.runId)}`, signal);
          if (input.trades.length > 0) {
            await this.rest.post('text_trades', input.trades, signal);
          }
          await this.patchRunShell(input.runId, {
            dataset_ref: buildDatasetRefSnapshot(input.report.dataset.datasetRef),
            updated_at: new Date().toISOString()
          }, signal);
          await this.rest.delete(`text_run_reports?run_id=eq.${encodeURIComponent(input.runId)}`, signal);
          await this.rest.post('text_run_reports', buildRunReportInsert(input.report), signal);
          await Promise.all(uploads.map((upload) => (
            this.rest.uploadObject(
              ARTIFACT_BUCKET,
              toArtifactObjectPath(upload.path),
              upload.body,
              upload.contentType,
              signal
            )
          )));
        },
        {
          maxAttempts: 3,
          baseDelayMs: 100,
          timeoutMs: 4000,
          source: 'infra.db.supabase.syncRunArtifacts',
          timeoutEventType: SYSTEM_EVENT_TYPE.SUPABASE_TIMEOUT,
          retryFailedEventType: SYSTEM_EVENT_TYPE.SUPABASE_WRITE_FAILED
        }
      );
    } catch (error: unknown) {
      const parsed = parseSupabaseError(error);
      if (isMissingRelationSupabaseError(error, 'text_trades') || isMissingRelationSupabaseError(error, 'text_run_reports')) {
        this.logger.warn('Run artifact persistence skipped because report/trade tables are unavailable', {
          source: 'infra.db.supabase.syncRunArtifacts',
          eventType: SYSTEM_EVENT_TYPE.SUPABASE_WRITE_FAILED,
          runId: input.runId,
          payload: {
            status: parsed.status,
            code: parsed.code,
            hint: parsed.hint,
            reason: parsed.message
          }
        });
        return;
      }

      this.logger.warn('Run artifact persistence skipped after DB/storage error', {
        source: 'infra.db.supabase.syncRunArtifacts',
        eventType: SYSTEM_EVENT_TYPE.SUPABASE_WRITE_FAILED,
        runId: input.runId,
        payload: {
          status: parsed.status,
          code: parsed.code,
          hint: parsed.hint,
          reason: parsed.message
        }
      });
    }
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
      entryPolicy?: string;
      datasetRef?: DatasetRefDto;
    }>
  ): Promise<void> {
    const payloadBase: Omit<RunShellUpdate, 'updated_at'> = {
      ...(input.strategyId ? { strategy_id: input.strategyId } : {}),
      ...(input.strategyVersion ? { strategy_version: input.strategyVersion } : {}),
      ...(input.mode ? { mode: input.mode } : {}),
      ...(input.market ? { market: input.market } : {}),
      ...(input.fillModelRequested ? { fill_model_requested: input.fillModelRequested } : {}),
      ...(input.fillModelApplied ? { fill_model_applied: input.fillModelApplied } : {}),
      ...(input.entryPolicy ? { entry_policy: buildEntryPolicySnapshot(input.entryPolicy) } : {}),
      ...(input.datasetRef ? { dataset_ref: buildDatasetRefSnapshot(input.datasetRef) } : {})
    };

    if (Object.keys(payloadBase).length === 0) {
      return;
    }

    const payload: RunShellUpdate = {
      ...payloadBase,
      updated_at: new Date().toISOString()
    };
    const ctrl = new AbortController();
    try {
      await this.patchRunShell(runId, payload, ctrl.signal);
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
    const payload = buildRunShellInsert(event);
    try {
      await this.postRunShell(payload, signal);
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

  private async getRunShellRows(
    filterQuery: string,
    signal: AbortSignal
  ): Promise<unknown[]> {
    try {
      return await this.rest.get<unknown[]>(
        `text_runs?select=${RUN_SELECT}&${filterQuery}`,
        signal
      );
    } catch (error: unknown) {
      if (isMissingColumnSupabaseError(error, 'entry_policy')) {
        try {
          return await this.rest.get<unknown[]>(
            `text_runs?select=${RUN_SELECT_NO_ENTRY_POLICY}&${filterQuery}`,
            signal
          );
        } catch (legacyError: unknown) {
          if (!isMissingColumnSupabaseError(legacyError, 'dataset_ref')) {
            throw legacyError;
          }
        }
      } else if (isMissingColumnSupabaseError(error, 'dataset_ref')) {
        try {
          return await this.rest.get<unknown[]>(
            `text_runs?select=${RUN_SELECT_NO_DATASET_REF}&${filterQuery}`,
            signal
          );
        } catch (legacyError: unknown) {
          if (!isMissingColumnSupabaseError(legacyError, 'entry_policy')) {
            throw legacyError;
          }
        }
      } else {
        throw error;
      }
    }

    return this.rest.get<unknown[]>(
      `text_runs?select=${RUN_SELECT_LEGACY}&${filterQuery}`,
      signal
    );
  }

  private async postRunShell(payload: RunShellInsert, signal: AbortSignal): Promise<void> {
    try {
      await this.rest.post('text_runs', payload, signal);
      return;
    } catch (error: unknown) {
      if (payload.entry_policy && isMissingColumnSupabaseError(error, 'entry_policy')) {
        try {
          await this.rest.post('text_runs', omitEntryPolicyInsert(payload), signal);
          return;
        } catch (legacyError: unknown) {
          if (!(payload.dataset_ref && isMissingColumnSupabaseError(legacyError, 'dataset_ref'))) {
            throw legacyError;
          }
          await this.rest.post('text_runs', omitDatasetRefInsert(omitEntryPolicyInsert(payload)), signal);
          return;
        }
      }

      if (payload.dataset_ref && isMissingColumnSupabaseError(error, 'dataset_ref')) {
        try {
          await this.rest.post('text_runs', omitDatasetRefInsert(payload), signal);
          return;
        } catch (legacyError: unknown) {
          if (!(payload.entry_policy && isMissingColumnSupabaseError(legacyError, 'entry_policy'))) {
            throw legacyError;
          }
          await this.rest.post('text_runs', omitEntryPolicyInsert(omitDatasetRefInsert(payload)), signal);
          return;
        }
      }
      throw error;
    }
  }

  private async patchRunShell(
    runId: string,
    payload: RunShellUpdate,
    signal: AbortSignal
  ): Promise<void> {
    const path = `text_runs?run_id=eq.${encodeURIComponent(runId)}`;
    try {
      await this.rest.patch(path, payload, signal);
      return;
    } catch (error: unknown) {
      if (payload.entry_policy && isMissingColumnSupabaseError(error, 'entry_policy')) {
        try {
          await this.rest.patch(path, omitEntryPolicyUpdate(payload), signal);
          return;
        } catch (legacyError: unknown) {
          if (!(payload.dataset_ref && isMissingColumnSupabaseError(legacyError, 'dataset_ref'))) {
            throw legacyError;
          }
          await this.rest.patch(path, omitDatasetRefUpdate(omitEntryPolicyUpdate(payload)), signal);
          return;
        }
      }

      if (payload.dataset_ref && isMissingColumnSupabaseError(error, 'dataset_ref')) {
        try {
          await this.rest.patch(path, omitDatasetRefUpdate(payload), signal);
          return;
        } catch (legacyError: unknown) {
          if (!(payload.entry_policy && isMissingColumnSupabaseError(legacyError, 'entry_policy'))) {
            throw legacyError;
          }
          await this.rest.patch(path, omitEntryPolicyUpdate(omitDatasetRefUpdate(payload)), signal);
          return;
        }
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
  const entryPolicy = buildEntryPolicySnapshotFromValue(payload.entryPolicy ?? payload.entry_policy);
  const datasetRef = buildDatasetRefSnapshotFromValue(payload.datasetRef ?? payload.dataset_ref);

  return {
    run_id: event.runId,
    strategy_id: parseStrategyId(payload.strategyId) ?? parseStrategyId(payload.strategy_id) ?? 'STRAT_A',
    strategy_version: readString(payload, ['strategyVersion', 'strategy_version']) ?? 'unknown',
    mode: parseRunMode(payload.mode) ?? 'PAPER',
    market: readString(payload, ['market']) ?? 'UNKNOWN',
    timeframes: readStringArray(payload, ['timeframes', 'timeFrames']) ?? [],
    fill_model_requested:
      readString(payload, ['fillModelRequested', 'fill_model_requested']) ??
      'AUTO',
    ...(readString(payload, ['fillModelApplied', 'fill_model_applied'])
      ? { fill_model_applied: readString(payload, ['fillModelApplied', 'fill_model_applied']) as string }
      : {}),
    ...(entryPolicy ? { entry_policy: entryPolicy } : {}),
    ...(datasetRef ? { dataset_ref: datasetRef } : {})
  };
}

function buildRunReportInsert(report: RunReportDto): PersistedRunReportInsert {
  return {
    run_id: report.runId,
    kpi: {
      ...report.results.trades,
      totalKrw: report.results.pnl.totalKrw,
      mddPct: report.results.pnl.mddPct
    },
    exit_reason_breakdown: report.results.exitReasonBreakdown,
    artifact_manifest: report.artifacts,
    created_at: report.createdAt
  };
}

function buildArtifactUploads(input: Readonly<{
  report: RunReportDto;
  runReportJson: string;
  tradesCsv: string;
  eventsJsonl: string;
}>): readonly ArtifactUpload[] {
  return [
    {
      path: input.report.artifacts.runReportJson,
      contentType: 'application/json; charset=utf-8',
      body: input.runReportJson
    },
    {
      path: input.report.artifacts.tradesCsv,
      contentType: 'text/csv; charset=utf-8',
      body: input.tradesCsv
    },
    {
      path: input.report.artifacts.eventsJsonl,
      contentType: 'application/x-ndjson; charset=utf-8',
      body: input.eventsJsonl
    }
  ];
}

function toArtifactObjectPath(path: string): string {
  const normalized = path.replace(/^\/+/, '');
  if (normalized.startsWith(`${ARTIFACT_BUCKET}/`)) {
    return normalized.slice(ARTIFACT_BUCKET.length + 1);
  }
  return normalized;
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

function readNumber(payload: Readonly<Record<string, unknown>>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
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
  const entryPolicy = parsePersistedEntryPolicy(row.entry_policy);
  const datasetRef = parsePersistedDatasetRef(row.dataset_ref);
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
    ...(typeof entryPolicy === 'string' ? { entryPolicy } : {}),
    ...(datasetRef ? { datasetRef } : {}),
    createdAt,
    ...(typeof updatedAt === 'string' ? { updatedAt } : {})
  };
}

function parsePersistedRunReportSummaryRow(value: unknown): PersistedRunReportSummary | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const row = value as Record<string, unknown>;
  const runId = row.run_id;
  const createdAt = row.created_at;
  const kpi = toRecord(row.kpi);

  if (typeof runId !== 'string' || typeof createdAt !== 'string') {
    return undefined;
  }

  return {
    runId,
    kpi: {
      count: readNumber(kpi, ['count']) ?? 0,
      exits: readNumber(kpi, ['exits']) ?? 0,
      winCount: readNumber(kpi, ['winCount']) ?? 0,
      lossCount: readNumber(kpi, ['lossCount']) ?? 0,
      winRate: readNumber(kpi, ['winRate']) ?? 0,
      profitFactor: readNumber(kpi, ['profitFactor']) ?? 0,
      avgWinPct: readNumber(kpi, ['avgWinPct']) ?? 0,
      avgLossPct: readNumber(kpi, ['avgLossPct']) ?? 0,
      sumReturnPct: readNumber(kpi, ['sumReturnPct']) ?? 0,
      totalKrw: readNumber(kpi, ['totalKrw']) ?? 0,
      mddPct: readNumber(kpi, ['mddPct']) ?? 0
    },
    exitReasonBreakdown: readNumberRecord(row.exit_reason_breakdown),
    artifactManifest: toRecord(row.artifact_manifest),
    createdAt
  };
}

function buildEntryPolicySnapshot(value: string): EntryPolicySnapshot {
  return { key: value };
}

function buildDatasetRefSnapshot(value: DatasetRefDto): DatasetRefSnapshot {
  return {
    key: value.key,
    source: value.source,
    profile: value.profile,
    market: value.market,
    timeframes: value.timeframes,
    feeds: value.feeds,
    dateRangeLabel: value.dateRangeLabel,
    ...(value.windowStart ? { windowStart: value.windowStart } : {}),
    ...(value.windowEnd ? { windowEnd: value.windowEnd } : {}),
    exact: value.exact
  };
}

function buildEntryPolicySnapshotFromValue(value: unknown): EntryPolicySnapshot | undefined {
  if (typeof value === 'string' && value.trim().length > 0) {
    return buildEntryPolicySnapshot(value);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const snapshot = value as Record<string, unknown>;
  const key = readString(snapshot, ['key', 'value', 'entryPolicy', 'entry_policy']);
  if (key) {
    return { ...snapshot, key };
  }
  return Object.keys(snapshot).length > 0 ? snapshot : undefined;
}

function buildDatasetRefSnapshotFromValue(value: unknown): DatasetRefSnapshot | undefined {
  const parsed = parsePersistedDatasetRef(value);
  return parsed ? buildDatasetRefSnapshot(parsed) : undefined;
}

function parsePersistedEntryPolicy(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return readString(value as Record<string, unknown>, ['key', 'value', 'entryPolicy', 'entry_policy']);
}

function parsePersistedDatasetRef(value: unknown): DatasetRefDto | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const snapshot = value as Record<string, unknown>;
  const key = readString(snapshot, ['key']);
  const source = readString(snapshot, ['source']);
  const profile = readString(snapshot, ['profile']);
  const market = readString(snapshot, ['market']);
  const timeframes = readStringArray(snapshot, ['timeframes', 'timeFrames']);
  const feeds = readStringArray(snapshot, ['feeds']);
  const dateRangeLabel = readString(snapshot, ['dateRangeLabel', 'date_range_label']);
  const exact = snapshot.exact;
  const windowStart = readString(snapshot, ['windowStart', 'window_start']);
  const windowEnd = readString(snapshot, ['windowEnd', 'window_end']);

  if (
    !key ||
    (source !== 'UPBIT' && source !== 'CSV_REPLAY' && source !== 'JSONL_REPLAY' && source !== 'MANUAL') ||
    (profile !== 'REALTIME_RUNTIME' && profile !== 'REPLAY_BACKTEST' && profile !== 'DOC_BENCHMARK') ||
    !market ||
    !timeframes ||
    !feeds ||
    !dateRangeLabel ||
    typeof exact !== 'boolean'
  ) {
    return undefined;
  }

  return {
    key,
    source,
    profile,
    market,
    timeframes,
    feeds,
    dateRangeLabel,
    ...(windowStart ? { windowStart } : {}),
    ...(windowEnd ? { windowEnd } : {}),
    exact
  };
}

function readNumberRecord(value: unknown): Readonly<Record<string, number>> {
  const record = toRecord(value);
  return Object.entries(record).reduce<Record<string, number>>((acc, [key, raw]) => {
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      acc[key] = raw;
    }
    return acc;
  }, {});
}

function chunkStrings(values: readonly string[], size: number): string[][] {
  const normalizedSize = Math.max(1, size);
  const out: string[][] = [];
  for (let index = 0; index < values.length; index += normalizedSize) {
    out.push(values.slice(index, index + normalizedSize));
  }
  return out;
}

function encodeSupabaseTextLiteral(value: string): string {
  return `"${encodeURIComponent(value).replace(/"/g, '%22')}"`;
}

function omitEntryPolicyInsert(payload: RunShellInsert): RunShellInsert {
  const { entry_policy: _entryPolicy, ...legacyPayload } = payload;
  return legacyPayload;
}

function omitEntryPolicyUpdate(payload: RunShellUpdate): RunShellUpdate {
  const { entry_policy: _entryPolicy, ...legacyPayload } = payload;
  return legacyPayload;
}

function omitDatasetRefInsert(payload: RunShellInsert): RunShellInsert {
  const { dataset_ref: _datasetRef, ...legacyPayload } = payload;
  return legacyPayload;
}

function omitDatasetRefUpdate(payload: RunShellUpdate): RunShellUpdate {
  const { dataset_ref: _datasetRef, ...legacyPayload } = payload;
  return legacyPayload;
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
  return isMissingRelationSupabaseError(error, 'text_fills');
}

function isMissingColumnSupabaseError(error: unknown, columnName: string): boolean {
  const parsed = parseSupabaseError(error);
  const normalizedColumn = columnName.toLowerCase();
  const normalizedMessage = parsed.message.toLowerCase();
  const normalizedHint = parsed.hint?.toLowerCase() ?? '';
  return (
    parsed.status === 400 &&
    (parsed.code === 'PGRST204' || parsed.code === '42703' || normalizedMessage.includes('column')) &&
    (normalizedMessage.includes(normalizedColumn) || normalizedHint.includes(normalizedColumn))
  );
}

function isMissingRelationSupabaseError(error: unknown, relationName: string): boolean {
  const parsed = parseSupabaseError(error);
  const normalizedRelation = relationName.toLowerCase();
  const normalizedMessage = parsed.message.toLowerCase();
  const normalizedHint = parsed.hint?.toLowerCase() ?? '';
  return (
    (parsed.status === 404 || parsed.status === 400) &&
    (normalizedMessage.includes(`public.${normalizedRelation}`) ||
      normalizedMessage.includes(`'${normalizedRelation}'`) ||
      normalizedMessage.includes(`relation "${normalizedRelation}"`) ||
      normalizedHint.includes(normalizedRelation))
  );
}
