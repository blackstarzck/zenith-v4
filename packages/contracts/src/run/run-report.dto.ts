export type RunReportDto = Readonly<{
  runId: string;
  strategyId: 'STRAT_A' | 'STRAT_B' | 'STRAT_C';
  mode: 'PAPER' | 'SEMI_AUTO' | 'AUTO' | 'LIVE';
  fillModelRequested: string;
  fillModelApplied: string;
  kpi: Readonly<Record<string, number | string>>;
  createdAt: string;
}>;
