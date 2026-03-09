import type {
  DatasetRefDto,
  FillModelApplied,
  FillModelRequested,
  RunMode,
  StrategyDocBenchmarkCandidateDto,
  StrategyDocBenchmarkCompareResponseDto,
  StrategyDocBenchmarkDto,
  StrategyDocBenchmarkMetricComparisonDto,
  StrategyDocBenchmarkMetricDto,
  StrategyDocBenchmarkResultDto,
  StrategyId
} from '@zenith/contracts';
import { Controller, Get, Query } from '@nestjs/common';
import { RunsService } from '../runs/runs.service';
import { getStrategyDocBenchmarks } from './strategy-doc-benchmarks';

type CompareSummaryRow = Readonly<{
  strategyId: StrategyId;
  runs: number;
  trades: number;
  winRate: number;
  sumReturnPct: number;
  mddPct: number;
  profitFactor: number;
  avgWinPct: number;
  avgLossPct: number;
}>;

type CompareTrendPoint = Readonly<{
  strategyVersion: string;
  strategyId: StrategyId;
  runs: number;
  winRate: number;
  sumReturnPct: number;
  mddPct: number;
  profitFactor: number;
}>;

type CompareMetrics = Readonly<{
  trades: number;
  winRate: number;
  sumReturnPct: number;
  mddPct: number;
  profitFactor: number;
  avgWinPct: number;
  avgLossPct: number;
}>;

type RunHistoryRow = Awaited<ReturnType<RunsService['listRuns']>>[number];
type PersistedSummaryRow = Awaited<ReturnType<RunsService['listPersistedRunReportSummaries']>>[number];

@Controller('reports')
export class ReportsController {
  constructor(private readonly runsService: RunsService) {}

  @Get('compare')
  async getCompare(
    @Query('strategyVersion') strategyVersion?: string,
    @Query('mode') mode?: RunMode,
    @Query('market') market?: string,
    @Query('from') from?: string,
    @Query('to') to?: string
  ) {
    const rows = await this.runsService.listRuns({
      ...(strategyVersion ? { strategyVersion } : {}),
      ...(mode ? { mode } : {}),
      ...(market ? { market } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {})
    });
    const persistedReports = await this.runsService.listPersistedRunReportSummaries(rows.map((row) => row.runId));
    const persistedByRunId = new Map(persistedReports.map((report) => [report.runId, report] as const));

    const strategyIds: readonly StrategyId[] = ['STRAT_A', 'STRAT_B', 'STRAT_C'];
    const out: CompareSummaryRow[] = strategyIds.map((strategyId) => {
      const group = rows.filter((row) => row.strategyId === strategyId);
      if (group.length === 0) {
        return {
          strategyId,
          runs: 0,
          trades: 0,
          winRate: 0,
          sumReturnPct: 0,
          mddPct: 0,
          profitFactor: 0,
          avgWinPct: 0,
          avgLossPct: 0
        };
      }

      const average = (fn: (metrics: CompareMetrics) => number): number => (
        group.reduce((acc, row) => acc + fn(resolveCompareMetrics(row, persistedByRunId.get(row.runId))), 0) / group.length
      );

      return {
        strategyId,
        runs: group.length,
        trades: Number(average((metrics) => metrics.trades).toFixed(1)),
        winRate: Number(average((metrics) => metrics.winRate).toFixed(2)),
        sumReturnPct: Number(average((metrics) => metrics.sumReturnPct).toFixed(4)),
        mddPct: Number(average((metrics) => metrics.mddPct).toFixed(4)),
        profitFactor: Number(average((metrics) => metrics.profitFactor).toFixed(4)),
        avgWinPct: Number(average((metrics) => metrics.avgWinPct).toFixed(4)),
        avgLossPct: Number(average((metrics) => metrics.avgLossPct).toFixed(4))
      };
    });

    const trend: CompareTrendPoint[] = [];
    const byVersion = new Map<string, Array<(typeof rows)[number]>>();
    rows.forEach((row) => {
      const arr = byVersion.get(row.strategyVersion) ?? [];
      arr.push(row);
      byVersion.set(row.strategyVersion, arr);
    });

    const versions = [...byVersion.keys()].sort(compareVersion);
    versions.forEach((strategyVersion) => {
      const versionRows = byVersion.get(strategyVersion) ?? [];
      strategyIds.forEach((strategyId) => {
        const group = versionRows.filter((row) => row.strategyId === strategyId);
        if (group.length === 0) {
          return;
        }
        const average = (fn: (metrics: CompareMetrics) => number): number => (
          group.reduce((acc, row) => acc + fn(resolveCompareMetrics(row, persistedByRunId.get(row.runId))), 0) / group.length
        );
        trend.push({
          strategyVersion,
          strategyId,
          runs: group.length,
          winRate: Number(average((metrics) => metrics.winRate).toFixed(2)),
          sumReturnPct: Number(average((metrics) => metrics.sumReturnPct).toFixed(4)),
          mddPct: Number(average((metrics) => metrics.mddPct).toFixed(4)),
          profitFactor: Number(average((metrics) => metrics.profitFactor).toFixed(4))
        });
      });
    });

    return {
      filters: {
        ...(strategyVersion ? { strategyVersion } : {}),
        ...(mode ? { mode } : {}),
        ...(market ? { market } : {}),
        ...(from ? { from } : {}),
        ...(to ? { to } : {})
      },
      summary: out,
      trend
    };
  }

  @Get('benchmark-compare')
  async getBenchmarkCompare(
    @Query('strategyId') strategyId?: StrategyId,
    @Query('strategyVersion') strategyVersion?: string
  ): Promise<StrategyDocBenchmarkCompareResponseDto> {
    const benchmarks = getStrategyDocBenchmarks()
      .filter((benchmark) => !strategyId || benchmark.strategyId === strategyId);
    const rows = await this.runsService.listRuns({
      ...(strategyId ? { strategyId } : {}),
      ...(strategyVersion ? { strategyVersion } : {})
    });
    const persistedReports = await this.runsService.listPersistedRunReportSummaries(rows.map((row) => row.runId));
    const persistedByRunId = new Map(persistedReports.map((report) => [report.runId, report] as const));
    const items = await Promise.all(benchmarks.map(async (benchmark) => buildBenchmarkCompareItem({
      benchmark,
      strategyRows: rows.filter((row) => row.strategyId === benchmark.strategyId),
      persistedByRunId,
      runsService: this.runsService
    })));

    return {
      generatedAt: new Date().toISOString(),
      items
    };
  }
}

function resolveCompareMetrics(
  row: Readonly<{
    trades: number;
    winRate: number;
    sumReturnPct: number;
    mddPct: number;
    profitFactor: number;
    avgWinPct: number;
    avgLossPct: number;
  }>,
  persisted?: Readonly<{
    kpi: Readonly<{
      count: number;
      winRate: number;
      sumReturnPct: number;
      mddPct: number;
      profitFactor: number;
      avgWinPct: number;
      avgLossPct: number;
    }>;
  }>
): CompareMetrics {
  if (!persisted) {
    return {
      trades: row.trades,
      winRate: row.winRate,
      sumReturnPct: row.sumReturnPct,
      mddPct: row.mddPct,
      profitFactor: row.profitFactor,
      avgWinPct: row.avgWinPct,
      avgLossPct: row.avgLossPct
    };
  }

  return {
    trades: persisted.kpi.count,
    winRate: persisted.kpi.winRate,
    sumReturnPct: persisted.kpi.sumReturnPct,
    mddPct: persisted.kpi.mddPct,
    profitFactor: persisted.kpi.profitFactor,
    avgWinPct: persisted.kpi.avgWinPct,
    avgLossPct: persisted.kpi.avgLossPct
  };
}

function compareVersion(a: string, b: string): number {
  const normalize = (value: string): readonly number[] => {
    const matched = value.match(/\d+/g);
    if (!matched) {
      return [0];
    }
    return matched.map((part) => Number(part));
  };
  const left = normalize(a);
  const right = normalize(b);
  const len = Math.max(left.length, right.length);
  for (let i = 0; i < len; i += 1) {
    const l = left[i] ?? 0;
    const r = right[i] ?? 0;
    if (l !== r) {
      return l - r;
    }
  }
  return a.localeCompare(b);
}

async function buildBenchmarkCompareItem(input: Readonly<{
  benchmark: StrategyDocBenchmarkDto;
  strategyRows: readonly RunHistoryRow[];
  persistedByRunId: ReadonlyMap<string, PersistedSummaryRow>;
  runsService: RunsService;
}>): Promise<StrategyDocBenchmarkResultDto> {
  const { benchmark, strategyRows, persistedByRunId, runsService } = input;
  if (!benchmark.benchmarkAvailable) {
    return {
      strategyId: benchmark.strategyId,
      status: 'BLOCKED',
      reason: 'Benchmark KPI is not normalized for this strategy yet.',
      docClaimEligible: false,
      benchmark,
      checks: {
        persistedArtifacts: false,
        dataset: false,
        datasetExact: false,
        execution: false,
        parameters: false,
        metrics: false
      },
      metricComparisons: [],
      notes: [...benchmark.notes]
    };
  }

  const selectedRow = selectBenchmarkCandidate(benchmark, strategyRows, persistedByRunId);
  if (!selectedRow) {
    return {
      strategyId: benchmark.strategyId,
      status: 'NO_CANDIDATE',
      reason: 'No persisted run report summary is available for this strategy.',
      docClaimEligible: false,
      benchmark,
      checks: {
        persistedArtifacts: false,
        dataset: false,
        datasetExact: false,
        execution: false,
        parameters: false,
        metrics: false
      },
      metricComparisons: [],
      notes: [
        ...benchmark.notes,
        'Generate or hydrate one persisted run report before benchmark comparison.'
      ]
    };
  }

  const persisted = persistedByRunId.get(selectedRow.runId);
  if (!persisted) {
    return {
      strategyId: benchmark.strategyId,
      status: 'NO_CANDIDATE',
      reason: 'The selected run is missing its persisted report summary.',
      docClaimEligible: false,
      benchmark,
      checks: {
        persistedArtifacts: false,
        dataset: false,
        datasetExact: false,
        execution: false,
        parameters: false,
        metrics: false
      },
      metricComparisons: [],
      notes: [...benchmark.notes]
    };
  }

  const report = await runsService.getRunReport(selectedRow.runId);
  const reportAvailable = Boolean(report);
  const metricComparisons = buildMetricComparisons(benchmark.metrics, persisted);
  const datasetCheck = report ? evaluateBenchmarkDataset(benchmark, resolveBenchmarkDatasetSnapshot(report, selectedRow)) : {
    dataset: false,
    datasetExact: false
  };
  const checks = {
    persistedArtifacts: hasCompleteArtifactManifest(persisted.artifactManifest),
    dataset: datasetCheck.dataset,
    datasetExact: datasetCheck.datasetExact,
    execution: report ? isExecutionMatch(benchmark, {
      mode: report.execution.mode,
      entryPolicy: report.execution.entryPolicy,
      fillModelRequested: report.execution.fillModelRequested,
      fillModelApplied: report.execution.fillModelApplied
    }) : false,
    parameters: report ? isParameterMatch(benchmark, report) : !hasParameterExpectations(benchmark),
    metrics: metricComparisons
      .filter((metric) => metric.required)
      .every((metric) => metric.passed)
  } as const;
  const status = resolveBenchmarkStatus({
    reportAvailable,
    ...checks
  });
  const docClaimEligible = status === 'MATCHED' && checks.datasetExact;
  const notes = [...benchmark.notes];
  if (benchmark.dataset.datasetRefRequired && !checks.datasetExact) {
    notes.push('dataset_ref exists but is not exact-match eligible yet, so document-equivalence remains provisional.');
  }
  if (!checks.persistedArtifacts) {
    notes.push('Selected run is missing one or more persisted artifact manifest paths.');
  }
  if (!report) {
    notes.push('Run report reconstruction failed, so dataset/execution/parameter checks could not be fully verified.');
  }

  return {
    strategyId: benchmark.strategyId,
    status,
    reason: resolveBenchmarkReason(benchmark, status, checks, metricComparisons, report),
    docClaimEligible,
    benchmark,
    checks,
    candidate: toBenchmarkCandidate(selectedRow, persisted),
    metricComparisons,
    notes
  };
}

function selectBenchmarkCandidate(
  benchmark: StrategyDocBenchmarkDto,
  strategyRows: readonly RunHistoryRow[],
  persistedByRunId: ReadonlyMap<string, PersistedSummaryRow>
): RunHistoryRow | undefined {
  const candidates = strategyRows
    .filter((row) => persistedByRunId.has(row.runId));
  if (candidates.length === 0) {
    return undefined;
  }

  return [...candidates].sort((left, right) => {
    const scoreDiff = scoreBenchmarkCandidate(benchmark, right) - scoreBenchmarkCandidate(benchmark, left);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }

    const createdAtDiff = right.createdAt.localeCompare(left.createdAt);
    if (createdAtDiff !== 0) {
      return createdAtDiff;
    }

    return compareVersion(right.strategyVersion, left.strategyVersion);
  })[0];
}

function scoreBenchmarkCandidate(
  benchmark: StrategyDocBenchmarkDto,
  row: RunHistoryRow
): number {
  let score = 0;

  if (row.market === benchmark.dataset.market) {
    score += 100;
  }
  if (row.datasetRef?.dateRangeLabel === benchmark.dataset.dateRangeLabel) {
    score += 60;
  }
  if (matchesAllowedArray(benchmark.dataset.feeds, row.datasetRef?.feeds ?? [])) {
    score += 20;
  }
  if (matchesAllowed(benchmark.execution.allowedModes, row.mode)) {
    score += 20;
  }
  if (matchesAllowed(benchmark.execution.allowedEntryPolicies, row.entryPolicy)) {
    score += 30;
  }
  if (matchesAllowed(benchmark.execution.allowedFillModelRequested, row.fillModelRequested)) {
    score += 10;
  }
  if (matchesAllowed(benchmark.execution.allowedFillModelApplied, row.fillModelApplied)) {
    score += 30;
  }

  return score;
}

function matchesAllowed<T extends string>(
  allowed: readonly T[] | undefined,
  actual: string
): boolean {
  if (!allowed || allowed.length === 0) {
    return true;
  }
  return allowed.includes(actual as T);
}

function matchesAllowedArray<T extends string>(
  allowed: readonly T[] | undefined,
  actual: readonly string[]
): boolean {
  if (!allowed || allowed.length === 0) {
    return true;
  }
  if (allowed.length !== actual.length) {
    return false;
  }
  return allowed.every((value, index) => value === actual[index]);
}

function hasCompleteArtifactManifest(value: Readonly<Record<string, unknown>>): boolean {
  return typeof value.runReportJson === 'string' &&
    typeof value.tradesCsv === 'string' &&
    typeof value.eventsJsonl === 'string';
}

function evaluateBenchmarkDataset(
  benchmark: StrategyDocBenchmarkDto,
  datasetRef: Readonly<{
    market: string;
    timeframes: readonly string[];
    feeds?: readonly string[];
    dateRangeLabel?: string;
    exact?: boolean;
  }> | undefined
): Readonly<{
  dataset: boolean;
  datasetExact: boolean;
}> {
  if (!datasetRef) {
    return {
      dataset: false,
      datasetExact: false
    };
  }

  const baseMatch = datasetRef.market === benchmark.dataset.market &&
    areSameOrderedStrings(datasetRef.timeframes, benchmark.dataset.timeframes) &&
    matchesOptionalAllowedArray(benchmark.dataset.feeds, datasetRef.feeds) &&
    matchesOptionalValue(benchmark.dataset.dateRangeLabel, datasetRef.dateRangeLabel);

  return {
    dataset: baseMatch,
    datasetExact:
      baseMatch &&
      matchesAllowedArray(benchmark.dataset.feeds, datasetRef.feeds ?? []) &&
      datasetRef.dateRangeLabel === benchmark.dataset.dateRangeLabel &&
      datasetRef.exact === true
  };
}

function isExecutionMatch(
  benchmark: StrategyDocBenchmarkDto,
  execution: Readonly<{
    mode: RunMode;
    entryPolicy: string;
    fillModelRequested: FillModelRequested;
    fillModelApplied: FillModelApplied;
  }>
): boolean {
  return matchesAllowed(benchmark.execution.allowedModes, execution.mode) &&
    matchesAllowed(benchmark.execution.allowedEntryPolicies, execution.entryPolicy) &&
    matchesAllowed(benchmark.execution.allowedFillModelRequested, execution.fillModelRequested) &&
    matchesAllowed(benchmark.execution.allowedFillModelApplied, execution.fillModelApplied);
}

function hasParameterExpectations(benchmark: StrategyDocBenchmarkDto): boolean {
  return Boolean(
    benchmark.parameters.feeMode ||
    typeof benchmark.parameters.feePerSide === 'number' ||
    typeof benchmark.parameters.roundtrip === 'number' ||
    typeof benchmark.parameters.slippageAssumedPct === 'number'
  );
}

function isParameterMatch(
  benchmark: StrategyDocBenchmarkDto,
  report: Awaited<ReturnType<RunsService['getRunReport']>>
): boolean {
  if (!report) {
    return false;
  }

  if (benchmark.parameters.feeMode && report.fees.feeMode !== benchmark.parameters.feeMode) {
    return false;
  }
  if (
    typeof benchmark.parameters.feePerSide === 'number' &&
    report.fees.perSide !== null &&
    Math.abs(report.fees.perSide - benchmark.parameters.feePerSide) > 1e-9
  ) {
    return false;
  }
  if (
    typeof benchmark.parameters.feePerSide === 'number' &&
    report.fees.perSide === null
  ) {
    return false;
  }
  if (
    typeof benchmark.parameters.roundtrip === 'number' &&
    report.fees.roundtrip !== null &&
    Math.abs(report.fees.roundtrip - benchmark.parameters.roundtrip) > 1e-9
  ) {
    return false;
  }
  if (
    typeof benchmark.parameters.roundtrip === 'number' &&
    report.fees.roundtrip === null
  ) {
    return false;
  }
  if (
    typeof benchmark.parameters.slippageAssumedPct === 'number' &&
    Math.abs(report.fees.slippageAssumedPct - benchmark.parameters.slippageAssumedPct) > 1e-9
  ) {
    return false;
  }

  return true;
}

function buildMetricComparisons(
  metrics: readonly StrategyDocBenchmarkMetricDto[],
  persisted: PersistedSummaryRow
): StrategyDocBenchmarkMetricComparisonDto[] {
  return metrics.map((metric) => {
    const actual = resolveMetricActual(metric.key, persisted);
    const delta = typeof actual === 'number' ? Number((actual - metric.target).toFixed(4)) : undefined;
    return {
      key: metric.key,
      label: metric.label,
      target: metric.target,
      ...(typeof actual === 'number' ? { actual: Number(actual.toFixed(4)) } : {}),
      tolerance: metric.tolerance,
      ...(typeof delta === 'number' ? { delta } : {}),
      required: metric.required,
      ...(metric.inferred ? { inferred: true } : {}),
      passed: typeof actual === 'number' && Math.abs(actual - metric.target) <= metric.tolerance
    };
  });
}

function resolveMetricActual(
  key: StrategyDocBenchmarkMetricDto['key'],
  persisted: PersistedSummaryRow
): number | undefined {
  switch (key) {
    case 'winRate':
      return persisted.kpi.winRate;
    case 'avgTradeReturnPct':
      return persisted.kpi.count > 0 ? persisted.kpi.sumReturnPct / persisted.kpi.count : undefined;
    case 'mddPct':
      return persisted.kpi.mddPct;
    case 'tradeCount':
      return persisted.kpi.count;
    default:
      return undefined;
  }
}

function resolveBenchmarkStatus(
  checks: Readonly<{
    reportAvailable: boolean;
    persistedArtifacts: boolean;
    dataset: boolean;
    datasetExact: boolean;
    execution: boolean;
    parameters: boolean;
    metrics: boolean;
  }>
): StrategyDocBenchmarkResultDto['status'] {
  if (!checks.reportAvailable) {
    return 'RULE_IMPLEMENTATION_GAP';
  }
  if (!checks.persistedArtifacts) {
    return 'RULE_IMPLEMENTATION_GAP';
  }
  if (!checks.dataset) {
    return 'DATASET_MISMATCH';
  }
  if (!checks.execution) {
    return 'EXECUTION_POLICY_MISMATCH';
  }
  if (!checks.parameters) {
    return 'PARAMETER_MISMATCH';
  }
  if (!checks.metrics) {
    return 'RULE_IMPLEMENTATION_GAP';
  }
  return 'MATCHED';
}

function resolveBenchmarkReason(
  benchmark: StrategyDocBenchmarkDto,
  status: StrategyDocBenchmarkResultDto['status'],
  checks: Readonly<{
    persistedArtifacts: boolean;
    dataset: boolean;
    datasetExact: boolean;
    execution: boolean;
    parameters: boolean;
    metrics: boolean;
  }>,
  metricComparisons: readonly StrategyDocBenchmarkMetricComparisonDto[],
  report: Awaited<ReturnType<RunsService['getRunReport']>>
): string {
  switch (status) {
    case 'BLOCKED':
      return 'Benchmark KPI is not normalized for this strategy yet.';
    case 'NO_CANDIDATE':
      return 'No persisted run report summary is available for this strategy.';
    case 'DATASET_MISMATCH':
      return report
        ? buildDatasetMismatchReason(benchmark, resolveBenchmarkDatasetSnapshot(report))
        : 'Dataset mismatch: run report could not be reconstructed.';
    case 'EXECUTION_POLICY_MISMATCH':
      return report
        ? `Execution mismatch: entryPolicy=${report.execution.entryPolicy}, fillModelApplied=${report.execution.fillModelApplied}, fillModelRequested=${report.execution.fillModelRequested}.`
        : 'Execution mismatch: run report could not be reconstructed.';
    case 'PARAMETER_MISMATCH':
      return 'Parameter mismatch: fee/slippage assumptions do not match the benchmark profile.';
    case 'RULE_IMPLEMENTATION_GAP': {
      if (!checks.persistedArtifacts) {
        return 'Persisted artifact manifest is incomplete for the selected run.';
      }
      const failedMetrics = metricComparisons
        .filter((metric) => metric.required && !metric.passed)
        .map((metric) => metric.label);
      return failedMetrics.length > 0
        ? `Required benchmark metrics are outside tolerance: ${failedMetrics.join(', ')}.`
        : 'One or more benchmark validation checks failed.';
    }
    case 'MATCHED':
      return benchmark.dataset.datasetRefRequired && !checks.datasetExact
        ? 'Available benchmark checks matched, but dataset_ref is not exact yet so document equivalence remains provisional.'
        : 'Benchmark matched.';
    default:
      return 'Unknown benchmark comparison status.';
  }
}

function toBenchmarkCandidate(
  row: RunHistoryRow,
  persisted: PersistedSummaryRow
): StrategyDocBenchmarkCandidateDto {
  return {
    runId: row.runId,
    createdAt: row.createdAt,
    strategyVersion: row.strategyVersion,
    mode: row.mode,
    market: row.market,
    entryPolicy: row.entryPolicy,
    fillModelRequested: row.fillModelRequested,
    fillModelApplied: row.fillModelApplied,
    datasetRef: row.datasetRef,
    artifactManifest: persisted.artifactManifest
  };
}

function resolveBenchmarkDatasetSnapshot(
  report: NonNullable<Awaited<ReturnType<RunsService['getRunReport']>>>,
  row?: Readonly<{ datasetRef?: DatasetRefDto }>
): Readonly<{
  market: string;
  timeframes: readonly string[];
  feeds?: readonly string[];
  dateRangeLabel?: string;
  exact?: boolean;
}> {
  const datasetRef = report.dataset.datasetRef ?? row?.datasetRef;
  return {
    market: datasetRef?.market ?? report.dataset.market,
    timeframes: datasetRef?.timeframes ?? report.dataset.timeframes,
    ...(datasetRef?.feeds ? { feeds: datasetRef.feeds } : {}),
    ...(datasetRef?.dateRangeLabel ? { dateRangeLabel: datasetRef.dateRangeLabel } : {}),
    ...(typeof datasetRef?.exact === 'boolean' ? { exact: datasetRef.exact } : {})
  };
}

function buildDatasetMismatchReason(
  benchmark: StrategyDocBenchmarkDto,
  dataset: Readonly<{
    market: string;
    timeframes: readonly string[];
    feeds?: readonly string[];
    dateRangeLabel?: string;
  }>
): string {
  const expected = [
    benchmark.dataset.market,
    benchmark.dataset.timeframes.join(','),
    benchmark.dataset.dateRangeLabel
  ].join('/');
  const actual = [
    dataset.market,
    dataset.timeframes.join(','),
    dataset.dateRangeLabel ?? 'unknown'
  ].join('/');
  return `Dataset mismatch: expected ${expected} but got ${actual}.`;
}

function areSameOrderedStrings(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

function matchesOptionalAllowedArray<T extends string>(
  allowed: readonly T[] | undefined,
  actual: readonly string[] | undefined
): boolean {
  if (!actual) {
    return true;
  }
  return matchesAllowedArray(allowed, actual);
}

function matchesOptionalValue(expected: string | undefined, actual: string | undefined): boolean {
  if (!expected) {
    return true;
  }
  if (!actual) {
    return true;
  }
  return expected === actual;
}
