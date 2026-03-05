import type { WsEventEnvelopeDto } from '@zenith/contracts';
import { Injectable } from '@nestjs/common';

type RunSnapshot = Readonly<{
  runId: string;
  strategyId: 'STRAT_A' | 'STRAT_B' | 'STRAT_C';
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

type RunKpi = Readonly<{
  trades: number;
  exits: number;
  winRate: number;
  sumReturnPct: number;
  mddPct: number;
}>;

type CandleDto = Readonly<{
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}>;

type SeedRunOptions = Readonly<{
  strategyId?: RunSnapshot['strategyId'];
  mode?: RunSnapshot['mode'];
  market?: string;
}>;

type RunControlInput = Readonly<{
  strategyId?: RunSnapshot['strategyId'];
  mode?: RunSnapshot['mode'];
  market?: string;
  fillModelRequested?: RunSnapshot['fillModelRequested'];
  fillModelApplied?: RunSnapshot['fillModelApplied'];
  entryPolicy?: string;
}>;

@Injectable()
export class RunsService {
  private readonly runs = new Map<string, RunSnapshot>();
  private readonly events = new Map<string, WsEventEnvelopeDto[]>();

  seedRun(runId: string, options?: SeedRunOptions): void {
    if (this.runs.has(runId)) {
      return;
    }

    this.runs.set(runId, {
      runId,
      strategyId: options?.strategyId ?? 'STRAT_B',
      mode: options?.mode ?? 'PAPER',
      fillModelRequested: 'AUTO',
      fillModelApplied: 'NEXT_OPEN',
      entryPolicy: 'AUTO',
      market: options?.market ?? 'KRW-XRP',
      createdAt: new Date().toISOString(),
      eventCount: 0,
      lastSeq: 0
    });

    this.events.set(runId, []);
  }

  ingestEvent(event: WsEventEnvelopeDto): void {
    this.seedRun(event.runId);

    const arr = this.events.get(event.runId) ?? [];
    arr.push(event);
    this.events.set(event.runId, arr.slice(-500));

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

  listRuns(): RunSnapshot[] {
    return [...this.runs.values()]
      .map((run) => ({
        ...run,
        ...this.computeKpi(this.events.get(run.runId) ?? [])
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getRun(runId: string): (RunSnapshot & { events: WsEventEnvelopeDto[]; kpi: RunKpi }) | undefined {
    const run = this.runs.get(runId);
    if (!run) {
      return undefined;
    }
    const events = this.events.get(runId) ?? [];
    return {
      ...run,
      events,
      kpi: this.computeKpi(events)
    };
  }

  getEventsJsonl(runId: string): string | undefined {
    const run = this.getRun(runId);
    if (!run) {
      return undefined;
    }
    return run.events.map((event) => JSON.stringify(event)).join('\n');
  }

  getTradesCsv(runId: string): string | undefined {
    const run = this.getRun(runId);
    if (!run) {
      return undefined;
    }

    const fills = run.events.filter((event) => event.eventType === 'FILL');
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

  getCandles(runId: string, limit: number): CandleDto[] | undefined {
    const run = this.getRun(runId);
    if (!run) {
      return undefined;
    }

    const cappedLimit = Math.max(1, Math.min(1000, limit));
    const map = new Map<number, CandleDto>();

    run.events.forEach((event) => {
      const payload = event.payload as Readonly<Record<string, unknown>>;
      const nested = payload.candle as Readonly<Record<string, unknown>> | undefined;
      const source = nested ?? payload;
      const time = source.time;
      const open = source.open;
      const high = source.high;
      const low = source.low;
      const close = source.close;

      if (
        typeof time !== 'number' ||
        typeof open !== 'number' ||
        typeof high !== 'number' ||
        typeof low !== 'number' ||
        typeof close !== 'number'
      ) {
        return;
      }

      map.set(time, { time, open, high, low, close });
    });

    return [...map.values()]
      .sort((a, b) => a.time - b.time)
      .slice(-cappedLimit);
  }

  updateRunControl(runId: string, input: RunControlInput): RunSnapshot | undefined {
    const prev = this.runs.get(runId);
    if (!prev) {
      return undefined;
    }
    const next: RunSnapshot = {
      ...prev,
      strategyId: input.strategyId ?? prev.strategyId,
      mode: input.mode ?? prev.mode,
      market: input.market ?? prev.market,
      fillModelRequested: input.fillModelRequested ?? prev.fillModelRequested,
      fillModelApplied: input.fillModelApplied ?? prev.fillModelApplied,
      entryPolicy: input.entryPolicy ?? prev.entryPolicy
    };
    this.runs.set(runId, next);
    return next;
  }

  private computeKpi(events: readonly WsEventEnvelopeDto[]): RunKpi {
    const fills = events.filter((event) => event.eventType === 'FILL');
    const exits = events.filter((event) => event.eventType === 'EXIT');
    const pnlSeries = exits
      .map((event) => {
        const payload = event.payload as Readonly<Record<string, unknown>>;
        return typeof payload.pnlPct === 'number' ? payload.pnlPct : undefined;
      })
      .filter((value): value is number => typeof value === 'number');

    const sumReturnPct = pnlSeries.reduce((acc, value) => acc + value, 0);
    const winCount = pnlSeries.filter((value) => value > 0).length;
    const winRate = pnlSeries.length > 0 ? (winCount / pnlSeries.length) * 100 : 0;

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
      mddPct: Number(mdd.toFixed(4))
    };
  }
}
