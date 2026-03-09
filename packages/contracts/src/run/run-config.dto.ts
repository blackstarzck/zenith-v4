export type StrategyId = 'STRAT_A' | 'STRAT_B' | 'STRAT_C';
export type RunMode = 'PAPER' | 'SEMI_AUTO' | 'AUTO' | 'LIVE';
export type FillModelRequested = 'AUTO' | 'NEXT_OPEN' | 'ON_CLOSE' | 'NEXT_MINUTE_OPEN' | 'INTRABAR_APPROX';
export type FillModelApplied = Exclude<FillModelRequested, 'AUTO'>;
export type DatasetRefProfile = 'REALTIME_RUNTIME' | 'REPLAY_BACKTEST' | 'DOC_BENCHMARK';
export type DatasetRefSource = 'UPBIT' | 'CSV_REPLAY' | 'JSONL_REPLAY' | 'MANUAL';

export type RiskSnapshotDto = Readonly<{
  seedKrw: number;
  maxPositionRatio: number;
  dailyLossLimitPct: number;
  maxConsecutiveLosses: number;
  maxDailyOrders: number;
  killSwitch: boolean;
}>;

export type DatasetRefDto = Readonly<{
  key: string;
  source: DatasetRefSource;
  profile: DatasetRefProfile;
  market: string;
  timeframes: readonly string[];
  feeds: readonly string[];
  dateRangeLabel: string;
  windowStart?: string;
  windowEnd?: string;
  exact: boolean;
}>;

export type RunConfigDto = Readonly<{
  runId: string;
  strategyId: StrategyId;
  strategyVersion: string;
  mode: RunMode;
  market: string;
  fillModelRequested: FillModelRequested;
  fillModelApplied: FillModelApplied;
  entryPolicy: string;
  datasetRef: DatasetRefDto;
  riskSnapshot: RiskSnapshotDto;
  updatedAt: string;
}>;
