import type { MomentumConfig } from './simple-momentum.strategy';

export type StrategyId = 'STRAT_A' | 'STRAT_B' | 'STRAT_C';

type StrategyRuntimeConfig = Readonly<{
  strategyId: StrategyId;
  strategyName: string;
  momentum: MomentumConfig;
}>;

const STRATEGY_CONFIGS: Readonly<Record<StrategyId, StrategyRuntimeConfig>> = {
  STRAT_A: {
    strategyId: 'STRAT_A',
    strategyName: 'XMR-C',
    momentum: {
      entryThresholdPct: 0.08,
      takeProfitPct: 0.18,
      stopLossPct: 0.25,
      maxHoldBars: 10
    }
  },
  STRAT_B: {
    strategyId: 'STRAT_B',
    strategyName: 'OB+FVG',
    momentum: {
      entryThresholdPct: 0.12,
      takeProfitPct: 0.25,
      stopLossPct: 0.2,
      maxHoldBars: 8
    }
  },
  STRAT_C: {
    strategyId: 'STRAT_C',
    strategyName: 'Profit-Max Scalper',
    momentum: {
      entryThresholdPct: 0.2,
      takeProfitPct: 0.35,
      stopLossPct: 0.18,
      maxHoldBars: 5
    }
  }
} as const;

export function resolveStrategyConfig(input: string | undefined): StrategyRuntimeConfig {
  if (!input) {
    return STRATEGY_CONFIGS.STRAT_B;
  }
  const upper = input.toUpperCase();
  if (upper === 'STRAT_A' || upper === 'STRAT_B' || upper === 'STRAT_C') {
    return STRATEGY_CONFIGS[upper];
  }
  return STRATEGY_CONFIGS.STRAT_B;
}
