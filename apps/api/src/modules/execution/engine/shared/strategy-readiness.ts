export type StrategyEntryReadiness = Readonly<{
  entryReadinessPct: number;
  entryReady: boolean;
  reason: string;
  inPosition: boolean;
}>;
