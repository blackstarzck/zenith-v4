import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WsEventEnvelopeDto } from '@zenith/contracts';
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Flex,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { LineStyle, type UTCTimestamp } from 'lightweight-charts';
import { httpGet, httpPatch, httpPost } from '../../../shared/api/http';
import {
  ChartPanel,
  type ChartCandle,
  type ChartLinePoint,
  type ChartOverlayLine,
  type ChartOverlayMarker
} from '../../../shared/chart/chart-panel';
import { RealtimeStatusBadge } from '../../../shared/realtime/components/realtime-status-badge';
import { useRealtimeStatus } from '../../../shared/realtime/hooks/use-realtime-status';
import { useRunEventsSocket } from '../../../shared/realtime/hooks/use-run-events-socket';

const { Title, Text } = Typography;

const STRATEGY_IDS = ['STRAT_A', 'STRAT_B', 'STRAT_C'] as const;
const STRATEGY_CHART_THEME = {
  STRAT_A: {
    title: 'A: BB Reclaim',
    description: 'Bollinger reclaim + RSI/ADX filter',
    overlays: ['BB Upper', 'BB Mid', 'BB Lower']
  },
  STRAT_B: {
    title: 'B: OB+FVG',
    description: 'POI zone + EMA trend entry',
    overlays: ['EMA 20', 'EMA 60', 'POI High', 'POI Low']
  },
  STRAT_C: {
    title: 'C: Profit-Max Scalper',
    description: '브레이크아웃 기준선 + 단기 추세 EMA',
    overlays: ['Breakout Ref', 'EMA 14']
  }
} as const;

const LIVE_RUN_ID = 'run-dev-0001';
const DEFAULT_SEED_CAPITAL_KRW = Number(import.meta.env.VITE_SEED_CAPITAL_KRW ?? '1000000');
const MARKET_STREAM_STALE_THRESHOLD_MS = 30_000;

type RunMode = 'PAPER' | 'SEMI_AUTO' | 'AUTO' | 'LIVE';
type StrategyId = (typeof STRATEGY_IDS)[number];

type FillModelRequested = 'AUTO' | 'NEXT_OPEN' | 'ON_CLOSE';
type FillModelApplied = 'NEXT_OPEN' | 'ON_CLOSE';

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

type RiskSnapshot = Readonly<{
  dailyLossLimitPct: number;
  maxConsecutiveLosses: number;
  maxDailyOrders: number;
  killSwitch: boolean;
}>;

type RunConfig = Readonly<{
  runId: string;
  strategyId: StrategyId;
  strategyVersion: string;
  mode: RunMode;
  market: string;
  fillModelRequested: FillModelRequested;
  fillModelApplied: FillModelApplied;
  entryPolicy: string;
  riskSnapshot: RiskSnapshot;
  updatedAt: string;
}>;

type RunHistoryRow = Readonly<{
  runId: string;
  strategyId: StrategyId;
  strategyVersion: string;
  mode: RunMode;
  fillModelRequested: FillModelRequested;
  fillModelApplied: FillModelApplied;
  entryPolicy: string;
  market: string;
  createdAt: string;
  eventCount: number;
  lastSeq: number;
  lastEventAt?: string;
}> & RunKpi;

type RunDetail = Readonly<{
  runId: string;
  strategyId: StrategyId;
  strategyVersion: string;
  mode: RunMode;
  market: string;
  fillModelRequested: FillModelRequested;
  fillModelApplied: FillModelApplied;
  entryPolicy: string;
  runConfig: RunConfig;
  events: readonly WsEventEnvelopeDto[];
  kpi: RunKpi;
}>;

type TradeRow = Readonly<{
  key: string;
  eventTs: string;
  seq: number;
  side: string;
  fillPrice: string;
  traceId: string;
}>;

type StrategySection = Readonly<{
  strategyId: StrategyId;
  runId?: string;
  strategyVersion?: string;
  mode?: RunMode;
  market?: string;
  fillModelRequested?: FillModelRequested;
  fillModelApplied?: FillModelApplied;
  entryPolicy?: string;
  runConfig?: RunConfig;
  kpi?: RunKpi;
  events: readonly WsEventEnvelopeDto[];
  candles: readonly ChartCandle[];
  gapCount: number;
}>;

type StrategySections = Readonly<Record<StrategyId, StrategySection>>;

function createEmptySection(strategyId: StrategyId): StrategySection {
  return {
    strategyId,
    events: [],
    candles: [],
    gapCount: 0
  };
}

function createInitialSections(): StrategySections {
  return {
    STRAT_A: createEmptySection('STRAT_A'),
    STRAT_B: createEmptySection('STRAT_B'),
    STRAT_C: createEmptySection('STRAT_C')
  };
}

function isStrategyId(value: unknown): value is StrategyId {
  return value === 'STRAT_A' || value === 'STRAT_B' || value === 'STRAT_C';
}

function extractCandle(payload: Readonly<Record<string, unknown>>): ChartCandle | undefined {
  const nested = payload.candle as Readonly<Record<string, unknown>> | undefined;
  const source = nested ?? payload;

  const time = source.time;
  const open = source.open;
  const high = source.high;
  const low = source.low;
  const close = source.close;
  const volume = typeof source.volume === 'number'
    ? source.volume
    : typeof source.tradeVolume === 'number'
      ? source.tradeVolume
      : undefined;

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
    ...(typeof volume === 'number' ? { volume } : {})
  } as ChartCandle;
}

function upsertCandle(prev: readonly ChartCandle[], next: ChartCandle): readonly ChartCandle[] {
  const last = prev[prev.length - 1];
  if (!last) {
    return [next];
  }
  if (last.time === next.time) {
    return [...prev.slice(0, -1), next];
  }
  if (last.time > next.time) {
    return prev;
  }
  const merged = [...prev, next];
  return merged.slice(-300);
}

function mergeCandles(
  prev: readonly ChartCandle[],
  next: readonly ChartCandle[]
): readonly ChartCandle[] {
  if (prev.length === 0) {
    return next;
  }
  if (next.length === 0) {
    return prev;
  }

  const byTime = new Map<number, ChartCandle>();
  prev.forEach((candle) => {
    byTime.set(candle.time, candle);
  });
  next.forEach((candle) => {
    byTime.set(candle.time, candle);
  });

  return [...byTime.values()]
    .sort((a, b) => a.time - b.time)
    .slice(-300);
}

function mergeEvents(
  prev: readonly WsEventEnvelopeDto[],
  next: readonly WsEventEnvelopeDto[]
): readonly WsEventEnvelopeDto[] {
  if (prev.length === 0) {
    return next;
  }
  if (next.length === 0) {
    return prev;
  }

  const bySeq = new Map<number, WsEventEnvelopeDto>();
  prev.forEach((event) => {
    bySeq.set(event.seq, event);
  });
  next.forEach((event) => {
    bySeq.set(event.seq, event);
  });

  return [...bySeq.values()]
    .sort((a, b) => a.seq - b.seq)
    .slice(-500);
}

function mergeSectionSnapshot(prev: StrategySection, next: StrategySection): StrategySection {
  const events = mergeEvents(prev.events, next.events);
  const candles = mergeCandles(prev.candles, next.candles);
  const prevMaxSeq = prev.events.reduce((max, event) => Math.max(max, event.seq), 0);
  const nextMaxSeq = next.events.reduce((max, event) => Math.max(max, event.seq), 0);

  return {
    ...next,
    ...(next.runId ?? prev.runId ? { runId: next.runId ?? prev.runId } : {}),
    ...(next.strategyVersion ?? prev.strategyVersion
      ? { strategyVersion: next.strategyVersion ?? prev.strategyVersion }
      : {}),
    ...(next.mode ?? prev.mode ? { mode: next.mode ?? prev.mode } : {}),
    ...(next.market ?? prev.market ? { market: next.market ?? prev.market } : {}),
    ...(next.fillModelRequested ?? prev.fillModelRequested
      ? { fillModelRequested: next.fillModelRequested ?? prev.fillModelRequested }
      : {}),
    ...(next.fillModelApplied ?? prev.fillModelApplied
      ? { fillModelApplied: next.fillModelApplied ?? prev.fillModelApplied }
      : {}),
    ...(next.entryPolicy ?? prev.entryPolicy
      ? { entryPolicy: next.entryPolicy ?? prev.entryPolicy }
      : {}),
    ...(next.runConfig ?? prev.runConfig ? { runConfig: next.runConfig ?? prev.runConfig } : {}),
    ...((nextMaxSeq >= prevMaxSeq ? (next.kpi ?? prev.kpi) : (prev.kpi ?? next.kpi))
      ? { kpi: nextMaxSeq >= prevMaxSeq ? (next.kpi ?? prev.kpi) : (prev.kpi ?? next.kpi) }
      : {}),
    events,
    candles,
    gapCount: computeGapCount(events)
  };
}

function mergeStrategySections(prev: StrategySections, next: StrategySections): StrategySections {
  return {
    STRAT_A: mergeSectionSnapshot(prev.STRAT_A, next.STRAT_A),
    STRAT_B: mergeSectionSnapshot(prev.STRAT_B, next.STRAT_B),
    STRAT_C: mergeSectionSnapshot(prev.STRAT_C, next.STRAT_C)
  };
}

function toUtcSecond(isoTime: string): UTCTimestamp | undefined {
  const ms = Date.parse(isoTime);
  if (!Number.isFinite(ms)) {
    return undefined;
  }
  return Math.floor(ms / 1000) as UTCTimestamp;
}

function emaSeries(candles: readonly ChartCandle[], period: number): ChartLinePoint[] {
  if (candles.length < period || period <= 0) {
    return [];
  }

  const points: ChartLinePoint[] = [];
  const k = 2 / (period + 1);
  let prevEma: number | undefined;

  candles.forEach((candle, index) => {
    const close = candle.close;
    prevEma = typeof prevEma === 'number' ? close * k + prevEma * (1 - k) : close;
    if (index + 1 >= period) {
      points.push({ time: candle.time, value: prevEma });
    }
  });

  return points;
}

function std(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const avg = values.reduce((acc, value) => acc + value, 0) / values.length;
  const variance = values.reduce((acc, value) => acc + (value - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function bollingerSeries(
  candles: readonly ChartCandle[],
  period: number,
  stdMultiplier: number
): Readonly<{ upper: ChartLinePoint[]; mid: ChartLinePoint[]; lower: ChartLinePoint[] }> {
  if (candles.length < period || period <= 0) {
    return { upper: [], mid: [], lower: [] };
  }

  const upper: ChartLinePoint[] = [];
  const mid: ChartLinePoint[] = [];
  const lower: ChartLinePoint[] = [];
  const closes = candles.map((candle) => candle.close);

  candles.forEach((candle, index) => {
    if (index + 1 < period) {
      return;
    }
    const segment = closes.slice(index + 1 - period, index + 1);
    const mean = segment.reduce((acc, value) => acc + value, 0) / period;
    const segmentStd = std(segment);
    upper.push({ time: candle.time, value: mean + segmentStd * stdMultiplier });
    mid.push({ time: candle.time, value: mean });
    lower.push({ time: candle.time, value: mean - segmentStd * stdMultiplier });
  });

  return { upper, mid, lower };
}

function rollingExtremeSeries(
  candles: readonly ChartCandle[],
  lookback: number,
  kind: 'high' | 'low',
  usePreviousBars: boolean
): ChartLinePoint[] {
  if (candles.length < lookback || lookback <= 0) {
    return [];
  }

  const points: ChartLinePoint[] = [];

  candles.forEach((candle, index) => {
    const end = usePreviousBars ? index : index + 1;
    const start = Math.max(0, end - lookback);
    const window = candles.slice(start, end);
    if (window.length < lookback) {
      return;
    }
    const value = kind === 'high'
      ? Math.max(...window.map((item) => item.high))
      : Math.min(...window.map((item) => item.low));
    points.push({ time: candle.time, value });
  });

  return points;
}

function buildStrategyOverlayLines(strategyId: StrategyId, candles: readonly ChartCandle[]): ChartOverlayLine[] {
  if (candles.length === 0) {
    return [];
  }

  if (strategyId === 'STRAT_A') {
    const bb = bollingerSeries(candles, 20, 2);
    return [
      { id: 'A-BB-UPPER', label: 'BB Upper', color: '#16a34a', data: bb.upper, lineStyle: LineStyle.Dashed },
      { id: 'A-BB-MID', label: 'BB Mid', color: '#f59e0b', data: bb.mid },
      { id: 'A-BB-LOWER', label: 'BB Lower', color: '#dc2626', data: bb.lower, lineStyle: LineStyle.Dashed }
    ];
  }

  if (strategyId === 'STRAT_B') {
    return [
      { id: 'B-EMA20', label: 'EMA 20', color: '#0ea5e9', data: emaSeries(candles, 20), lineWidth: 2 },
      { id: 'B-EMA60', label: 'EMA 60', color: '#1d4ed8', data: emaSeries(candles, 60), lineWidth: 2 },
      {
        id: 'B-POI-HIGH',
        label: 'POI High',
        color: '#f59e0b',
        data: rollingExtremeSeries(candles, 12, 'high', false),
        lineStyle: LineStyle.Dotted
      },
      {
        id: 'B-POI-LOW',
        label: 'POI Low',
        color: '#fb923c',
        data: rollingExtremeSeries(candles, 12, 'low', false),
        lineStyle: LineStyle.Dotted
      }
    ];
  }

  return [
    {
      id: 'C-BREAKOUT-REF',
      label: 'Breakout Ref',
      color: '#8b5cf6',
      data: rollingExtremeSeries(candles, 10, 'high', true),
      lineStyle: LineStyle.LargeDashed
    },
    { id: 'C-EMA14', label: 'EMA 14', color: '#ec4899', data: emaSeries(candles, 14), lineWidth: 2 }
  ];
}

function resolveEventPrice(payload: Readonly<Record<string, unknown>>): number | undefined {
  if (typeof payload.fillPrice === 'number') {
    return payload.fillPrice;
  }
  if (typeof payload.price === 'number') {
    return payload.price;
  }
  if (typeof payload.suggestedPrice === 'number') {
    return payload.suggestedPrice;
  }
  const candle = payload.candle as Readonly<Record<string, unknown>> | undefined;
  if (candle && typeof candle.close === 'number') {
    return candle.close;
  }
  return undefined;
}

function isTradeFillEvent(event: WsEventEnvelopeDto): boolean {
  if (event.eventType !== 'FILL') {
    return false;
  }

  const payload = event.payload as Readonly<Record<string, unknown>>;
  return typeof payload.side === 'string' && typeof payload.fillPrice === 'number' && Number.isFinite(payload.fillPrice);
}

function toChartMarkers(events: readonly WsEventEnvelopeDto[]): ChartOverlayMarker[] {
  return events
    .filter((event) => (
      isTradeFillEvent(event) ||
      event.eventType === 'EXIT' ||
      event.eventType === 'SIGNAL_EMIT' ||
      event.eventType === 'RISK_BLOCK' ||
      event.eventType === 'LIVE_GUARD_BLOCKED'
    ))
    .slice(-80)
    .map((event) => {
      const payload = event.payload as Readonly<Record<string, unknown>>;
      const payloadCandle = payload.candle as Readonly<Record<string, unknown>> | undefined;
      const time = typeof payloadCandle?.time === 'number'
        ? (payloadCandle.time as UTCTimestamp)
        : toUtcSecond(event.eventTs);

      if (!time) {
        return undefined;
      }

      if (event.eventType === 'FILL') {
        const side = String(payload.side ?? '').toUpperCase();
        return {
          time,
          position: side === 'SELL' ? 'aboveBar' : 'belowBar',
          shape: side === 'SELL' ? 'arrowDown' : 'arrowUp',
          color: side === 'SELL' ? '#dc2626' : '#16a34a',
          text: side === 'SELL' ? 'SELL' : 'BUY'
        } as ChartOverlayMarker;
      }

      if (event.eventType === 'EXIT') {
        const price = resolveEventPrice(payload);
        return {
          time,
          position: 'inBar',
          shape: 'circle',
          color: '#f97316',
          text: String(payload.reason ?? 'EXIT'),
          ...(typeof price === 'number'
            ? { price }
            : {})
        } as ChartOverlayMarker;
      }

      if (event.eventType === 'SIGNAL_EMIT') {
        return {
          time,
          position: 'belowBar',
          shape: 'square',
          color: '#2563eb',
          text: String(payload.signal ?? 'SIGNAL')
        } as ChartOverlayMarker;
      }

      return {
        time,
        position: 'aboveBar',
        shape: 'square',
        color: '#b45309',
        text: 'RISK'
      } as ChartOverlayMarker;
    })
    .filter((marker): marker is ChartOverlayMarker => Boolean(marker));
}

function computeGapCount(events: readonly WsEventEnvelopeDto[]): number {
  if (events.length < 2) {
    return 0;
  }

  const asc = [...events].sort((a, b) => a.seq - b.seq);
  let gaps = 0;
  for (let i = 1; i < asc.length; i += 1) {
    const current = asc[i];
    const previous = asc[i - 1];
    if (!current || !previous) {
      continue;
    }
    if (current.seq > previous.seq + 1) {
      gaps += 1;
    }
  }
  return gaps;
}

function formatKrw(value: number): string {
  return `${Math.round(value).toLocaleString('ko-KR')} KRW`;
}

function formatDateTimeMinute(isoTime: string): string {
  const date = new Date(isoTime);
  if (Number.isNaN(date.getTime())) {
    return isoTime;
  }

  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');

  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

function isSameDayLocal(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function computeTodayPnlPct(events: readonly WsEventEnvelopeDto[]): number {
  const now = new Date();
  return events
    .filter((event) => event.eventType === 'EXIT')
    .reduce((sum, event) => {
      const eventDate = new Date(event.eventTs);
      if (!isSameDayLocal(now, eventDate)) {
        return sum;
      }
      const payload = event.payload as Readonly<Record<string, unknown>>;
      const pnlPct = payload.pnlPct;
      return typeof pnlPct === 'number' ? sum + pnlPct : sum;
    }, 0);
}

function computeRealtimeKpi(events: readonly WsEventEnvelopeDto[]): RunKpi {
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

function toTradeRows(events: readonly WsEventEnvelopeDto[]): TradeRow[] {
  return events
    .filter(isTradeFillEvent)
    .sort((a, b) => b.seq - a.seq)
    .slice(0, 10)
    .map((event) => {
      const payload = event.payload as Readonly<Record<string, unknown>>;
      const side = typeof payload.side === 'string' ? payload.side : 'UNKNOWN';
      const fillPrice = typeof payload.fillPrice === 'number'
        ? `${payload.fillPrice.toLocaleString('ko-KR')} KRW`
        : '-';

      return {
        key: `${event.traceId}-${event.seq}`,
        eventTs: formatDateTimeMinute(event.eventTs),
        seq: event.seq,
        side,
        fillPrice,
        traceId: event.traceId
      };
    });
}

const tradeColumns: ColumnsType<TradeRow> = [
  { title: '체결 시각', dataIndex: 'eventTs', key: 'eventTs' },
  { title: 'Seq', dataIndex: 'seq', key: 'seq', width: 90 },
  { title: '사이드', dataIndex: 'side', key: 'side', width: 100 },
  { title: '체결가', dataIndex: 'fillPrice', key: 'fillPrice', width: 160 }
];

export function RunsLivePage() {
  const {
    status,
    markLive,
    markError,
    markPaused,
    markEventReceived,
    setReconnectState,
    setPending
  } = useRealtimeStatus({ staleThresholdMs: MARKET_STREAM_STALE_THRESHOLD_MS });

  const [sections, setSections] = useState<StrategySections>(createInitialSections);
  const [sectionsLoading, setSectionsLoading] = useState(true);
  const [apiReady, setApiReady] = useState(false);
  const [apiErrorMessage, setApiErrorMessage] = useState<string | undefined>(undefined);

  const [controlStrategyId, setControlStrategyId] = useState<StrategyId>('STRAT_B');
  const [mode, setMode] = useState<RunMode>('PAPER');
  const [market, setMarket] = useState('KRW-XRP');
  const [strategyVersion, setStrategyVersion] = useState('v1');
  const [fillModelRequested, setFillModelRequested] = useState<FillModelRequested>('AUTO');
  const [fillModelApplied, setFillModelApplied] = useState<FillModelApplied>('NEXT_OPEN');
  const [isRunning, setIsRunning] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | undefined>(undefined);

  const lastSeqRef = useRef<Partial<Record<StrategyId, number>>>({});

  const controlledSection = sections[controlStrategyId];
  const controlRunId = controlledSection.runId ?? LIVE_RUN_ID;
  const entryPolicy = mode === 'SEMI_AUTO' ? 'NEXT_OPEN_AFTER_APPROVAL' : 'AUTO';
  const sharedCandles = useMemo(() => {
    return STRATEGY_IDS.reduce<readonly ChartCandle[]>((best, strategyId) => {
      const current = sections[strategyId].candles;
      return current.length > best.length ? current : best;
    }, []);
  }, [sections]);

  const hydrateControlFromSection = useCallback((next: StrategySection | undefined) => {
    if (!next) {
      return;
    }

    if (next.mode) {
      setMode(next.mode);
    }
    if (next.market) {
      setMarket(next.market);
    }
    if (next.strategyVersion) {
      setStrategyVersion(next.strategyVersion);
    }
    if (next.fillModelRequested) {
      setFillModelRequested(next.fillModelRequested);
    }
    if (next.fillModelApplied) {
      setFillModelApplied(next.fillModelApplied);
    }
  }, []);

  const refreshSections = useCallback(async () => {
    try {
      const history = await httpGet<RunHistoryRow[]>('/runs/history');

    const latestByStrategy = new Map<StrategyId, RunHistoryRow>();
    history.forEach((row) => {
      if (!latestByStrategy.has(row.strategyId)) {
        latestByStrategy.set(row.strategyId, row);
      }
    });

    const builtEntries = await Promise.all(
      STRATEGY_IDS.map(async (strategyId) => {
        const latest = latestByStrategy.get(strategyId);
        if (!latest) {
          return [strategyId, createEmptySection(strategyId)] as const;
        }

        const [detail, candles] = await Promise.all([
          httpGet<RunDetail>(`/runs/${latest.runId}`),
          httpGet<ChartCandle[]>(`/runs/${latest.runId}/candles?limit=300`)
        ]);

        const section: StrategySection = {
          strategyId,
          runId: detail.runId,
          strategyVersion: detail.strategyVersion,
          mode: detail.mode,
          market: detail.market,
          fillModelRequested: detail.fillModelRequested,
          fillModelApplied: detail.fillModelApplied,
          entryPolicy: detail.entryPolicy,
          runConfig: detail.runConfig,
          kpi: detail.kpi,
          events: detail.events,
          candles,
          gapCount: computeGapCount(detail.events)
        };

        return [strategyId, section] as const;
      })
    );

    const nextSections = builtEntries.reduce<Record<StrategyId, StrategySection>>((acc, [strategyId, section]) => {
      acc[strategyId] = section;
      const maxSeq = section.events.reduce((max, event) => Math.max(max, event.seq), 0);
      if (maxSeq > 0) {
        lastSeqRef.current[strategyId] = maxSeq;
      }
      return acc;
    }, {
      STRAT_A: createEmptySection('STRAT_A'),
      STRAT_B: createEmptySection('STRAT_B'),
      STRAT_C: createEmptySection('STRAT_C')
    });

    let fallbackCandles = STRATEGY_IDS
      .map((strategyId) => nextSections[strategyId].candles)
      .find((candles) => candles.length > 0);

    if (!fallbackCandles || fallbackCandles.length === 0) {
      try {
        const fetched = await httpGet<ChartCandle[]>(`/runs/${LIVE_RUN_ID}/candles?limit=300`);
        if (fetched.length > 0) {
          fallbackCandles = fetched;
        }
      } catch {
        // fallback ?????????곗뒭?????????怨뚯댅 ?????轅붽틓?蹂잛젂?④낮釉??????釉먮빱????????癲ル슢????
      }
    }

    if (fallbackCandles && fallbackCandles.length > 0) {
      STRATEGY_IDS.forEach((strategyId) => {
        const section = nextSections[strategyId];
        if (section.candles.length === 0) {
          nextSections[strategyId] = {
            ...section,
            candles: fallbackCandles
          };
        }
      });
    }

      let mergedSections = nextSections;
      setSections((prev) => {
        mergedSections = mergeStrategySections(prev, nextSections);
        return mergedSections;
      });
      setApiReady(true);
      setApiErrorMessage(undefined);
      hydrateControlFromSection(mergedSections[controlStrategyId]);
    } catch (error) {
      setApiReady(false);
      setApiErrorMessage(error instanceof Error ? error.message : 'Control sync failed');
      markError();
      setApiReady(false);
      setApiErrorMessage(error instanceof Error ? error.message : 'API request failed');
      markError();
    }
  }, [controlStrategyId, hydrateControlFromSection, markError]);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        await refreshSections();
      } finally {
        if (mounted) {
          setSectionsLoading(false);
        }
      }
    };

    void load();

    return () => {
      mounted = false;
    };
  }, [refreshSections]);

  useEffect(() => {
    if (sectionsLoading || !apiReady) {
      return;
    }

    const intervalId = setInterval(() => {
      void refreshSections();
    }, 30_000);

    return () => {
      clearInterval(intervalId);
    };
  }, [apiReady, refreshSections, sectionsLoading]);

  useEffect(() => {
    hydrateControlFromSection(sections[controlStrategyId]);
  }, [controlStrategyId, hydrateControlFromSection, sections]);

  const syncRunControl = useCallback(async () => {
    if (!apiReady) {
      return;
    }

    try {
      await httpPatch<RunDetail, Record<string, unknown>>(`/runs/${controlRunId}/control`, {
        strategyId: controlStrategyId,
        strategyVersion,
        mode,
        market,
        fillModelRequested,
        fillModelApplied,
        entryPolicy
      });
    } catch (error) {
      // ??癲??????????틯???????怨뚯댅 ?????濚밸Ŧ援??????용츧???⑤８???????????ㅻ쿋?????????틯????????
    }
  }, [
    apiReady,
    controlRunId,
    controlStrategyId,
    entryPolicy,
    fillModelApplied,
    fillModelRequested,
    markError,
    market,
    mode,
    strategyVersion
  ]);

  useEffect(() => {
    void syncRunControl();
  }, [syncRunControl]);

  const handlers = useMemo(
    () => ({
      onConnect: () => {
        markLive();
      },
      onDisconnect: () => {
        markPaused();
      },
      onReconnectAttempt: (attempt: number) => {
        setReconnectState({ retryCount: attempt, nextRetryInMs: 1000 });
      },
      onConnectError: () => {
        markError();
      },
      onEvent: (event: WsEventEnvelopeDto) => {
        const payload = event.payload as Readonly<Record<string, unknown>>;
        const payloadStrategy = payload.strategyId;
        const hasExplicitStrategy = isStrategyId(payloadStrategy);
        const strategyId = hasExplicitStrategy ? payloadStrategy : controlStrategyId;
        const nextCandle = extractCandle(payload);

        const prevSeq = lastSeqRef.current[strategyId];
        if (typeof prevSeq === 'number' && event.seq <= prevSeq) {
          return;
        }

        lastSeqRef.current[strategyId] = event.seq;

        if (nextCandle) {
          markEventReceived();
        }

        setSections((prev) => {
          const next = { ...prev };
          const current = next[strategyId] ?? createEmptySection(strategyId);
          const events = [...current.events, event].slice(-500);
          const nextStrategyVersion = typeof payload.strategyVersion === 'string'
            ? payload.strategyVersion
            : current.strategyVersion;
          const nextMarket = typeof payload.market === 'string'
            ? payload.market
            : current.market;

          next[strategyId] = {
            ...current,
            runId: event.runId,
            ...(nextStrategyVersion ? { strategyVersion: nextStrategyVersion } : {}),
            ...(nextMarket ? { market: nextMarket } : {}),
            events,
            gapCount: computeGapCount(events)
          };

          if (nextCandle) {
            if (hasExplicitStrategy) {
              const target = next[strategyId];
              next[strategyId] = {
                ...target,
                candles: upsertCandle(target.candles, nextCandle)
              };
            } else {
              STRATEGY_IDS.forEach((targetStrategyId) => {
                const target = next[targetStrategyId] ?? createEmptySection(targetStrategyId);
                next[targetStrategyId] = {
                  ...target,
                  ...(typeof payload.market === 'string' || target.market
                    ? { market: typeof payload.market === 'string' ? payload.market : target.market }
                    : {}),
                  candles: upsertCandle(target.candles, nextCandle)
                };
              });
            }
          }

          return next;
        });
      }
    }),
    [controlStrategyId, markError, markEventReceived, markLive, markPaused, setReconnectState]
  );

  const socketOptions = useMemo(
    () => ({
      enabled: apiReady,
      ...handlers
    }),
    [apiReady, handlers]
  );

  useRunEventsSocket(socketOptions);

  function triggerAction(action: string, nextState?: () => void): void {
    if (pendingAction) {
      return;
    }

    setPendingAction(action);
    setPending(true);

    if (action === 'Approve') {
      void httpPost<{ ok: true }>(`/runs/${controlRunId}/actions/approve`)
        .then(() => {
          nextState?.();
        })
        .catch((error) => {
          setApiReady(false);
          setApiErrorMessage(error instanceof Error ? error.message : 'Approve request failed');
          markError();
        })
        .finally(() => {
          setPending(false);
          setPendingAction(undefined);
        });
      return;
    }

    setTimeout(() => {
      nextState?.();
      setPending(false);
      setPendingAction(undefined);
    }, 700);
  }

  return (
    <Flex vertical gap={16} style={{ background: '#f3f6fa', padding: 16 }}>
      {apiErrorMessage ? (
        <Alert
          type="warning"
          showIcon
          title="API 연결이 일시적으로 끊겼습니다."
          description={`백엔드 응답이 복구되면 자동으로 다시 연결합니다. 마지막 오류: ${apiErrorMessage}`}
          action={<Button size="small" onClick={() => { void refreshSections(); }}>Retry</Button>}
        />
      ) : null}
      <div>
        <Title level={3} style={{ marginTop: 0, marginBottom: 6 }}>실시간 실행 콘솔</Title>
        <Text type="secondary">전략 성과와 시스템 리스크 상태를 한 화면에서 모니터링합니다.</Text>
      </div>

      {sectionsLoading ? (
        <Alert type="info" showIcon title="전략 섹션 데이터를 불러오는 중입니다." />
      ) : null}

      {STRATEGY_IDS.map((strategyId) => {
        const section = sections[strategyId];
        const isControlTarget = controlStrategyId === strategyId;
        const liveKpi = computeRealtimeKpi(section.events);
        const hasRealtimeTradeData = liveKpi.trades > 0 || liveKpi.exits > 0;
        const kpi = hasRealtimeTradeData ? liveKpi : (section.kpi ?? liveKpi);
        const riskSnapshot = section.runConfig?.riskSnapshot;
        const riskBlockCount = section.events.filter((event) => event.eventType === 'RISK_BLOCK' || event.eventType === 'LIVE_GUARD_BLOCKED').length;
        const pauseCount = section.events.filter((event) => event.eventType === 'PAUSE').length;
        const todayPnlPct = computeTodayPnlPct(section.events);
        const todayPnlAmount = DEFAULT_SEED_CAPITAL_KRW * (todayPnlPct / 100);
        const tradeRows = toTradeRows(section.events);
        const displayCandles = section.candles.length > 0 ? section.candles : sharedCandles;
        const isUsingSharedCandles = section.candles.length === 0 && displayCandles.length > 0;
        const chartOverlays = buildStrategyOverlayLines(strategyId, displayCandles);
        const chartMarkers = toChartMarkers(section.events);
        const chartTheme = STRATEGY_CHART_THEME[strategyId];
        const modeValue = isControlTarget ? mode : section.mode ?? mode;
        const marketValue = isControlTarget ? market : section.market ?? market;
        const fillModelRequestedValue = isControlTarget
          ? fillModelRequested
          : section.fillModelRequested ?? fillModelRequested;
        const fillModelAppliedValue = isControlTarget
          ? fillModelApplied
          : section.fillModelApplied ?? fillModelApplied;
        const strategyVersionValue = isControlTarget
          ? strategyVersion
          : section.strategyVersion ?? strategyVersion;

        return (
          <Card
            key={strategyId}
            title={<Text strong>{strategyId} 전략 섹션</Text>}
            extra={(
              <Space>
                <Tag color={controlStrategyId === strategyId ? 'blue' : 'default'}>
                  {controlStrategyId === strategyId ? '현재 제어 대상' : '보기'}
                </Tag>
                <Text type="secondary">runId: {section.runId ?? '-'}</Text>
              </Space>
            )}
          >
            <Row gutter={[14, 14]}>
              <Col xs={24} lg={16}>
                <Text strong style={{ display: 'block', marginBottom: 8 }}>차트</Text>
                <Space wrap size={[6, 6]} style={{ marginBottom: 8 }}>
                  <Tag color="processing">{chartTheme.title}</Tag>
                  {chartTheme.overlays.map((overlayLabel) => (
                    <Tag key={`${strategyId}-${overlayLabel}`}>{overlayLabel}</Tag>
                  ))}
                </Space>
                <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                  {chartTheme.description}
                </Text>
                <Alert
                  style={{ marginBottom: 10 }}
                  type="info"
                  showIcon
                  title={displayCandles.length === 0
                    ? '업비트 차트 데이터가 없습니다.'
                    : isUsingSharedCandles
                      ? '업비트 실시간 공용 마켓 스트림을 표시 중입니다.'
                      : '업비트 실시간 마켓 스트림을 표시 중입니다.'}
                />
                {displayCandles.length > 0 ? (
                  <ChartPanel
                    candles={displayCandles}
                    overlays={chartOverlays}
                    markers={chartMarkers}
                  />
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="캔들 데이터 없음" />
                )}
              </Col>

              <Col xs={24} lg={8}>
                <Text strong style={{ display: 'block', marginBottom: 8 }}>핵심 지표 / 리스크 모니터</Text>
                <Row gutter={[12, 12]}>
                  <Col span={12}>
                    <Statistic
                      title="평균 수익률"
                      value={kpi?.avgWinPct ?? 0}
                      precision={4}
                      suffix="%"
                      styles={{ content: { color: '#16a34a' } }}
                    />
                  </Col>
                  <Col span={12}>
                    <Statistic
                      title="평균 손실률"
                      value={kpi?.avgLossPct ?? 0}
                      precision={4}
                      suffix="%"
                      styles={{ content: { color: '#dc2626' } }}
                    />
                  </Col>
                  <Col span={12}>
                    <Statistic
                      title="당일 누적 손익 금액"
                      value={todayPnlAmount}
                      formatter={(value) => formatKrw(Number(value ?? 0))}
                      styles={{ content: { color: todayPnlAmount >= 0 ? '#16a34a' : '#dc2626' } }}
                    />
                  </Col>
                  <Col span={12}>
                    <Statistic
                      title="MDD"
                      value={kpi?.mddPct ?? 0}
                      precision={4}
                      suffix="%"
                      styles={{ content: { color: '#b91c1c', fontWeight: 700 } }}
                    />
                  </Col>
                  <Col span={12}>
                    <Statistic title="리스크 차단" value={riskBlockCount} />
                  </Col>
                  <Col span={12}>
                    <Statistic title="일시정지" value={pauseCount} />
                  </Col>
                  <Col span={12}>
                    <Statistic title="시퀀스 누락" value={section.gapCount} />
                  </Col>
                  <Col span={12}>
                    <Statistic title="연속 손실 제한" value={riskSnapshot?.maxConsecutiveLosses ?? 0} />
                  </Col>
                  <Col span={12}>
                    <Statistic title="일일 손실 한도" value={riskSnapshot?.dailyLossLimitPct ?? 0} suffix="%" precision={2} />
                  </Col>
                  <Col span={12}>
                    <Statistic title="일일 최대 주문" value={riskSnapshot?.maxDailyOrders ?? 0} />
                  </Col>
                  <Col span={12}>
                    <Statistic title="킬스위치" value={riskSnapshot?.killSwitch ? '활성' : '비활성'} />
                  </Col>
                  <Col span={12}>
                    <Statistic title="승률" value={kpi?.winRate ?? 0} suffix="%" precision={2} />
                  </Col>
                  <Col span={12}>
                    <Statistic title="누적 수익률" value={kpi?.sumReturnPct ?? 0} suffix="%" precision={4} />
                  </Col>
                  <Col span={12}>
                    <Statistic title="Profit Factor" value={kpi ? (kpi.profitFactor >= 9999 ? '무한대' : kpi.profitFactor.toFixed(4)) : '-'} />
                  </Col>
                </Row>
              </Col>
              <Col xs={24} lg={8}>
                <Flex justify="space-between" align="center" style={{ marginBottom: 10 }}>
                  <Text strong>실행 제어</Text>
                  <RealtimeStatusBadge status={status} />
                </Flex>

                <Space orientation="vertical" size={10} style={{ width: '100%' }}>
                  <Text type="secondary">
                    {'제어 runId: ' + (isControlTarget ? controlRunId : (section.runId ?? '-'))}
                  </Text>
                  <>
                    <Row gutter={[12, 12]}>
                      <Col xs={24} md={12} lg={24}>
                        <Text type="secondary">모드</Text>
                        <Select
                          value={modeValue}
                          onChange={(value) => {
                            setControlStrategyId(strategyId);
                            setMode(value as RunMode);
                          }}
                          style={{ width: '100%' }}
                          options={[
                            { value: 'PAPER', label: 'PAPER (모의)' },
                            { value: 'SEMI_AUTO', label: 'SEMI_AUTO (반자동)' },
                            { value: 'AUTO', label: 'AUTO (자동)' },
                            { value: 'LIVE', label: 'LIVE (실거래)' }
                          ]}
                        />
                      </Col>
                      <Col xs={24} md={12} lg={24}>
                        <Text type="secondary">마켓</Text>
                        <Select
                          value={marketValue}
                          onChange={(value) => {
                            setControlStrategyId(strategyId);
                            setMarket(value);
                          }}
                          style={{ width: '100%' }}
                          options={[
                            { value: 'KRW-XRP', label: 'KRW-XRP' },
                            { value: 'KRW-BTC', label: 'KRW-BTC' },
                            { value: 'KRW-ETH', label: 'KRW-ETH' }
                          ]}
                        />
                      </Col>
                      <Col xs={24} md={12} lg={24}>
                        <Text type="secondary">요청 체결 모델</Text>
                        <Select
                          value={fillModelRequestedValue}
                          onChange={(value) => {
                            setControlStrategyId(strategyId);
                            setFillModelRequested(value as FillModelRequested);
                          }}
                          style={{ width: '100%' }}
                          options={[
                            { value: 'AUTO', label: 'AUTO' },
                            { value: 'NEXT_OPEN', label: 'NEXT_OPEN' },
                            { value: 'ON_CLOSE', label: 'ON_CLOSE' }
                          ]}
                        />
                      </Col>
                      <Col xs={24} md={12} lg={24}>
                        <Text type="secondary">적용 체결 모델</Text>
                        <Select
                          value={fillModelAppliedValue}
                          onChange={(value) => {
                            setControlStrategyId(strategyId);
                            setFillModelApplied(value as FillModelApplied);
                          }}
                          style={{ width: '100%' }}
                          options={[
                            { value: 'NEXT_OPEN', label: 'NEXT_OPEN' },
                            { value: 'ON_CLOSE', label: 'ON_CLOSE' }
                          ]}
                        />
                      </Col>
                      <Col xs={24} md={12} lg={24}>
                        <Text type="secondary">전략 버전</Text>
                        <Select
                          value={strategyVersionValue}
                          onChange={(value) => {
                            setControlStrategyId(strategyId);
                            setStrategyVersion(value);
                          }}
                          style={{ width: '100%' }}
                          options={[{ value: strategyVersionValue, label: strategyVersionValue }]}
                        />
                      </Col>
                    </Row>

                    <Flex wrap gap={8}>
                      <Button type="primary" loading={pendingAction === 'Start'} disabled={Boolean(pendingAction) || isRunning} onClick={() => {
                        setControlStrategyId(strategyId);
                        triggerAction('Start', () => setIsRunning(true));
                      }}>
                        실행 시작
                      </Button>
                      <Button loading={pendingAction === 'Pause'} disabled={Boolean(pendingAction) || !isRunning} onClick={() => {
                        setControlStrategyId(strategyId);
                        triggerAction('Pause', markPaused);
                      }}>
                        일시정지
                      </Button>
                      <Button loading={pendingAction === 'Resume'} disabled={Boolean(pendingAction) || !isRunning} onClick={() => {
                        setControlStrategyId(strategyId);
                        triggerAction('Resume', markLive);
                      }}>
                        재개
                      </Button>
                      <Button loading={pendingAction === 'Stop'} disabled={Boolean(pendingAction) || !isRunning} onClick={() => {
                        setControlStrategyId(strategyId);
                        triggerAction('Stop', () => setIsRunning(false));
                      }}>
                        종료
                      </Button>
                      <Button loading={pendingAction === 'Approve'} disabled={Boolean(pendingAction)} onClick={() => {
                        setControlStrategyId(strategyId);
                        triggerAction('Approve');
                      }}>
                        승인
                      </Button>
                      <Button danger loading={pendingAction === 'KillSwitch'} disabled={Boolean(pendingAction)} onClick={() => {
                        setControlStrategyId(strategyId);
                        triggerAction('KillSwitch', markError);
                      }}>
                        긴급중지
                      </Button>
                    </Flex>
                  </>
                </Space>
              </Col>
              <Col xs={24} lg={16}>
                <Flex justify="space-between" align="center" style={{ marginBottom: 8 }}>
                  <Text strong>최근 체결 내역 (최신순)</Text>
                  <Text type="secondary">{tradeRows.length}건</Text>
                </Flex>
                <Table<TradeRow>
                  rowKey="key"
                  columns={tradeColumns}
                  dataSource={tradeRows}
                  size="small"
                  pagination={false}
                  locale={{ emptyText: '체결 내역이 없습니다.' }}
                />
              </Col>
            </Row>
          </Card>
        );
      })}
    </Flex>
  );
}
