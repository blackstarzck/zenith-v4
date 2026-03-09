import type {
  DatasetRefDto,
  FillModelApplied,
  FillModelRequested,
  RunMode,
  StrategyId
} from './run-config.dto';

export type BenchmarkComparisonStatus =
  | 'MATCHED'
  | 'DATASET_MISMATCH'
  | 'EXECUTION_POLICY_MISMATCH'
  | 'PARAMETER_MISMATCH'
  | 'RULE_IMPLEMENTATION_GAP'
  | 'BLOCKED'
  | 'NO_CANDIDATE';

export type StrategyDocBenchmarkMetricKey =
  | 'winRate'
  | 'avgTradeReturnPct'
  | 'mddPct'
  | 'tradeCount';

export type StrategyDocBenchmarkMetricDto = Readonly<{
  key: StrategyDocBenchmarkMetricKey;
  label: string;
  target: number;
  tolerance: number;
  required: boolean;
  inferred?: boolean;
}>;

export type StrategyDocBenchmarkDto = Readonly<{
  strategyId: StrategyId;
  sourcePath: string;
  benchmarkLabel: string;
  benchmarkAvailable: boolean;
  dataset: Readonly<{
    market: string;
    timeframes: readonly string[];
    feeds?: readonly string[];
    dateRangeLabel: string;
    datasetRefRequired: boolean;
  }>;
  execution: Readonly<{
    allowedModes?: readonly RunMode[];
    allowedEntryPolicies?: readonly string[];
    allowedFillModelRequested?: readonly FillModelRequested[];
    allowedFillModelApplied?: readonly FillModelApplied[];
  }>;
  parameters: Readonly<{
    feeMode?: 'PER_SIDE' | 'ROUNDTRIP';
    feePerSide?: number | null;
    roundtrip?: number | null;
    slippageAssumedPct?: number | null;
  }>;
  metrics: readonly StrategyDocBenchmarkMetricDto[];
  notes: readonly string[];
}>;

export type StrategyDocBenchmarkCandidateDto = Readonly<{
  runId: string;
  createdAt: string;
  strategyVersion: string;
  mode: RunMode;
  market: string;
  entryPolicy: string;
  fillModelRequested: FillModelRequested;
  fillModelApplied: FillModelApplied;
  datasetRef?: DatasetRefDto;
  artifactManifest: Readonly<Record<string, unknown>>;
}>;

export type StrategyDocBenchmarkMetricComparisonDto = Readonly<{
  key: StrategyDocBenchmarkMetricKey;
  label: string;
  target: number;
  actual?: number;
  tolerance: number;
  delta?: number;
  required: boolean;
  inferred?: boolean;
  passed: boolean;
}>;

export type StrategyDocBenchmarkCheckDto = Readonly<{
  persistedArtifacts: boolean;
  dataset: boolean;
  datasetExact: boolean;
  execution: boolean;
  parameters: boolean;
  metrics: boolean;
}>;

export type StrategyDocBenchmarkResultDto = Readonly<{
  strategyId: StrategyId;
  status: BenchmarkComparisonStatus;
  reason: string;
  docClaimEligible: boolean;
  benchmark: StrategyDocBenchmarkDto;
  checks: StrategyDocBenchmarkCheckDto;
  candidate?: StrategyDocBenchmarkCandidateDto;
  metricComparisons: readonly StrategyDocBenchmarkMetricComparisonDto[];
  notes: readonly string[];
}>;

export type StrategyDocBenchmarkCompareResponseDto = Readonly<{
  generatedAt: string;
  items: readonly StrategyDocBenchmarkResultDto[];
}>;
