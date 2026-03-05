export type RunConfigDto = Readonly<{
  runId: string;
  strategyId: 'STRAT_A' | 'STRAT_B' | 'STRAT_C';
  strategyVersion: string;
  mode: 'PAPER' | 'SEMI_AUTO' | 'AUTO' | 'LIVE';
  fillModelRequested: 'AUTO' | 'NEXT_OPEN' | 'ON_CLOSE' | 'NEXT_MINUTE_OPEN' | 'INTRABAR_APPROX';
  fillModelApplied?: 'NEXT_OPEN' | 'ON_CLOSE' | 'NEXT_MINUTE_OPEN' | 'INTRABAR_APPROX';
  entryPolicy: Readonly<Record<string, unknown>>;
  parameterSnapshot: Readonly<Record<string, unknown>>;
  riskSnapshot: Readonly<Record<string, unknown>>;
}>;
