import {
  CONNECTION_STATE,
  type ConnectionState,
  type RealtimeStatusDto,
  type WsEventEnvelopeDto
} from '@zenith/contracts';
import { Injectable } from '@nestjs/common';
import { resolveRuntimeRiskSnapshot, resolveSeedCapitalKrw } from '../../common/trading-risk';
import { SupabaseClientService, type PersistedRunRow } from '../../infra/db/supabase/client/supabase.client';

type RunSnapshot = Readonly<{
  runId: string;
  strategyId: 'STRAT_A' | 'STRAT_B' | 'STRAT_C';
  strategyVersion: string;
  mode: 'PAPER' | 'SEMI_AUTO' | 'AUTO' | 'LIVE';
  fillModelRequested: 'AUTO' | 'NEXT_OPEN' | 'ON_CLOSE';
  fillModelApplied: 'NEXT_OPEN' | 'ON_CLOSE';
  entryPolicy: string;
  market: string;
  createdAt: string;
  eventCount: number;
  lastSeq: number;
  lastEventAt?: string;
}>;

type RunConfig = Readonly<{
  runId: string;
  strategyId: RunSnapshot['strategyId'];
  strategyVersion: string;
  mode: RunSnapshot['mode'];
  market: string;
  fillModelRequested: RunSnapshot['fillModelRequested'];
  fillModelApplied: RunSnapshot['fillModelApplied'];
  entryPolicy: string;
  riskSnapshot: Readonly<{
    seedKrw: number;
    maxPositionRatio: number;
    dailyLossLimitPct: number;
    maxConsecutiveLosses: number;
    maxDailyOrders: number;
    killSwitch: boolean;
  }>;
  updatedAt: string;
}>;

type RunKpi = Readonly<{
  trades: number;
  exits: number;
  winRate: number;
  sumReturnPct: number;
  mddPct: number;
  profitFactor: number;
  avgWinPct: number;
  avgLossPct: number;
}>;

type CandleDto = Readonly<{
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}>;

type SeedRunOptions = Readonly<{
  strategyId?: RunSnapshot['strategyId'];
  strategyVersion?: string;
  mode?: RunSnapshot['mode'];
  market?: string;
}>;

type RunControlInput = Readonly<{
  strategyId?: RunSnapshot['strategyId'];
  strategyVersion?: string;
  mode?: RunSnapshot['mode'];
  market?: string;
  fillModelRequested?: RunSnapshot['fillModelRequested'];
  fillModelApplied?: RunSnapshot['fillModelApplied'];
  entryPolicy?: string;
}>;

type RunHistoryFilters = Readonly<{
  strategyId?: RunSnapshot['strategyId'];
  strategyVersion?: string;
  mode?: RunSnapshot['mode'];
  market?: string;
  from?: string;
  to?: string;
}>;

type EventConfigMismatch = Readonly<{
  field: 'strategyId' | 'strategyVersion' | 'market';
  expected: string;
  actual: string;
}>;

type StrategyFillsPage = Readonly<{
  items: readonly WsEventEnvelopeDto[];
  total: number;
  page: number;
  pageSize: number;
}>;

type StrategyAccountSummary = Readonly<{
  strategyId: RunSnapshot['strategyId'];
  seedCapitalKrw: number;
  cashKrw: number;
  positionQty: number;
  avgEntryPriceKrw: number;
  markPriceKrw: number;
  marketValueKrw: number;
  equityKrw: number;
  realizedPnlKrw: number;
  unrealizedPnlKrw: number;
  totalPnlKrw: number;
  totalPnlPct: number;
  fillCount: number;
  lastFillAt?: string;
}>;

type RunRealtimeState = Readonly<{
  transportState: ConnectionState;
  transportRetryCount: number;
  transportNextRetryInMs: number | undefined;
  snapshotDelayed: boolean;
  persistenceQueueDepth: number;
  persistenceRetryCount: number;
  persistenceNextRetryInMs: number | undefined;
  lastEventAt: string | undefined;
  staleThresholdMs: number;
}>;

const EVENT_RETENTION = 500;
const FILL_EVENT_RETENTION = 500;
const CANDLE_RETENTION = 5000;
const PERSISTENCE_HYDRATION_TTL_MS = 15_000;
const DEFAULT_STALE_THRESHOLD_MS = 60_000;
const STRATEGY_DEFAULT_RUN_ID: Readonly<Record<RunSnapshot['strategyId'], string>> = {
  STRAT_A: 'run-strat-a-0001',
  STRAT_B: 'run-strat-b-0001',
  STRAT_C: 'run-strat-c-0001'
};

function isTradeFillEvent(event: WsEventEnvelopeDto): boolean {
  if (event.eventType !== 'FILL') {
    return false;
  }

  const payload = event.payload as Readonly<Record<string, unknown>>;
  return typeof payload.side === 'string' && typeof payload.fillPrice === 'number' && Number.isFinite(payload.fillPrice);
}

type EntryReadinessSnapshot = Readonly<{
  entryReadinessPct: number;
  entryReady: boolean;
  entryExecutable: boolean;
  reason: string;
  inPosition: boolean;
}>;

@Injectable()
export class RunsService {
  private readonly runs = new Map<string, RunSnapshot>();
  private readonly runConfigs = new Map<string, RunConfig>();
  private readonly events = new Map<string, WsEventEnvelopeDto[]>();
  private readonly fillEvents = new Map<string, WsEventEnvelopeDto[]>();
  private readonly latestEntryReadiness = new Map<string, EntryReadinessSnapshot>();
  private readonly candles = new Map<string, CandleDto[]>();
  private readonly approveTokens = new Map<string, number>();
  private readonly realtimeStates = new Map<string, RunRealtimeState>();
  private lastPersistenceHydrationAtMs = 0;

  constructor(private readonly db: SupabaseClientService) {
    this.ensureStrategyRunsSeeded();
  }

  seedRun(runId: string, options?: SeedRunOptions): void {
    if (this.runs.has(runId)) {
      return;
    }

    this.runs.set(runId, {
      runId,
      strategyId: options?.strategyId ?? 'STRAT_B',
      strategyVersion: options?.strategyVersion ?? (process.env.STRATEGY_VERSION ?? 'v1'),
      mode: options?.mode ?? 'PAPER',
      fillModelRequested: 'AUTO',
      fillModelApplied: 'NEXT_OPEN',
      entryPolicy: 'AUTO',
      market: options?.market ?? 'KRW-XRP',
      createdAt: new Date().toISOString(),
      eventCount: 0,
      lastSeq: 0
    });
    this.runConfigs.set(runId, {
      runId,
      strategyId: options?.strategyId ?? 'STRAT_B',
      strategyVersion: options?.strategyVersion ?? (process.env.STRATEGY_VERSION ?? 'v1'),
      mode: options?.mode ?? 'PAPER',
      market: options?.market ?? 'KRW-XRP',
      fillModelRequested: 'AUTO',
      fillModelApplied: 'NEXT_OPEN',
      entryPolicy: 'AUTO',
      riskSnapshot: resolveRuntimeRiskSnapshot({
        strategyId: options?.strategyId ?? 'STRAT_B'
      }),
      updatedAt: new Date().toISOString()
    });

    this.events.set(runId, []);
    this.fillEvents.set(runId, []);
    this.candles.set(runId, []);
    this.approveTokens.set(runId, 0);
    this.realtimeStates.set(runId, this.realtimeStates.get(runId) ?? defaultRunRealtimeState());
  }

  ingestEvent(event: WsEventEnvelopeDto): void {
    this.seedRun(event.runId);

    const arr = this.events.get(event.runId) ?? [];
    arr.push(event);
    this.events.set(event.runId, arr.slice(-EVENT_RETENTION));

    const payload = event.payload as Readonly<Record<string, unknown>>;
    if (isTradeFillEvent(event)) {
      const fills = this.fillEvents.get(event.runId) ?? [];
      fills.push(event);
      this.fillEvents.set(event.runId, fills.slice(-FILL_EVENT_RETENTION));
    }
    if (event.eventType === 'ENTRY_READINESS') {
      const snapshot = toEntryReadinessSnapshot(payload);
      if (snapshot) {
        this.latestEntryReadiness.set(event.runId, snapshot);
      }
    }
    const candle = this.extractCandle(payload);
    if (candle) {
      this.upsertCandle(event.runId, candle);
    }

    const prev = this.runs.get(event.runId);
    if (!prev) {
      return;
    }

    this.runs.set(event.runId, {
      ...prev,
      eventCount: arr.length,
      lastSeq: Math.max(prev.lastSeq, event.seq),
      lastEventAt: event.eventTs
    });
    this.patchRealtimeState(event.runId, {
      lastEventAt: event.eventTs
    });
  }

  async hydrateRecentRuns(limit = 300): Promise<void> {
    if (Date.now() - this.lastPersistenceHydrationAtMs < PERSISTENCE_HYDRATION_TTL_MS) {
      return;
    }

    try {
      const rows = await this.db.listRuns(limit);
      for (const row of rows) {
        await this.restoreRun(row.runId, row);
      }
      this.ensureStrategyRunsSeeded();
      this.lastPersistenceHydrationAtMs = Date.now();
    } catch {
      // Persistence hydration is best-effort. Runtime memory remains the source of truth while live.
    }
  }

  async restoreRun(runId: string, persistedRow?: PersistedRunRow): Promise<void> {
    const hasEvents = (this.events.get(runId)?.length ?? 0) > 0;
    const hasRun = this.runs.has(runId) && this.runConfigs.has(runId);
    if (hasRun && hasEvents) {
      return;
    }

    try {
      const row = persistedRow ?? await this.db.getRun(runId);
      if (!row) {
        return;
      }

      const [events, latestEntryReadinessEvent] = await Promise.all([
        this.db.listRunEvents(runId, EVENT_RETENTION),
        this.db.getLatestRunEventByType(runId, 'ENTRY_READINESS')
      ]);
      const lastEvent = events[events.length - 1];
      const fillModelApplied = row.fillModelApplied === 'ON_CLOSE' ? 'ON_CLOSE' : 'NEXT_OPEN';

      this.runs.set(runId, {
        runId: row.runId,
        strategyId: row.strategyId,
        strategyVersion: row.strategyVersion,
        mode: row.mode,
        fillModelRequested: row.fillModelRequested === 'ON_CLOSE' ? 'ON_CLOSE' : row.fillModelRequested === 'NEXT_OPEN' ? 'NEXT_OPEN' : 'AUTO',
        fillModelApplied,
        entryPolicy: 'AUTO',
        market: row.market,
        createdAt: row.createdAt,
        eventCount: events.length,
        lastSeq: lastEvent?.seq ?? 0,
        ...(lastEvent?.eventTs ? { lastEventAt: lastEvent.eventTs } : {})
      });

      this.runConfigs.set(runId, this.buildDefaultRunConfig({
        runId,
        strategyId: row.strategyId,
        strategyVersion: row.strategyVersion,
        mode: row.mode,
        market: row.market,
        fillModelRequested: row.fillModelRequested === 'ON_CLOSE' ? 'ON_CLOSE' : row.fillModelRequested === 'NEXT_OPEN' ? 'NEXT_OPEN' : 'AUTO',
        fillModelApplied,
        updatedAt: row.updatedAt ?? row.createdAt
      }));

      this.events.set(runId, [...events].slice(-EVENT_RETENTION));
      const retainedFills = events.filter(isTradeFillEvent);
      this.fillEvents.set(runId, retainedFills.slice(-FILL_EVENT_RETENTION));
      const latestSnapshot = latestEntryReadinessEvent
        ? toEntryReadinessSnapshot(latestEntryReadinessEvent.payload as Readonly<Record<string, unknown>>)
        : getLatestEntryReadinessFromEvents(events);
      if (latestSnapshot) {
        this.latestEntryReadiness.set(runId, latestSnapshot);
      } else {
        this.latestEntryReadiness.delete(runId);
      }
      this.candles.set(runId, []);
      events.forEach((event) => {
        const candle = this.extractCandle(event.payload as Readonly<Record<string, unknown>>);
        if (candle) {
          this.upsertCandle(runId, candle);
        }
      });
      this.approveTokens.set(runId, this.approveTokens.get(runId) ?? 0);
      this.realtimeStates.set(runId, this.realtimeStates.get(runId) ?? defaultRunRealtimeState({
        ...(lastEvent?.eventTs ? { lastEventAt: lastEvent.eventTs } : {})
      }));
    } catch {
      // Ignore restore failures and keep serving in-memory runtime state.
    }
  }

  getLastSeq(runId: string): number {
    return this.runs.get(runId)?.lastSeq ?? 0;
  }

  async listRuns(filters?: RunHistoryFilters): Promise<Array<RunSnapshot & RunKpi>> {
    const hydrationLimit = filters?.strategyId ? 500 : 300;
    await this.hydrateRecentRuns(hydrationLimit);

    return [...this.runs.values()]
      .filter((run) => {
        if (filters?.strategyId && run.strategyId !== filters.strategyId) {
          return false;
        }
        if (filters?.strategyVersion && run.strategyVersion !== filters.strategyVersion) {
          return false;
        }
        if (filters?.mode && run.mode !== filters.mode) {
          return false;
        }
        if (filters?.market && run.market !== filters.market) {
          return false;
        }
        if (filters?.from && run.createdAt < filters.from) {
          return false;
        }
        if (filters?.to && run.createdAt > filters.to) {
          return false;
        }
        return true;
      })
      .map((run) => ({
        ...run,
        ...this.computeKpi(this.events.get(run.runId) ?? [])
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getRun(runId: string): Promise<(RunSnapshot & {
    runConfig: RunConfig;
    events: WsEventEnvelopeDto[];
    kpi: RunKpi;
    latestEntryReadiness?: EntryReadinessSnapshot;
    realtimeStatus?: RealtimeStatusDto;
  }) | undefined> {
    await this.restoreRun(runId);
    if (!this.runs.has(runId)) {
      const inferred = inferStrategyIdFromRunId(runId);
      if (inferred) {
        this.seedRun(runId, { strategyId: inferred });
      }
    }

    const run = this.runs.get(runId);
    const runConfig = this.runConfigs.get(runId);
    if (!run) {
      return undefined;
    }
    if (!runConfig) {
      return undefined;
    }
    const events = this.events.get(runId) ?? [];
    const latestEntryReadiness = this.latestEntryReadiness.get(runId);
    const realtimeStatus = this.getRealtimeStatus(runId);
    return {
      ...run,
      runConfig,
      events,
      kpi: this.computeKpi(events),
      ...(latestEntryReadiness ? { latestEntryReadiness } : {}),
      ...(realtimeStatus ? { realtimeStatus } : {})
    };
  }

  getRealtimeStatus(runId: string): RealtimeStatusDto | undefined {
    const state = this.realtimeStates.get(runId);
    return state ? toRealtimeStatusDto(state) : undefined;
  }

  setTransportState(
    runId: string,
    connectionState: ConnectionState,
    input?: Readonly<{
      retryCount?: number;
      nextRetryInMs?: number;
      staleThresholdMs?: number;
    }>
  ): RealtimeStatusDto {
    this.seedRun(runId);
    const state = this.patchRealtimeState(runId, {
      transportState: connectionState,
      transportRetryCount: input?.retryCount ?? 0,
      ...(typeof input?.nextRetryInMs === 'number'
        ? { transportNextRetryInMs: input.nextRetryInMs }
        : { transportNextRetryInMs: undefined }),
      ...(typeof input?.staleThresholdMs === 'number'
        ? { staleThresholdMs: input.staleThresholdMs }
        : {})
    });
    return toRealtimeStatusDto(state);
  }

  setSnapshotDelay(
    runId: string,
    delayed: boolean,
    staleThresholdMs = DEFAULT_STALE_THRESHOLD_MS
  ): RealtimeStatusDto {
    this.seedRun(runId);
    const state = this.patchRealtimeState(runId, {
      snapshotDelayed: delayed,
      staleThresholdMs
    });
    return toRealtimeStatusDto(state);
  }

  setPersistenceBacklog(
    runId: string,
    input: Readonly<{
      queueDepth: number;
      retryCount?: number;
      nextRetryInMs?: number;
    }>
  ): RealtimeStatusDto {
    this.seedRun(runId);
    const state = this.patchRealtimeState(runId, {
      persistenceQueueDepth: Math.max(0, input.queueDepth),
      persistenceRetryCount: Math.max(0, input.retryCount ?? 0),
      ...(typeof input.nextRetryInMs === 'number'
        ? { persistenceNextRetryInMs: input.nextRetryInMs }
        : { persistenceNextRetryInMs: undefined })
    });
    return toRealtimeStatusDto(state);
  }

  async listStrategyFills(
    strategyId: RunSnapshot['strategyId'],
    page = 1,
    pageSize = 50
  ): Promise<StrategyFillsPage> {
    const safePage = Math.max(1, Math.floor(page));
    const safePageSize = Math.max(1, Math.min(Math.floor(pageSize), 200));
    const fills = await this.listMergedStrategyFillEvents(strategyId);
    const offset = (safePage - 1) * safePageSize;

    return {
      items: fills.slice(offset, offset + safePageSize),
      total: fills.length,
      page: safePage,
      pageSize: safePageSize
    };
  }

  async getStrategyAccountSummary(strategyId: RunSnapshot['strategyId']): Promise<StrategyAccountSummary> {
    await this.hydrateRecentRuns(500);
    const seedCapitalKrw = resolveSeedCapitalKrw(strategyId);
    const fills = [...(await this.listMergedStrategyFillEvents(strategyId))]
      .sort((a, b) => {
        const tsDiff = Date.parse(a.eventTs) - Date.parse(b.eventTs);
        if (Number.isFinite(tsDiff) && tsDiff !== 0) {
          return tsDiff;
        }
        return a.seq - b.seq;
      });

    let cashKrw = seedCapitalKrw;
    let positionQty = 0;
    let avgEntryPriceKrw = 0;
    let realizedPnlKrw = 0;
    let markPriceKrw = 0;
    let lastFillAt: string | undefined;

    fills.forEach((fill) => {
      const payload = fill.payload as Readonly<Record<string, unknown>>;
      const side = typeof payload.side === 'string' ? payload.side.toUpperCase() : '';
      const fillPrice = typeof payload.fillPrice === 'number' && Number.isFinite(payload.fillPrice)
        ? payload.fillPrice
        : undefined;
      const qty = resolveFillQty(payload);
      if (!fillPrice || qty <= 0) {
        return;
      }

      markPriceKrw = fillPrice;
      lastFillAt = fill.eventTs;

      if (side === 'BUY') {
        const nextQty = positionQty + qty;
        if (nextQty > 0) {
          avgEntryPriceKrw = ((avgEntryPriceKrw * positionQty) + (fillPrice * qty)) / nextQty;
        }
        positionQty = nextQty;
        cashKrw -= fillPrice * qty;
        return;
      }

      if (side === 'SELL') {
        const matchedQty = Math.min(positionQty, qty);
        if (matchedQty > 0) {
          realizedPnlKrw += (fillPrice - avgEntryPriceKrw) * matchedQty;
        }
        positionQty = Math.max(0, positionQty - qty);
        if (positionQty === 0) {
          avgEntryPriceKrw = 0;
        }
        cashKrw += fillPrice * qty;
      }
    });

    const latestMarkPriceKrw = this.resolveLatestStrategyMarkPrice(strategyId);
    if (typeof latestMarkPriceKrw === 'number' && latestMarkPriceKrw > 0) {
      markPriceKrw = latestMarkPriceKrw;
    } else if (markPriceKrw <= 0 && avgEntryPriceKrw > 0) {
      markPriceKrw = avgEntryPriceKrw;
    }

    const marketValueKrw = positionQty * markPriceKrw;
    const equityKrw = cashKrw + marketValueKrw;
    const unrealizedPnlKrw = positionQty > 0 ? (markPriceKrw - avgEntryPriceKrw) * positionQty : 0;
    const totalPnlKrw = equityKrw - seedCapitalKrw;
    const totalPnlPct = seedCapitalKrw > 0 ? (totalPnlKrw / seedCapitalKrw) * 100 : 0;

    return {
      strategyId,
      seedCapitalKrw: roundMoney(seedCapitalKrw),
      cashKrw: roundMoney(cashKrw),
      positionQty: roundQty(positionQty),
      avgEntryPriceKrw: roundMoney(avgEntryPriceKrw),
      markPriceKrw: roundMoney(markPriceKrw),
      marketValueKrw: roundMoney(marketValueKrw),
      equityKrw: roundMoney(equityKrw),
      realizedPnlKrw: roundMoney(realizedPnlKrw),
      unrealizedPnlKrw: roundMoney(unrealizedPnlKrw),
      totalPnlKrw: roundMoney(totalPnlKrw),
      totalPnlPct: roundPct(totalPnlPct),
      fillCount: fills.length,
      ...(lastFillAt ? { lastFillAt } : {})
    };
  }

  async purgeInvalidFillEvents(): Promise<Readonly<{ deleted: number; scanned: number }>> {
    return this.db.purgeInvalidFillEvents();
  }

  getRunConfig(runId: string): RunConfig | undefined {
    return this.runConfigs.get(runId);
  }

  approvePendingEntry(runId: string): boolean {
    if (!this.runs.has(runId)) {
      const inferred = inferStrategyIdFromRunId(runId);
      if (!inferred) {
        return false;
      }
      this.seedRun(runId, { strategyId: inferred });
    }
    const next = (this.approveTokens.get(runId) ?? 0) + 1;
    this.approveTokens.set(runId, next);
    return true;
  }

  consumeApproval(runId: string): boolean {
    const current = this.approveTokens.get(runId) ?? 0;
    if (current <= 0) {
      return false;
    }
    this.approveTokens.set(runId, current - 1);
    return true;
  }

  validateEventAgainstRunConfig(event: WsEventEnvelopeDto): readonly EventConfigMismatch[] {
    const runConfig = this.runConfigs.get(event.runId);
    if (!runConfig) {
      return [];
    }

    const payload = event.payload as Readonly<Record<string, unknown>>;
    const mismatches: EventConfigMismatch[] = [];
    const strategyId = payload.strategyId;
    const strategyVersion = payload.strategyVersion;
    const market = payload.market;

    if (typeof strategyId === 'string' && strategyId !== runConfig.strategyId) {
      mismatches.push({
        field: 'strategyId',
        expected: runConfig.strategyId,
        actual: strategyId
      });
    }
    if (typeof strategyVersion === 'string' && strategyVersion !== runConfig.strategyVersion) {
      mismatches.push({
        field: 'strategyVersion',
        expected: runConfig.strategyVersion,
        actual: strategyVersion
      });
    }

    if (typeof market === 'string' && market !== runConfig.market) {
      mismatches.push({
        field: 'market',
        expected: runConfig.market,
        actual: market
      });
    }

    return mismatches;
  }

  async getEventsJsonl(runId: string): Promise<string | undefined> {
    const run = await this.getRun(runId);
    if (!run) {
      return undefined;
    }
    return run.events.map((event) => JSON.stringify(event)).join('\n');
  }

  async getTradesCsv(runId: string): Promise<string | undefined> {
    const run = await this.getRun(runId);
    if (!run) {
      return undefined;
    }

    const fills = run.events.filter(isTradeFillEvent);
    const header = 'tradeId,entryTime,exitReason,netReturnPct,seq';
    const rows = fills.map((fill, index) => {
      const pct = ((index % 5) - 2) * 0.21;
      return [
        `T-${String(index + 1).padStart(4, '0')}`,
        fill.eventTs,
        index % 2 === 0 ? 'TP1' : 'SL',
        `${pct.toFixed(2)}%`,
        String(fill.seq)
      ].join(',');
    });

    return [header, ...rows].join('\n');
  }

  async getCandles(runId: string, limit: number): Promise<CandleDto[] | undefined> {
    await this.restoreRun(runId);

    if (!this.runs.has(runId)) {
      return undefined;
    }

    const cappedLimit = Math.max(1, Math.min(1000, limit));
    const stored = this.candles.get(runId) ?? [];
    if (stored.length > 0) {
      const normalizedStored = normalizeMinuteCandles(stored);
      this.candles.set(runId, normalizedStored.slice(-CANDLE_RETENTION));
      return normalizedStored.slice(-cappedLimit);
    }

    const map = new Map<number, CandleDto>();
    const events = this.events.get(runId) ?? [];

    events.forEach((event) => {
      const payload = event.payload as Readonly<Record<string, unknown>>;
      const candle = this.extractCandle(payload);
      if (!candle) {
        return;
      }
      map.set(candle.time, candle);
    });

    const derived = normalizeMinuteCandles([...map.values()]).slice(-cappedLimit);
    if (derived.length > 0) {
      this.candles.set(runId, derived.slice(-CANDLE_RETENTION));
    }
    return derived;
  }

  async updateRunControl(runId: string, input: RunControlInput): Promise<RunSnapshot | undefined> {
    if (!this.runs.has(runId) || !this.runConfigs.has(runId)) {
      const inferredStrategyId = input.strategyId ?? inferStrategyIdFromRunId(runId);
      if (inferredStrategyId) {
        this.seedRun(runId, {
          strategyId: inferredStrategyId,
          ...(input.strategyVersion ? { strategyVersion: input.strategyVersion } : {}),
          ...(input.mode ? { mode: input.mode } : {}),
          ...(input.market ? { market: input.market } : {})
        });
      }
    }

    const prev = this.runs.get(runId);
    const prevConfig = this.runConfigs.get(runId);
    if (!prev) {
      return undefined;
    }
    if (!prevConfig) {
      return undefined;
    }
    const next: RunSnapshot = {
      ...prev,
      strategyId: input.strategyId ?? prev.strategyId,
      strategyVersion: input.strategyVersion ?? prev.strategyVersion,
      mode: input.mode ?? prev.mode,
      market: input.market ?? prev.market,
      fillModelRequested: input.fillModelRequested ?? prev.fillModelRequested,
      fillModelApplied: input.fillModelApplied ?? prev.fillModelApplied,
      entryPolicy: input.entryPolicy ?? prev.entryPolicy
    };
    const nextConfig: RunConfig = {
      ...prevConfig,
      strategyId: next.strategyId,
      strategyVersion: next.strategyVersion,
      mode: next.mode,
      market: next.market,
      fillModelRequested: next.fillModelRequested,
      fillModelApplied: next.fillModelApplied,
      entryPolicy: next.entryPolicy,
      updatedAt: new Date().toISOString()
    };
    this.runs.set(runId, next);
    this.runConfigs.set(runId, nextConfig);
    await this.db.updateRunShell(runId, {
      strategyId: next.strategyId,
      strategyVersion: next.strategyVersion,
      mode: next.mode,
      market: next.market,
      fillModelRequested: next.fillModelRequested,
      fillModelApplied: next.fillModelApplied
    });
    return next;
  }

  private ensureStrategyRunsSeeded(): void {
    this.seedRun(STRATEGY_DEFAULT_RUN_ID.STRAT_A, { strategyId: 'STRAT_A' });
    this.seedRun(STRATEGY_DEFAULT_RUN_ID.STRAT_B, { strategyId: 'STRAT_B' });
    this.seedRun(STRATEGY_DEFAULT_RUN_ID.STRAT_C, { strategyId: 'STRAT_C' });
  }

  private patchRealtimeState(
    runId: string,
    patch: Partial<RunRealtimeState>
  ): RunRealtimeState {
    const prev = this.realtimeStates.get(runId) ?? defaultRunRealtimeState();
    const next: RunRealtimeState = {
      ...prev,
      ...patch
    };
    this.realtimeStates.set(runId, next);
    return next;
  }

  private async listMergedStrategyFillEvents(
    strategyId: RunSnapshot['strategyId']
  ): Promise<readonly WsEventEnvelopeDto[]> {
    const persisted = await this.db.listAllStrategyFillEvents(strategyId);
    const runtime = [...this.runs.values()]
      .filter((run) => run.strategyId === strategyId)
      .flatMap((run) => this.fillEvents.get(run.runId) ?? []);
    return mergeEventsByRecency(persisted, runtime)
      .filter(isTradeFillEvent);
  }

  private resolveLatestStrategyMarkPrice(
    strategyId: RunSnapshot['strategyId']
  ): number | undefined {
    const candidates = [...this.runs.values()]
      .filter((run) => run.strategyId === strategyId)
      .sort((a, b) => {
        const tsDiff = Date.parse(b.lastEventAt ?? b.createdAt) - Date.parse(a.lastEventAt ?? a.createdAt);
        if (Number.isFinite(tsDiff) && tsDiff !== 0) {
          return tsDiff;
        }
        return b.lastSeq - a.lastSeq;
      });

    for (const run of candidates) {
      const candles = this.candles.get(run.runId);
      const latest = candles?.[candles.length - 1];
      if (latest && Number.isFinite(latest.close) && latest.close > 0) {
        return latest.close;
      }
    }

    return undefined;
  }

  private buildDefaultRunConfig(input: Readonly<{
    runId: string;
    strategyId: RunSnapshot['strategyId'];
    strategyVersion: string;
    mode: RunSnapshot['mode'];
    market: string;
    fillModelRequested: RunSnapshot['fillModelRequested'];
    fillModelApplied: RunSnapshot['fillModelApplied'];
    updatedAt: string;
  }>): RunConfig {
    return {
      runId: input.runId,
      strategyId: input.strategyId,
      strategyVersion: input.strategyVersion,
      mode: input.mode,
      market: input.market,
      fillModelRequested: input.fillModelRequested,
      fillModelApplied: input.fillModelApplied,
      entryPolicy: 'AUTO',
      riskSnapshot: resolveRuntimeRiskSnapshot({
        strategyId: input.strategyId
      }),
      updatedAt: input.updatedAt
    };
  }

  private computeKpi(events: readonly WsEventEnvelopeDto[]): RunKpi {
    const fills = events.filter(isTradeFillEvent);
    const exits = events.filter((event) => event.eventType === 'EXIT');
    const pnlSeries = exits
      .map((event) => {
        const payload = event.payload as Readonly<Record<string, unknown>>;
        return typeof payload.pnlPct === 'number' ? payload.pnlPct : undefined;
      })
      .filter((value): value is number => typeof value === 'number');

    const sumReturnPct = pnlSeries.reduce((acc, value) => acc + value, 0);
    const wins = pnlSeries.filter((value) => value > 0);
    const losses = pnlSeries.filter((value) => value < 0);
    const winCount = wins.length;
    const winRate = pnlSeries.length > 0 ? (winCount / pnlSeries.length) * 100 : 0;
    const grossProfit = wins.reduce((acc, value) => acc + value, 0);
    const grossLossAbs = Math.abs(losses.reduce((acc, value) => acc + value, 0));
    const profitFactor = grossLossAbs > 0 ? grossProfit / grossLossAbs : grossProfit > 0 ? Number.POSITIVE_INFINITY : 0;
    const avgWinPct = wins.length > 0 ? grossProfit / wins.length : 0;
    const avgLossPct = losses.length > 0 ? losses.reduce((acc, value) => acc + value, 0) / losses.length : 0;

    let equity = 0;
    let peak = 0;
    let mdd = 0;
    pnlSeries.forEach((value) => {
      equity += value;
      peak = Math.max(peak, equity);
      mdd = Math.min(mdd, equity - peak);
    });

    return {
      trades: fills.length,
      exits: exits.length,
      winRate: Number(winRate.toFixed(2)),
      sumReturnPct: Number(sumReturnPct.toFixed(4)),
      mddPct: Number(mdd.toFixed(4)),
      profitFactor: Number.isFinite(profitFactor) ? Number(profitFactor.toFixed(4)) : 9999,
      avgWinPct: Number(avgWinPct.toFixed(4)),
      avgLossPct: Number(avgLossPct.toFixed(4))
    };
  }

  private extractCandle(payload: Readonly<Record<string, unknown>>): CandleDto | undefined {
    const nested = payload.candle as Readonly<Record<string, unknown>> | undefined;
    const source = nested ?? payload;
    const time = source.time;
    const open = source.open;
    const high = source.high;
    const low = source.low;
    const close = source.close;
    const volumeRaw = source.volume ?? source.tradeVolume;

    if (
      typeof time !== 'number' ||
      typeof open !== 'number' ||
      typeof high !== 'number' ||
      typeof low !== 'number' ||
      typeof close !== 'number'
    ) {
      return undefined;
    }

    return {
      time: normalizeMinuteCandleTime(time),
      open,
      high,
      low,
      close,
      ...(typeof volumeRaw === 'number' ? { volume: volumeRaw } : {})
    };
  }

  private upsertCandle(runId: string, next: CandleDto): void {
    const prev = this.candles.get(runId) ?? [];
    if (prev.length === 0) {
      this.candles.set(runId, [next]);
      return;
    }

    const last = prev[prev.length - 1];
    if (!last) {
      this.candles.set(runId, [next]);
      return;
    }

    const mergedNext: CandleDto = {
      ...next,
      ...(typeof next.volume === 'number' ? {} : (typeof last.volume === 'number' && last.time === next.time ? { volume: last.volume } : {}))
    };

    if (last.time === mergedNext.time) {
      this.candles.set(runId, [...prev.slice(0, -1), mergedNext].slice(-CANDLE_RETENTION));
      return;
    }

    if (last.time < mergedNext.time) {
      this.candles.set(runId, [...prev, mergedNext].slice(-CANDLE_RETENTION));
      return;
    }

    const nextCandles = [...prev];
    const exactIndex = nextCandles.findIndex((candle) => candle.time === mergedNext.time);
    if (exactIndex >= 0) {
      const existing = nextCandles[exactIndex];
      nextCandles[exactIndex] = {
        ...mergedNext,
        ...(typeof mergedNext.volume === 'number' ? {} : (typeof existing?.volume === 'number' ? { volume: existing.volume } : {}))
      };
      this.candles.set(runId, nextCandles.slice(-CANDLE_RETENTION));
      return;
    }

    const insertIndex = nextCandles.findIndex((candle) => candle.time > mergedNext.time);
    if (insertIndex === -1) {
      nextCandles.push(mergedNext);
    } else {
      nextCandles.splice(insertIndex, 0, mergedNext);
    }
    this.candles.set(runId, nextCandles.slice(-CANDLE_RETENTION));
  }
}

function inferStrategyIdFromRunId(runId: string): RunSnapshot['strategyId'] | undefined {
  if (runId === STRATEGY_DEFAULT_RUN_ID.STRAT_A || runId.startsWith('run-strat-a-')) {
    return 'STRAT_A';
  }
  if (runId === STRATEGY_DEFAULT_RUN_ID.STRAT_B || runId.startsWith('run-strat-b-')) {
    return 'STRAT_B';
  }
  if (runId === STRATEGY_DEFAULT_RUN_ID.STRAT_C || runId.startsWith('run-strat-c-')) {
    return 'STRAT_C';
  }
  return undefined;
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

function roundMoney(value: number): number {
  return Number(value.toFixed(2));
}

function roundQty(value: number): number {
  return Number(value.toFixed(8));
}

function roundPct(value: number): number {
  return Number(value.toFixed(4));
}

function normalizeMinuteCandleTime(time: number): number {
  return Math.floor(time / 60) * 60;
}

function normalizeMinuteCandles(candles: readonly CandleDto[]): CandleDto[] {
  const byTime = new Map<number, CandleDto>();
  candles.forEach((candle) => {
    byTime.set(normalizeMinuteCandleTime(candle.time), {
      ...candle,
      time: normalizeMinuteCandleTime(candle.time)
    });
  });
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

function getLatestEntryReadinessFromEvents(events: readonly WsEventEnvelopeDto[]): EntryReadinessSnapshot | undefined {
  const latest = [...events]
    .filter((event) => event.eventType === 'ENTRY_READINESS')
    .sort(compareEventsByRecency)[0];
  if (!latest) {
    return undefined;
  }
  return toEntryReadinessSnapshot(latest.payload as Readonly<Record<string, unknown>>);
}

function toEntryReadinessSnapshot(payload: Readonly<Record<string, unknown>>): EntryReadinessSnapshot | undefined {
  const entryReadinessPct = payload.entryReadinessPct;
  const entryReady = payload.entryReady;
  const entryExecutable = payload.entryExecutable;
  const reason = payload.reason;
  const inPosition = payload.inPosition;

  if (
    typeof entryReadinessPct !== 'number' &&
    typeof entryReady !== 'boolean' &&
    typeof entryExecutable !== 'boolean' &&
    typeof reason !== 'string' &&
    typeof inPosition !== 'boolean'
  ) {
    return undefined;
  }

  return {
    entryReadinessPct: normalizeEntryReadinessPct(entryReadinessPct),
    entryReady: entryReady === true,
    entryExecutable: entryExecutable === true,
    reason: typeof reason === 'string' ? reason : 'ENTRY_WAIT',
    inPosition: inPosition === true
  };
}

function normalizeEntryReadinessPct(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  return Math.round(Math.min(100, Math.max(0, value)));
}

function mergeEventsByRecency(
  ...groups: ReadonlyArray<readonly WsEventEnvelopeDto[]>
): WsEventEnvelopeDto[] {
  const byKey = new Map<string, WsEventEnvelopeDto>();
  groups.forEach((group) => {
    group.forEach((event) => {
      byKey.set(toEventKey(event), event);
    });
  });
  return [...byKey.values()].sort(compareEventsByRecency);
}

function toEventKey(event: Pick<WsEventEnvelopeDto, 'runId' | 'seq'>): string {
  return `${event.runId}:${event.seq}`;
}

function compareEventsByRecency(a: WsEventEnvelopeDto, b: WsEventEnvelopeDto): number {
  const tsDiff = Date.parse(b.eventTs) - Date.parse(a.eventTs);
  if (Number.isFinite(tsDiff) && tsDiff !== 0) {
    return tsDiff;
  }
  return b.seq - a.seq;
}

function defaultRunRealtimeState(
  input?: Partial<RunRealtimeState>
): RunRealtimeState {
  return {
    transportState: CONNECTION_STATE.LIVE,
    transportRetryCount: 0,
    transportNextRetryInMs: undefined,
    snapshotDelayed: false,
    persistenceQueueDepth: 0,
    persistenceRetryCount: 0,
    persistenceNextRetryInMs: undefined,
    lastEventAt: undefined,
    staleThresholdMs: DEFAULT_STALE_THRESHOLD_MS,
    ...input
  };
}

function toRealtimeStatusDto(
  state: RunRealtimeState,
  nowMs = Date.now()
): RealtimeStatusDto {
  const connectionState = resolveRealtimeConnectionState(state, nowMs);
  const retry = resolveRealtimeRetryMetadata(state, connectionState);

  return {
    connectionState,
    ...(state.lastEventAt ? { lastEventAt: state.lastEventAt } : {}),
    ...(state.persistenceQueueDepth > 0 ? { queueDepth: state.persistenceQueueDepth } : {}),
    ...retry,
    staleThresholdMs: state.staleThresholdMs
  };
}

function resolveRealtimeConnectionState(
  state: RunRealtimeState,
  nowMs: number
): ConnectionState {
  if (
    state.transportState === CONNECTION_STATE.RECONNECTING ||
    state.transportState === CONNECTION_STATE.PAUSED ||
    state.transportState === CONNECTION_STATE.ERROR
  ) {
    return state.transportState;
  }

  if (state.snapshotDelayed || state.persistenceQueueDepth > 0 || isRealtimeStateStale(state, nowMs)) {
    return CONNECTION_STATE.DELAYED;
  }

  return CONNECTION_STATE.LIVE;
}

function resolveRealtimeRetryMetadata(
  state: RunRealtimeState,
  connectionState: ConnectionState
): Partial<Pick<RealtimeStatusDto, 'retryCount' | 'nextRetryInMs'>> {
  if (
    connectionState === CONNECTION_STATE.RECONNECTING ||
    connectionState === CONNECTION_STATE.PAUSED ||
    connectionState === CONNECTION_STATE.ERROR
  ) {
    return {
      retryCount: state.transportRetryCount,
      ...(typeof state.transportNextRetryInMs === 'number'
        ? { nextRetryInMs: state.transportNextRetryInMs }
        : {})
    };
  }

  if (state.persistenceQueueDepth > 0) {
    return {
      retryCount: state.persistenceRetryCount,
      ...(typeof state.persistenceNextRetryInMs === 'number'
        ? { nextRetryInMs: state.persistenceNextRetryInMs }
        : {})
    };
  }

  return {};
}

function isRealtimeStateStale(state: RunRealtimeState, nowMs: number): boolean {
  if (!state.lastEventAt) {
    return false;
  }

  const lastEventAtMs = Date.parse(state.lastEventAt);
  if (!Number.isFinite(lastEventAtMs)) {
    return false;
  }

  return nowMs - lastEventAtMs > state.staleThresholdMs;
}
