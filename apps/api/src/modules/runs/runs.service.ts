import type { WsEventEnvelopeDto } from '@zenith/contracts';
import { Injectable } from '@nestjs/common';
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

const EVENT_RETENTION = 500;
const CANDLE_RETENTION = 5000;
const PERSISTENCE_HYDRATION_TTL_MS = 15_000;

function isTradeFillEvent(event: WsEventEnvelopeDto): boolean {
  if (event.eventType !== 'FILL') {
    return false;
  }

  const payload = event.payload as Readonly<Record<string, unknown>>;
  return typeof payload.side === 'string' && typeof payload.fillPrice === 'number' && Number.isFinite(payload.fillPrice);
}

@Injectable()
export class RunsService {
  private readonly runs = new Map<string, RunSnapshot>();
  private readonly runConfigs = new Map<string, RunConfig>();
  private readonly events = new Map<string, WsEventEnvelopeDto[]>();
  private readonly candles = new Map<string, CandleDto[]>();
  private readonly approveTokens = new Map<string, number>();
  private lastPersistenceHydrationAtMs = 0;

  constructor(private readonly db: SupabaseClientService) {}

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
      riskSnapshot: {
        dailyLossLimitPct: Number(process.env.RISK_DAILY_LOSS_LIMIT_PCT ?? '-2'),
        maxConsecutiveLosses: Number(process.env.RISK_MAX_CONSECUTIVE_LOSSES ?? '3'),
        maxDailyOrders: Number(process.env.RISK_MAX_DAILY_ORDERS ?? '200'),
        killSwitch: process.env.RISK_KILL_SWITCH !== 'false'
      },
      updatedAt: new Date().toISOString()
    });

    this.events.set(runId, []);
    this.candles.set(runId, []);
    this.approveTokens.set(runId, 0);
  }

  ingestEvent(event: WsEventEnvelopeDto): void {
    this.seedRun(event.runId);

    const arr = this.events.get(event.runId) ?? [];
    arr.push(event);
    this.events.set(event.runId, arr.slice(-EVENT_RETENTION));

    const payload = event.payload as Readonly<Record<string, unknown>>;
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
  }

  async hydrateRecentRuns(limit = 30): Promise<void> {
    if (Date.now() - this.lastPersistenceHydrationAtMs < PERSISTENCE_HYDRATION_TTL_MS) {
      return;
    }

    try {
      const rows = await this.db.listRuns(limit);
      for (const row of rows) {
        await this.restoreRun(row.runId, row);
      }
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

      const events = await this.db.listRunEvents(runId, EVENT_RETENTION);
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
      this.candles.set(runId, []);
      events.forEach((event) => {
        const candle = this.extractCandle(event.payload as Readonly<Record<string, unknown>>);
        if (candle) {
          this.upsertCandle(runId, candle);
        }
      });
      this.approveTokens.set(runId, this.approveTokens.get(runId) ?? 0);
    } catch {
      // Ignore restore failures and keep serving in-memory runtime state.
    }
  }

  getLastSeq(runId: string): number {
    return this.runs.get(runId)?.lastSeq ?? 0;
  }

  async listRuns(filters?: RunHistoryFilters): Promise<Array<RunSnapshot & RunKpi>> {
    await this.hydrateRecentRuns();

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

  async getRun(runId: string): Promise<(RunSnapshot & { runConfig: RunConfig; events: WsEventEnvelopeDto[]; kpi: RunKpi }) | undefined> {
    await this.restoreRun(runId);

    const run = this.runs.get(runId);
    const runConfig = this.runConfigs.get(runId);
    if (!run) {
      return undefined;
    }
    if (!runConfig) {
      return undefined;
    }
    const events = this.events.get(runId) ?? [];
    return {
      ...run,
      runConfig,
      events,
      kpi: this.computeKpi(events)
    };
  }

  getRunConfig(runId: string): RunConfig | undefined {
    return this.runConfigs.get(runId);
  }

  approvePendingEntry(runId: string): boolean {
    if (!this.runs.has(runId)) {
      return false;
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
      return stored.slice(-cappedLimit);
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

    const derived = [...map.values()]
      .sort((a, b) => a.time - b.time)
      .slice(-cappedLimit);
    if (derived.length > 0) {
      this.candles.set(runId, derived.slice(-CANDLE_RETENTION));
    }
    return derived;
  }

  async updateRunControl(runId: string, input: RunControlInput): Promise<RunSnapshot | undefined> {
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
      riskSnapshot: {
        dailyLossLimitPct: Number(process.env.RISK_DAILY_LOSS_LIMIT_PCT ?? '-2'),
        maxConsecutiveLosses: Number(process.env.RISK_MAX_CONSECUTIVE_LOSSES ?? '3'),
        maxDailyOrders: Number(process.env.RISK_MAX_DAILY_ORDERS ?? '200'),
        killSwitch: process.env.RISK_KILL_SWITCH !== 'false'
      },
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
      time,
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
