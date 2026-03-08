import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CONNECTION_STATE,
  type RealtimeStatusDto,
  type WsEventEnvelopeDto
} from '@zenith/contracts';
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Flex,
  message,
  Row,
  Select,
  Space,
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
import type { RealtimeStatus } from '../../../shared/realtime/types/realtime-status';
import { UI_COLOR, getSignedMetricColor } from '../../../shared/ui/color-semantic';

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
const DEFAULT_RUN_ID_BY_STRATEGY = {
  STRAT_A: 'run-strat-a-0001',
  STRAT_B: 'run-strat-b-0001',
  STRAT_C: 'run-strat-c-0001'
} as const;

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
  seedKrw: number;
  maxPositionRatio: number;
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
  latestEntryReadiness?: EntryReadinessSnapshot;
  realtimeStatus?: RealtimeStatusDto;
}>;

type TradeRow = Readonly<{
  key: string;
  eventTs: string;
  seq: number;
  side: string;
  qty: string;
  fillPrice: string;
  notionalKrw: string;
  traceId: string;
}>;

type StrategySummaryRow = Readonly<{
  key: StrategyId;
  strategyId: StrategyId;
  strategyLabel: string;
  runId?: string;
  totalPnlKrw: number;
  totalPnlPct: number;
  positionQty: number;
  avgEntryPriceKrw: number;
  avgWinPct: number;
  avgLossPct: number;
  todayPnlAmount: number;
  mddPct: number;
  entryReadinessPct: number;
  entryReadinessColor: string;
  winRate: number;
  sumReturnPct: number;
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
  latestEntryReadiness?: EntryReadinessSnapshot;
  realtimeStatus?: RealtimeStatus;
  events: readonly WsEventEnvelopeDto[];
  candles: readonly ChartCandle[];
  gapCount: number;
}>;

type StrategySections = Readonly<Record<StrategyId, StrategySection>>;
type StrategyFillEvents = Readonly<Record<StrategyId, readonly WsEventEnvelopeDto[]>>;
type StrategyFillPagination = Readonly<Record<StrategyId, Readonly<{ page: number; pageSize: number; total: number }>>>;
type StrategyFillPageResponse = Readonly<{
  items: readonly WsEventEnvelopeDto[];
  total: number;
  page: number;
  pageSize: number;
}>;

type StrategyAccountSummary = Readonly<{
  strategyId: StrategyId;
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

type StrategyAccountSummaries = Readonly<Record<StrategyId, StrategyAccountSummary | undefined>>;
type StrategyEntryReadinessById = Readonly<Record<StrategyId, EntryReadinessSnapshot | undefined>>;
const ZERO_KPI: RunKpi = {
  trades: 0,
  exits: 0,
  winRate: 0,
  sumReturnPct: 0,
  mddPct: 0,
  profitFactor: 0,
  avgWinPct: 0,
  avgLossPct: 0
};

const EMPTY_ENTRY_READINESS_SNAPSHOT: EntryReadinessSnapshot = {
  entryReadinessPct: 0,
  entryReady: false,
  entryExecutable: false,
  reason: 'ENTRY_WAIT',
  inPosition: false
};

function toRealtimeStatus(input?: RealtimeStatusDto): RealtimeStatus | undefined {
  if (!input) {
    return undefined;
  }

  const lastEventAtMs = input.lastEventAt ? Date.parse(input.lastEventAt) : Number.NaN;
  const isStale = Number.isFinite(lastEventAtMs)
    ? Date.now() - lastEventAtMs > input.staleThresholdMs
    : false;

  return {
    connectionState: input.connectionState,
    isPending: false,
    isStale,
    retryCount: input.retryCount ?? 0,
    ...(input.lastEventAt ? { lastEventAt: input.lastEventAt } : {}),
    ...(typeof input.queueDepth === 'number' ? { queueDepth: input.queueDepth } : {}),
    ...(typeof input.nextRetryInMs === 'number' ? { nextRetryInMs: input.nextRetryInMs } : {}),
    staleThresholdMs: input.staleThresholdMs
  };
}

function touchRealtimeStatus(status: RealtimeStatus | undefined, eventTs: string): RealtimeStatus {
  const queueDepth = status?.queueDepth;
  const connectionState = status?.connectionState === CONNECTION_STATE.RECONNECTING ||
    status?.connectionState === CONNECTION_STATE.PAUSED ||
    status?.connectionState === CONNECTION_STATE.ERROR
    ? status.connectionState
    : (typeof queueDepth === 'number' && queueDepth > 0
      ? CONNECTION_STATE.DELAYED
      : CONNECTION_STATE.LIVE);

  return {
    connectionState,
    isPending: status?.isPending ?? false,
    isStale: false,
    retryCount: status?.retryCount ?? 0,
    lastEventAt: eventTs,
    ...(typeof queueDepth === 'number' ? { queueDepth } : {}),
    ...(typeof status?.nextRetryInMs === 'number' ? { nextRetryInMs: status.nextRetryInMs } : {}),
    ...(typeof status?.staleThresholdMs === 'number' ? { staleThresholdMs: status.staleThresholdMs } : {})
  };
}

function resolveDisplayRealtimeStatus(
  sectionStatus: RealtimeStatus | undefined,
  liveStatus: RealtimeStatus,
  isControlTarget: boolean
): RealtimeStatus {
  if (!sectionStatus || !isControlTarget) {
    return sectionStatus ?? liveStatus;
  }

  const overlayTransport = liveStatus.connectionState === CONNECTION_STATE.RECONNECTING ||
    liveStatus.connectionState === CONNECTION_STATE.PAUSED ||
    liveStatus.connectionState === CONNECTION_STATE.ERROR;
  const nextRetryInMs = overlayTransport ? liveStatus.nextRetryInMs : sectionStatus.nextRetryInMs;
  const lastEventAt = liveStatus.lastEventAt ?? sectionStatus.lastEventAt;

  return {
    ...sectionStatus,
    connectionState: overlayTransport ? liveStatus.connectionState : sectionStatus.connectionState,
    isPending: liveStatus.isPending,
    isStale: sectionStatus.isStale || liveStatus.isStale,
    retryCount: overlayTransport ? liveStatus.retryCount : sectionStatus.retryCount,
    ...(lastEventAt ? { lastEventAt } : {}),
    ...(typeof nextRetryInMs === 'number' ? { nextRetryInMs } : {}),
    ...(typeof sectionStatus.queueDepth === 'number' ? { queueDepth: sectionStatus.queueDepth } : {}),
    ...(typeof sectionStatus.staleThresholdMs === 'number' ? { staleThresholdMs: sectionStatus.staleThresholdMs } : {})
  };
}

function createEmptySection(strategyId: StrategyId): StrategySection {
  return {
    strategyId,
    runId: DEFAULT_RUN_ID_BY_STRATEGY[strategyId],
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

function createInitialFillEvents(): StrategyFillEvents {
  return {
    STRAT_A: [],
    STRAT_B: [],
    STRAT_C: []
  };
}

function createInitialFillPagination(): StrategyFillPagination {
  return {
    STRAT_A: { page: 1, pageSize: 50, total: 0 },
    STRAT_B: { page: 1, pageSize: 50, total: 0 },
    STRAT_C: { page: 1, pageSize: 50, total: 0 }
  };
}

function createInitialAccountSummaries(): StrategyAccountSummaries {
  return {
    STRAT_A: undefined,
    STRAT_B: undefined,
    STRAT_C: undefined
  };
}

function roundMoney(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Number(value.toFixed(2));
}

function roundQty(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Number(value.toFixed(8));
}

function roundPct(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Number(value.toFixed(4));
}

function createEmptyAccountSummary(
  strategyId: StrategyId,
  previous?: StrategyAccountSummary
): StrategyAccountSummary {
  const seedCapitalKrw = previous?.seedCapitalKrw ?? DEFAULT_SEED_CAPITAL_KRW;

  return {
    strategyId,
    seedCapitalKrw,
    cashKrw: previous?.cashKrw ?? seedCapitalKrw,
    positionQty: previous?.positionQty ?? 0,
    avgEntryPriceKrw: previous?.avgEntryPriceKrw ?? 0,
    markPriceKrw: previous?.markPriceKrw ?? 0,
    marketValueKrw: previous?.marketValueKrw ?? 0,
    equityKrw: previous?.equityKrw ?? seedCapitalKrw,
    realizedPnlKrw: previous?.realizedPnlKrw ?? 0,
    unrealizedPnlKrw: previous?.unrealizedPnlKrw ?? 0,
    totalPnlKrw: previous?.totalPnlKrw ?? 0,
    totalPnlPct: previous?.totalPnlPct ?? 0,
    fillCount: previous?.fillCount ?? 0,
    ...(previous?.lastFillAt ? { lastFillAt: previous.lastFillAt } : {})
  };
}

function finalizeAccountSummary(summary: StrategyAccountSummary): StrategyAccountSummary {
  const effectiveMarkPriceKrw = summary.markPriceKrw > 0
    ? summary.markPriceKrw
    : summary.positionQty > 0
      ? summary.avgEntryPriceKrw
      : 0;
  const marketValueKrw = summary.positionQty * effectiveMarkPriceKrw;
  const equityKrw = summary.cashKrw + marketValueKrw;
  const unrealizedPnlKrw = summary.positionQty > 0
    ? (effectiveMarkPriceKrw - summary.avgEntryPriceKrw) * summary.positionQty
    : 0;
  const totalPnlKrw = equityKrw - summary.seedCapitalKrw;
  const totalPnlPct = summary.seedCapitalKrw > 0 ? (totalPnlKrw / summary.seedCapitalKrw) * 100 : 0;

  return {
    ...summary,
    cashKrw: roundMoney(summary.cashKrw),
    positionQty: roundQty(summary.positionQty),
    avgEntryPriceKrw: roundMoney(summary.avgEntryPriceKrw),
    markPriceKrw: roundMoney(effectiveMarkPriceKrw),
    marketValueKrw: roundMoney(marketValueKrw),
    equityKrw: roundMoney(equityKrw),
    realizedPnlKrw: roundMoney(summary.realizedPnlKrw),
    unrealizedPnlKrw: roundMoney(unrealizedPnlKrw),
    totalPnlKrw: roundMoney(totalPnlKrw),
    totalPnlPct: roundPct(totalPnlPct)
  };
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

function applyFillToAccountSummary(
  strategyId: StrategyId,
  previous: StrategyAccountSummary | undefined,
  event: WsEventEnvelopeDto
): StrategyAccountSummary | undefined {
  if (event.eventType !== 'FILL') {
    return previous;
  }

  const payload = event.payload as Readonly<Record<string, unknown>>;
  const side = typeof payload.side === 'string' ? payload.side.toUpperCase() : '';
  const fillPrice = typeof payload.fillPrice === 'number' && Number.isFinite(payload.fillPrice)
    ? payload.fillPrice
    : undefined;
  const qty = resolveFillQty(payload);

  if (!fillPrice || qty <= 0 || (side !== 'BUY' && side !== 'SELL')) {
    return previous;
  }

  const base = createEmptyAccountSummary(strategyId, previous);
  let nextCashKrw = base.cashKrw;
  let nextPositionQty = base.positionQty;
  let nextAvgEntryPriceKrw = base.avgEntryPriceKrw;
  let nextRealizedPnlKrw = base.realizedPnlKrw;

  if (side === 'BUY') {
    const combinedQty = base.positionQty + qty;
    nextAvgEntryPriceKrw = combinedQty > 0
      ? ((base.avgEntryPriceKrw * base.positionQty) + (fillPrice * qty)) / combinedQty
      : 0;
    nextPositionQty = combinedQty;
    nextCashKrw = base.cashKrw - (fillPrice * qty);
  } else {
    const matchedQty = Math.min(base.positionQty, qty);
    if (matchedQty > 0) {
      nextRealizedPnlKrw += (fillPrice - base.avgEntryPriceKrw) * matchedQty;
    }
    nextPositionQty = Math.max(0, base.positionQty - qty);
    nextAvgEntryPriceKrw = nextPositionQty > 0 ? base.avgEntryPriceKrw : 0;
    nextCashKrw = base.cashKrw + (fillPrice * qty);
  }

  return finalizeAccountSummary({
    ...base,
    cashKrw: nextCashKrw,
    positionQty: nextPositionQty,
    avgEntryPriceKrw: nextAvgEntryPriceKrw,
    markPriceKrw: fillPrice,
    realizedPnlKrw: nextRealizedPnlKrw,
    fillCount: base.fillCount + 1,
    lastFillAt: event.eventTs
  });
}

function applyMarkPriceToAccountSummary(
  strategyId: StrategyId,
  previous: StrategyAccountSummary | undefined,
  markPriceKrw: number
): StrategyAccountSummary | undefined {
  if (!Number.isFinite(markPriceKrw) || markPriceKrw <= 0) {
    return previous;
  }

  return finalizeAccountSummary({
    ...createEmptyAccountSummary(strategyId, previous),
    markPriceKrw
  });
}

function createInitialEntryReadinessById(): StrategyEntryReadinessById {
  return {
    STRAT_A: EMPTY_ENTRY_READINESS_SNAPSHOT,
    STRAT_B: EMPTY_ENTRY_READINESS_SNAPSHOT,
    STRAT_C: EMPTY_ENTRY_READINESS_SNAPSHOT
  };
}

function isStrategyId(value: unknown): value is StrategyId {
  return value === 'STRAT_A' || value === 'STRAT_B' || value === 'STRAT_C';
}

function resolveStrategyIdFromRunId(runId: string | undefined): StrategyId | undefined {
  if (runId === DEFAULT_RUN_ID_BY_STRATEGY.STRAT_A) {
    return 'STRAT_A';
  }
  if (runId === DEFAULT_RUN_ID_BY_STRATEGY.STRAT_B) {
    return 'STRAT_B';
  }
  if (runId === DEFAULT_RUN_ID_BY_STRATEGY.STRAT_C) {
    return 'STRAT_C';
  }
  return undefined;
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
    ...(next.latestEntryReadiness ?? prev.latestEntryReadiness
      ? { latestEntryReadiness: next.latestEntryReadiness ?? prev.latestEntryReadiness }
      : {}),
    ...(next.realtimeStatus ?? prev.realtimeStatus
      ? { realtimeStatus: next.realtimeStatus ?? prev.realtimeStatus }
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
      { id: 'A-BB-UPPER', label: 'BB Upper', color: UI_COLOR.status.success, data: bb.upper, lineStyle: LineStyle.Dashed },
      { id: 'A-BB-MID', label: 'BB Mid', color: UI_COLOR.status.warning, data: bb.mid },
      { id: 'A-BB-LOWER', label: 'BB Lower', color: UI_COLOR.status.error, data: bb.lower, lineStyle: LineStyle.Dashed }
    ];
  }

  if (strategyId === 'STRAT_B') {
    return [
      { id: 'B-EMA20', label: 'EMA 20', color: '#0ea5e9', data: emaSeries(candles, 20), lineWidth: 2 },
      { id: 'B-EMA60', label: 'EMA 60', color: '#1d4ed8', data: emaSeries(candles, 60), lineWidth: 2 },
      {
        id: 'B-POI-HIGH',
        label: 'POI High',
        color: UI_COLOR.status.warning,
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
          color: side === 'SELL' ? UI_COLOR.trade.sell : UI_COLOR.trade.buy,
          text: side === 'SELL' ? 'SELL' : 'BUY'
        } as ChartOverlayMarker;
      }

      if (event.eventType === 'EXIT') {
        const price = resolveEventPrice(payload);
        return {
          time,
          position: 'inBar',
          shape: 'circle',
          color: UI_COLOR.status.warning,
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
          color: UI_COLOR.status.info,
          text: String(payload.signal ?? 'SIGNAL')
        } as ChartOverlayMarker;
      }

      return {
        time,
        position: 'aboveBar',
        shape: 'square',
        color: UI_COLOR.status.error,
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

function formatPct(value: number, fractionDigits = 2): string {
  return `${value.toLocaleString('ko-KR', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits
  })}%`;
}

function formatQty(value: number): string {
  if (!Number.isFinite(value)) {
    return '0';
  }
  if (Number.isInteger(value)) {
    return value.toLocaleString('ko-KR');
  }
  return value.toLocaleString('ko-KR', { maximumFractionDigits: 8 });
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizePct(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round(clamp(value, 0, 100));
}

function inferInPosition(events: readonly WsEventEnvelopeDto[]): boolean {
  const lastPositionUpdate = [...events]
    .filter((event) => event.eventType === 'POSITION_UPDATE')
    .sort((a, b) => b.seq - a.seq)[0];
  if (!lastPositionUpdate) {
    return false;
  }
  const payload = lastPositionUpdate.payload as Readonly<Record<string, unknown>>;
  return String(payload.side ?? '').toUpperCase() === 'LONG';
}

function resolveEntryReadinessMeta(
  readinessPct: number,
  inPosition: boolean
): Readonly<{ label: string; color: string }> {
  if (inPosition) {
    return { label: '보유 중', color: UI_COLOR.status.paused };
  }
  if (readinessPct >= 85) {
    return { label: '진입 임박', color: UI_COLOR.status.error };
  }
  if (readinessPct >= 70) {
    return { label: '주의 구간', color: UI_COLOR.status.warning };
  }
  return { label: '대기 구간', color: UI_COLOR.status.info };
}

type EntryReadinessSnapshot = Readonly<{
  entryReadinessPct: number;
  entryReady: boolean;
  entryExecutable: boolean;
  reason: string;
  inPosition: boolean;
}>;

function getLatestEntryReadiness(events: readonly WsEventEnvelopeDto[]): EntryReadinessSnapshot | undefined {
  const readinessEvent = [...events]
    .filter((event) => event.eventType === 'ENTRY_READINESS')
    .sort((a, b) => b.seq - a.seq)[0];
  if (!readinessEvent) {
    return undefined;
  }
  const payload = readinessEvent.payload as Readonly<Record<string, unknown>>;
  const entryReadinessPctRaw = payload.entryReadinessPct;
  const entryReadyRaw = payload.entryReady;
  const entryExecutableRaw = payload.entryExecutable;
  const reasonRaw = payload.reason;
  const inPositionRaw = payload.inPosition;
  return {
    entryReadinessPct: typeof entryReadinessPctRaw === 'number' ? normalizePct(entryReadinessPctRaw) : 0,
    entryReady: entryReadyRaw === true,
    entryExecutable: entryExecutableRaw === true,
    reason: typeof reasonRaw === 'string' ? reasonRaw : 'ENTRY_WAIT',
    inPosition: inPositionRaw === true
  };
}

function buildEntryReadinessByStrategy(
  sections: StrategySections,
  prev?: StrategyEntryReadinessById
): StrategyEntryReadinessById {
  return {
    STRAT_A: sections.STRAT_A.latestEntryReadiness ?? getLatestEntryReadiness(sections.STRAT_A.events) ?? prev?.STRAT_A ?? EMPTY_ENTRY_READINESS_SNAPSHOT,
    STRAT_B: sections.STRAT_B.latestEntryReadiness ?? getLatestEntryReadiness(sections.STRAT_B.events) ?? prev?.STRAT_B ?? EMPTY_ENTRY_READINESS_SNAPSHOT,
    STRAT_C: sections.STRAT_C.latestEntryReadiness ?? getLatestEntryReadiness(sections.STRAT_C.events) ?? prev?.STRAT_C ?? EMPTY_ENTRY_READINESS_SNAPSHOT
  };
}

function toTradeRows(events: readonly WsEventEnvelopeDto[]): TradeRow[] {
  return [...events]
    .sort((a, b) => {
      const tsDiff = Date.parse(b.eventTs) - Date.parse(a.eventTs);
      if (Number.isFinite(tsDiff) && tsDiff !== 0) {
        return tsDiff;
      }
      return b.seq - a.seq;
    })
    .map((event) => {
      const payload = event.payload as Readonly<Record<string, unknown>>;
      const side = typeof payload.side === 'string' ? payload.side : 'UNKNOWN';
      const qty = resolveFillQty(payload);
      const notionalRaw = typeof payload.notionalKrw === 'number' && Number.isFinite(payload.notionalKrw)
        ? payload.notionalKrw
        : typeof payload.fillPrice === 'number' && Number.isFinite(payload.fillPrice)
          ? payload.fillPrice * qty
          : undefined;
      const fillPrice = typeof payload.fillPrice === 'number'
        ? `${payload.fillPrice.toLocaleString('ko-KR')} KRW`
        : '-';

      return {
        key: `${event.traceId}-${event.seq}`,
        eventTs: formatDateTimeMinute(event.eventTs),
        seq: event.seq,
        side,
        qty: formatQty(qty),
        fillPrice,
        notionalKrw: typeof notionalRaw === 'number' ? formatKrw(notionalRaw) : '-',
        traceId: event.traceId
      };
    });
}

const tradeColumns: ColumnsType<TradeRow> = [
  { title: '체결 시각', dataIndex: 'eventTs', key: 'eventTs' },
  { title: 'Seq', dataIndex: 'seq', key: 'seq', width: 90 },
  { title: '사이드', dataIndex: 'side', key: 'side', width: 100 },
  { title: '수량', dataIndex: 'qty', key: 'qty', width: 120 },
  { title: '체결가', dataIndex: 'fillPrice', key: 'fillPrice', width: 160 },
  { title: '금액', dataIndex: 'notionalKrw', key: 'notionalKrw', width: 160 }
];

export function RunsLivePage() {
  const [messageApi, messageContextHolder] = message.useMessage();
  const {
    status,
    markLive,
    markError,
    markPaused,
    markEventReceived,
    setReconnectState,
    setPending,
    syncFromRemote
  } = useRealtimeStatus({ staleThresholdMs: MARKET_STREAM_STALE_THRESHOLD_MS });

  const [sections, setSections] = useState<StrategySections>(createInitialSections);
  const [fillEventsByStrategy, setFillEventsByStrategy] = useState<StrategyFillEvents>(createInitialFillEvents);
  const [fillPaginationByStrategy, setFillPaginationByStrategy] = useState<StrategyFillPagination>(createInitialFillPagination);
  const [accountSummariesByStrategy, setAccountSummariesByStrategy] = useState<StrategyAccountSummaries>(createInitialAccountSummaries);
  const [entryReadinessByStrategy, setEntryReadinessByStrategy] = useState<StrategyEntryReadinessById>(createInitialEntryReadinessById);
  const [baseCandles, setBaseCandles] = useState<readonly ChartCandle[]>([]);
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
  const lastEventTsRef = useRef<Partial<Record<StrategyId, string>>>({});
  const lastFillNoticeSeqRef = useRef<Partial<Record<StrategyId, number>>>({});

  const controlledSection = sections[controlStrategyId];
  const controlRunId = controlledSection.runId ?? LIVE_RUN_ID;
  const entryPolicy = mode === 'SEMI_AUTO' ? 'NEXT_OPEN_AFTER_APPROVAL' : 'AUTO';

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

  const fetchStrategyFillPage = useCallback(async (
    strategyId: StrategyId,
    page: number,
    pageSize: number
  ) => {
    const response = await httpGet<StrategyFillPageResponse>(
      `/runs/strategies/${strategyId}/fills?page=${Math.max(1, Math.floor(page))}&pageSize=${Math.max(1, Math.floor(pageSize))}`
    );
    setFillEventsByStrategy((prev) => ({
      ...prev,
      [strategyId]: response.items
    }));
    setFillPaginationByStrategy((prev) => ({
      ...prev,
      [strategyId]: {
        page: response.page,
        pageSize: response.pageSize,
        total: response.total
      }
    }));
  }, []);

  const fetchStrategyAccountSummary = useCallback(async (strategyId: StrategyId) => {
    const response = await httpGet<StrategyAccountSummary>(`/runs/strategies/${strategyId}/account-summary`);
    setAccountSummariesByStrategy((prev) => ({
      ...prev,
      [strategyId]: response
    }));
  }, []);

  const refreshSections = useCallback(async () => {
    try {
      try {
        const fetchedBaseCandles = await httpGet<ChartCandle[]>(`/runs/${LIVE_RUN_ID}/candles?limit=300`);
        setBaseCandles(fetchedBaseCandles);
      } catch {
        setBaseCandles([]);
      }

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
        const detailRealtimeStatus = toRealtimeStatus(detail.realtimeStatus);

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
          ...(detail.latestEntryReadiness ? { latestEntryReadiness: detail.latestEntryReadiness } : {}),
          ...(detailRealtimeStatus ? { realtimeStatus: detailRealtimeStatus } : {}),
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
      const latestEvent = [...section.events].sort((a, b) => {
        const tsDiff = Date.parse(b.eventTs) - Date.parse(a.eventTs);
        if (Number.isFinite(tsDiff) && tsDiff !== 0) {
          return tsDiff;
        }
        return b.seq - a.seq;
      })[0];
      if (maxSeq > 0) {
        lastSeqRef.current[strategyId] = maxSeq;
      }
      if (latestEvent?.eventTs) {
        lastEventTsRef.current[strategyId] = latestEvent.eventTs;
      }
      return acc;
    }, {
      STRAT_A: createEmptySection('STRAT_A'),
      STRAT_B: createEmptySection('STRAT_B'),
      STRAT_C: createEmptySection('STRAT_C')
    });
      setEntryReadinessByStrategy((prev) => buildEntryReadinessByStrategy(nextSections, prev));
      let mergedSections = nextSections;
      setSections((prev) => {
        mergedSections = mergeStrategySections(prev, nextSections);
        return mergedSections;
      });
      await Promise.all(STRATEGY_IDS.map((strategyId) => fetchStrategyAccountSummary(strategyId)));

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
  }, [controlStrategyId, fetchStrategyAccountSummary, hydrateControlFromSection, markError]);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        await refreshSections();
        await Promise.all(
          STRATEGY_IDS.map((strategyId) => fetchStrategyFillPage(strategyId, 1, 50))
        );
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
  }, [fetchStrategyFillPage, refreshSections]);

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

  useEffect(() => {
    syncFromRemote(sections[controlStrategyId].realtimeStatus);
  }, [controlStrategyId, sections, syncFromRemote]);

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
      // Best-effort control sync. Keep the live workspace usable if this request fails.
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
        const payloadRunStrategy = resolveStrategyIdFromRunId(event.runId);
        const hasExplicitStrategy = isStrategyId(payloadStrategy);
        const strategyId = hasExplicitStrategy
          ? payloadStrategy
          : (payloadRunStrategy ?? controlStrategyId);
        const nextCandle = extractCandle(payload);
        const latestEntryReadiness = event.eventType === 'ENTRY_READINESS'
          ? getLatestEntryReadiness([event])
          : undefined;

        const prevSeq = lastSeqRef.current[strategyId];
        const prevEventTs = lastEventTsRef.current[strategyId];
        if (typeof prevSeq === 'number' && event.seq <= prevSeq) {
          const eventTsMs = Date.parse(event.eventTs);
          const prevEventTsMs = typeof prevEventTs === 'string' ? Date.parse(prevEventTs) : Number.NaN;
          if (
            event.seq < prevSeq &&
            Number.isFinite(eventTsMs) &&
            Number.isFinite(prevEventTsMs) &&
            eventTsMs > prevEventTsMs
          ) {
            lastSeqRef.current[strategyId] = event.seq;
            lastEventTsRef.current[strategyId] = event.eventTs;
            void refreshSections();
          }
          return;
        }

        lastSeqRef.current[strategyId] = event.seq;
        lastEventTsRef.current[strategyId] = event.eventTs;

        if (strategyId === controlStrategyId) {
          markEventReceived();
        }

        if (event.eventType === 'FILL') {
          const sideRaw = payload.side;
          const fillPriceRaw = payload.fillPrice;
          if (typeof sideRaw === 'string' && typeof fillPriceRaw === 'number' && Number.isFinite(fillPriceRaw)) {
            const normalizedSide = sideRaw.toUpperCase();
            const qtyRaw = payload.qty;
            const quantityRaw = payload.quantity;
            const fillQty = typeof qtyRaw === 'number' && Number.isFinite(qtyRaw) && qtyRaw > 0
              ? qtyRaw
              : typeof quantityRaw === 'number' && Number.isFinite(quantityRaw) && quantityRaw > 0
                ? quantityRaw
                : 1;
            const notionalRaw = typeof payload.notionalKrw === 'number' && Number.isFinite(payload.notionalKrw)
              ? payload.notionalKrw
              : fillPriceRaw * fillQty;
            const sideLabel = normalizedSide === 'SELL' ? '매도' : '매수';
            const lastNotifiedSeq = lastFillNoticeSeqRef.current[strategyId] ?? 0;
            if (event.seq > lastNotifiedSeq) {
              lastFillNoticeSeqRef.current[strategyId] = event.seq;
              messageApi.open({
                type: normalizedSide === 'SELL' ? 'error' : 'success',
                content: `${strategyId} | ${sideLabel} | ${formatKrw(fillPriceRaw)} | 수량 ${formatQty(fillQty)} | 금액 ${formatKrw(notionalRaw)}`,
                duration: 2.2
              });
            }
          }

          setFillEventsByStrategy((prev) => {
            const current = prev[strategyId] ?? [];
            const deduped = current.filter((item) => !(item.seq === event.seq && item.runId === event.runId));
            const merged = [event, ...deduped]
              .sort((a, b) => {
                const tsDiff = Date.parse(b.eventTs) - Date.parse(a.eventTs);
                if (Number.isFinite(tsDiff) && tsDiff !== 0) {
                  return tsDiff;
                }
                return b.seq - a.seq;
              });
            const pageSize = fillPaginationByStrategy[strategyId]?.pageSize ?? 50;
            return {
              ...prev,
              [strategyId]: merged.slice(0, pageSize)
            };
          });
          setFillPaginationByStrategy((prev) => ({
            ...prev,
            [strategyId]: {
              ...prev[strategyId],
              total: (prev[strategyId]?.total ?? 0) + 1
            }
          }));
          setAccountSummariesByStrategy((prev) => ({
            ...prev,
            [strategyId]: applyFillToAccountSummary(strategyId, prev[strategyId], event)
          }));
        }

        if (latestEntryReadiness) {
          setEntryReadinessByStrategy((prev) => ({
            ...prev,
            [strategyId]: latestEntryReadiness
          }));
        }

        if (nextCandle) {
          setBaseCandles((prev) => upsertCandle(prev, nextCandle));
          setAccountSummariesByStrategy((prev) => {
            const targetStrategyIds = hasExplicitStrategy ? [strategyId] : STRATEGY_IDS;
            const nextSummaries = { ...prev };
            targetStrategyIds.forEach((targetStrategyId) => {
              nextSummaries[targetStrategyId] = applyMarkPriceToAccountSummary(
                targetStrategyId,
                prev[targetStrategyId],
                nextCandle.close
              );
            });
            return nextSummaries;
          });
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
            ...(latestEntryReadiness ? { latestEntryReadiness } : {}),
            realtimeStatus: touchRealtimeStatus(current.realtimeStatus, event.eventTs),
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
    [controlStrategyId, fillPaginationByStrategy, markError, markEventReceived, markLive, markPaused, messageApi, refreshSections, setReconnectState]
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

  const strategySummaryRows: StrategySummaryRow[] = STRATEGY_IDS.map((strategyId) => {
    const section = sections[strategyId];
    const accountSummary = accountSummariesByStrategy[strategyId];
    const fillPagination = fillPaginationByStrategy[strategyId];
    const liveKpi = computeRealtimeKpi(section.events);
    const hasAnyFill = (fillPagination.total ?? 0) > 0 ||
      (accountSummary?.fillCount ?? 0) > 0 ||
      liveKpi.trades > 0;
    const hasRealtimeTradeData = hasAnyFill && (liveKpi.trades > 0 || liveKpi.exits > 0);
    const kpi = hasAnyFill
      ? (hasRealtimeTradeData ? liveKpi : (section.kpi ?? liveKpi))
      : ZERO_KPI;
    const seedCapitalKrw = accountSummary?.seedCapitalKrw ?? DEFAULT_SEED_CAPITAL_KRW;
    const todayPnlPct = computeTodayPnlPct(section.events);
    const todayPnlAmount = hasAnyFill ? seedCapitalKrw * (todayPnlPct / 100) : 0;
    const latestEntryReadiness = entryReadinessByStrategy[strategyId] ?? EMPTY_ENTRY_READINESS_SNAPSHOT;
    const inPosition = latestEntryReadiness.inPosition ?? inferInPosition(section.events);
    const entryReadinessPct = normalizePct(
      latestEntryReadiness
        ? latestEntryReadiness.entryReadinessPct
        : (inPosition ? 100 : 0)
    );
    const entryReadinessMeta = resolveEntryReadinessMeta(entryReadinessPct, inPosition);

    return {
      key: strategyId,
      strategyId,
      strategyLabel: strategyId.replace('STRAT_', ''),
      ...(section.runId ? { runId: section.runId } : {}),
      totalPnlKrw: accountSummary?.totalPnlKrw ?? 0,
      totalPnlPct: accountSummary?.totalPnlPct ?? 0,
      positionQty: accountSummary?.positionQty ?? 0,
      avgEntryPriceKrw: accountSummary?.avgEntryPriceKrw ?? 0,
      avgWinPct: kpi.avgWinPct ?? 0,
      avgLossPct: kpi.avgLossPct ?? 0,
      todayPnlAmount,
      mddPct: kpi.mddPct ?? 0,
      entryReadinessPct,
      entryReadinessColor: entryReadinessMeta.color,
      winRate: kpi.winRate ?? 0,
      sumReturnPct: kpi.sumReturnPct ?? 0
    };
  });

  const strategySummaryColumns: ColumnsType<StrategySummaryRow> = [
    {
      title: '전략 유형',
      dataIndex: 'strategyLabel',
      key: 'strategyLabel',
      width: 110,
      render: (_value, record) => (
        <Space direction="vertical" size={0}>
          <Tag color={record.strategyId === controlStrategyId ? 'blue' : 'default'}>
            {record.strategyLabel}
          </Tag>
          <Text type="secondary">{record.runId ?? '-'}</Text>
        </Space>
      )
    },
    {
      title: '총 손익 / 총 수익률',
      key: 'totalPnl',
      width: 180,
      render: (_value, record) => (
        <Space direction="vertical" size={0}>
          <Text strong style={{ color: getSignedMetricColor(record.totalPnlKrw) }}>
            {formatKrw(record.totalPnlKrw)}
          </Text>
          <Text style={{ color: getSignedMetricColor(record.totalPnlPct) }}>
            {formatPct(record.totalPnlPct, 4)}
          </Text>
        </Space>
      )
    },
    {
      title: '보유 수량',
      dataIndex: 'positionQty',
      key: 'positionQty',
      width: 120,
      render: (value: number) => formatQty(value)
    },
    {
      title: '평균 매입가',
      dataIndex: 'avgEntryPriceKrw',
      key: 'avgEntryPriceKrw',
      width: 150,
      render: (value: number) => formatKrw(value)
    },
    {
      title: '평균 수익률 (+/-)',
      key: 'avgReturn',
      width: 150,
      render: (_value, record) => (
        <Space direction="vertical" size={0}>
          <Text style={{ color: UI_COLOR.kpi.positive }}>
            {`${record.avgWinPct > 0 ? '+' : ''}${formatPct(record.avgWinPct, 4)}`}
          </Text>
          <Text style={{ color: UI_COLOR.kpi.negative }}>
            {formatPct(record.avgLossPct, 4)}
          </Text>
        </Space>
      )
    },
    {
      title: '당일 누적 손익 금액',
      dataIndex: 'todayPnlAmount',
      key: 'todayPnlAmount',
      width: 160,
      render: (value: number) => (
        <Text style={{ color: getSignedMetricColor(value) }}>
          {formatKrw(value)}
        </Text>
      )
    },
    {
      title: 'MDD',
      dataIndex: 'mddPct',
      key: 'mddPct',
      width: 110,
      render: (value: number) => (
        <Text style={{ color: UI_COLOR.kpi.mdd, fontWeight: 700 }}>
          {formatPct(value, 4)}
        </Text>
      )
    },
    {
      title: '진입률',
      dataIndex: 'entryReadinessPct',
      key: 'entryReadinessPct',
      width: 110,
      render: (value: number, record) => (
        <Text style={{ color: record.entryReadinessColor, fontWeight: 600 }}>
          {formatPct(value, 0)}
        </Text>
      )
    },
    {
      title: '승률 / 누적 수익률',
      key: 'winRate',
      width: 150,
      render: (_value, record) => (
        <Space direction="vertical" size={0}>
          <Text>{formatPct(record.winRate, 2)}</Text>
          <Text style={{ color: getSignedMetricColor(record.sumReturnPct) }}>
            {formatPct(record.sumReturnPct, 4)}
          </Text>
        </Space>
      )
    }
  ];

  const selectedTradeRows = toTradeRows(fillEventsByStrategy[controlStrategyId]);
  const selectedFillPagination = fillPaginationByStrategy[controlStrategyId];
  const selectedDisplayCandles = baseCandles.length > 0 ? baseCandles : controlledSection.candles;
  const isUsingSharedCandles = baseCandles.length > 0;
  const selectedChartOverlays = buildStrategyOverlayLines(controlStrategyId, selectedDisplayCandles);
  const selectedChartMarkers = toChartMarkers(controlledSection.events);
  const selectedChartTheme = STRATEGY_CHART_THEME[controlStrategyId];
  const selectedDisplayedStatus = resolveDisplayRealtimeStatus(controlledSection.realtimeStatus, status, true);

  return (
    <Flex vertical gap={16} style={{ background: '#f3f6fa', padding: 16 }}>
      {messageContextHolder}
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

      <Card
        title={<Text strong>{`${controlStrategyId} 통합 실행 뷰`}</Text>}
        extra={(
          <Space>
            <Tag color="blue">선택 전략</Tag>
            <Text type="secondary">runId: {controlledSection.runId ?? '-'}</Text>
          </Space>
        )}
      >
        <Row gutter={[14, 14]}>
          <Col xs={24} lg={14}>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>차트</Text>
            <Space wrap size={[6, 6]} style={{ marginBottom: 8 }}>
              <Tag color="processing">{selectedChartTheme.title}</Tag>
              {selectedChartTheme.overlays.map((overlayLabel) => (
                <Tag key={`${controlStrategyId}-${overlayLabel}`}>{overlayLabel}</Tag>
              ))}
            </Space>
            <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
              {selectedChartTheme.description}
            </Text>
            <Alert
              style={{ marginBottom: 10 }}
              type="info"
              showIcon
              title={selectedDisplayCandles.length === 0
                ? '업비트 차트 데이터가 없습니다.'
                : isUsingSharedCandles
                  ? '업비트 실시간 공용 마켓 스트림을 표시 중입니다.'
                  : '업비트 실시간 마켓 스트림을 표시 중입니다.'}
            />
            {selectedDisplayCandles.length > 0 ? (
              <ChartPanel
                candles={selectedDisplayCandles}
                overlays={selectedChartOverlays}
                markers={selectedChartMarkers}
              />
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="캔들 데이터 없음" />
            )}
          </Col>

          <Col xs={24} lg={10}>
            <Flex justify="space-between" align="center" style={{ marginBottom: 8 }}>
              <Text strong style={{ display: 'block' }}>전략 비교 테이블</Text>
              <Text type="secondary">행 클릭 시 차트와 제어 대상이 바뀝니다.</Text>
            </Flex>
            <Table<StrategySummaryRow>
              rowKey="key"
              columns={strategySummaryColumns}
              dataSource={strategySummaryRows}
              size="small"
              pagination={false}
              scroll={{ x: 1180, y: 360 }}
              onRow={(record) => ({
                onClick: () => {
                  setControlStrategyId(record.strategyId);
                },
                style: {
                  cursor: 'pointer',
                  background: record.strategyId === controlStrategyId ? '#eff6ff' : undefined
                }
              })}
              locale={{ emptyText: '전략 요약 데이터가 없습니다.' }}
            />
          </Col>
          <Col xs={24} lg={8}>
            <Flex justify="space-between" align="center" style={{ marginBottom: 10 }}>
              <Text strong>실행 제어</Text>
              <RealtimeStatusBadge status={selectedDisplayedStatus} />
            </Flex>

            <Space orientation="vertical" size={10} style={{ width: '100%' }}>
              <Text type="secondary">{`제어 runId: ${controlRunId}`}</Text>
              {typeof selectedDisplayedStatus.queueDepth === 'number' && selectedDisplayedStatus.queueDepth > 0 ? (
                <Text type="warning">
                  {`영속화 대기 ${selectedDisplayedStatus.queueDepth}건 | 재시도 ${selectedDisplayedStatus.retryCount}회`}
                </Text>
              ) : null}
              <>
                <Row gutter={[12, 12]}>
                  <Col xs={24} md={12} lg={24}>
                    <Text type="secondary">모드</Text>
                    <Select
                      value={mode}
                      onChange={(value) => {
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
                      value={market}
                      onChange={(value) => {
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
                      value={fillModelRequested}
                      onChange={(value) => {
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
                      value={fillModelApplied}
                      onChange={(value) => {
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
                      value={strategyVersion}
                      onChange={(value) => {
                        setStrategyVersion(value);
                      }}
                      style={{ width: '100%' }}
                      options={[{ value: strategyVersion, label: strategyVersion }]}
                    />
                  </Col>
                </Row>

                <Flex wrap gap={8}>
                  <Button type="primary" loading={pendingAction === 'Start'} disabled={Boolean(pendingAction) || isRunning} onClick={() => {
                    triggerAction('Start', () => setIsRunning(true));
                  }}>
                    실행 시작
                  </Button>
                  <Button loading={pendingAction === 'Pause'} disabled={Boolean(pendingAction) || !isRunning} onClick={() => {
                    triggerAction('Pause', markPaused);
                  }}>
                    일시정지
                  </Button>
                  <Button loading={pendingAction === 'Resume'} disabled={Boolean(pendingAction) || !isRunning} onClick={() => {
                    triggerAction('Resume', markLive);
                  }}>
                    재개
                  </Button>
                  <Button loading={pendingAction === 'Stop'} disabled={Boolean(pendingAction) || !isRunning} onClick={() => {
                    triggerAction('Stop', () => setIsRunning(false));
                  }}>
                    종료
                  </Button>
                  <Button loading={pendingAction === 'Approve'} disabled={Boolean(pendingAction)} onClick={() => {
                    triggerAction('Approve');
                  }}>
                    승인
                  </Button>
                  <Button danger loading={pendingAction === 'KillSwitch'} disabled={Boolean(pendingAction)} onClick={() => {
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
              <Text type="secondary">{selectedFillPagination.total}건</Text>
            </Flex>
            <Table<TradeRow>
              rowKey="key"
              columns={tradeColumns}
              dataSource={selectedTradeRows}
              size="small"
              pagination={{
                current: selectedFillPagination.page,
                pageSize: selectedFillPagination.pageSize,
                total: selectedFillPagination.total,
                showSizeChanger: true,
                pageSizeOptions: ['20', '50', '100'],
                onChange: (page, pageSize) => {
                  void fetchStrategyFillPage(controlStrategyId, page, pageSize);
                }
              }}
              scroll={{ y: 300 }}
              locale={{ emptyText: '체결 내역이 없습니다.' }}
            />
          </Col>
        </Row>
      </Card>
    </Flex>
  );
}
