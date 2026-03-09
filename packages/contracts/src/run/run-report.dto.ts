import type { RealtimeStatusDto } from '../realtime/realtime-status.dto';
import type { WsEventEnvelopeDto } from '../ws/ws-event-envelope.dto';
import type {
  DatasetRefDto,
  FillModelApplied,
  FillModelRequested,
  RunConfigDto,
  RunMode,
  StrategyId
} from './run-config.dto';

export type RunKpiDto = Readonly<{
  trades: number;
  exits: number;
  winRate: number;
  sumReturnPct: number;
  mddPct: number;
  profitFactor: number;
  avgWinPct: number;
  avgLossPct: number;
}>;

export type EntryReadinessDto = Readonly<{
  entryReadinessPct: number;
  entryReady: boolean;
  entryExecutable: boolean;
  reason: string;
  inPosition: boolean;
}>;

export type RunHistoryItemDto = Readonly<{
  runId: string;
  strategyId: StrategyId;
  strategyVersion: string;
  mode: RunMode;
  market: string;
  fillModelRequested: FillModelRequested;
  fillModelApplied: FillModelApplied;
  entryPolicy: string;
  datasetRef: DatasetRefDto;
  createdAt: string;
  eventCount: number;
  lastSeq: number;
  lastEventAt?: string;
  }> & RunKpiDto;

export type RunDetailDto = Readonly<{
  runConfig: RunConfigDto;
  events: readonly WsEventEnvelopeDto[];
  kpi: RunKpiDto;
  latestEntryReadiness?: EntryReadinessDto;
  realtimeStatus?: RealtimeStatusDto;
}> & RunHistoryItemDto;

export type StrategyAccountSummaryDto = Readonly<{
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

export type StrategyFillPageDto = Readonly<{
  items: readonly WsEventEnvelopeDto[];
  total: number;
  page: number;
  pageSize: number;
}>;

export type RunReportDto = Readonly<{
  runId: string;
  createdAt: string;
  strategy: Readonly<{
    strategyId: StrategyId;
    strategyVersion: string;
  }>;
  dataset: Readonly<{
    market: string;
    timeframes: readonly string[];
    datasetRef: DatasetRefDto;
  }>;
  execution: Readonly<{
    mode: RunMode;
    entryPolicy: string;
    fillModelRequested: FillModelRequested;
    fillModelApplied: FillModelApplied;
  }>;
  fees: Readonly<{
    feeMode: 'PER_SIDE' | 'ROUNDTRIP';
    perSide: number | null;
    roundtrip: number | null;
    slippageAssumedPct: number;
  }>;
  risk: RunConfigDto['riskSnapshot'];
  results: Readonly<{
    trades: Readonly<{
      count: number;
      exits: number;
      winCount: number;
      lossCount: number;
      winRate: number;
      profitFactor: number;
      avgWinPct: number;
      avgLossPct: number;
      sumReturnPct: number;
    }>;
    pnl: Readonly<{
      totalKrw: number;
      mddPct: number;
    }>;
    exitReasonBreakdown: Readonly<Record<string, number>>;
  }>;
  artifacts: Readonly<{
    runReportJson: string;
    tradesCsv: string;
    eventsJsonl: string;
  }>;
}>;
