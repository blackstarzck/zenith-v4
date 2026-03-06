import type { MomentumConfig } from './simple-momentum.strategy';
import { DEFAULT_PARAMETER_VALUES, PARAMETER_KEYS } from './parameter-registry';

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
      takeProfitPct: DEFAULT_PARAMETER_VALUES.a.tpPct,
      stopLossPct: 0.25,
      maxHoldBars: DEFAULT_PARAMETER_VALUES.a.timeExitMaxHoldBars,
      stratA: {
        bbPeriod: DEFAULT_PARAMETER_VALUES.a.bbPeriod,
        bbStd: DEFAULT_PARAMETER_VALUES.a.bbStd,
        atrPeriod: DEFAULT_PARAMETER_VALUES.a.atrPeriod,
        adxPeriod: DEFAULT_PARAMETER_VALUES.a.adxPeriod,
        rsiPeriod: DEFAULT_PARAMETER_VALUES.a.rsiPeriod,
        rsiSlopeLookback: DEFAULT_PARAMETER_VALUES.a.rsiSlopeLookback,
        excludeEntryHoursKst: DEFAULT_PARAMETER_VALUES.a.filtersExcludeEntryHoursKst,
        maxAdx: DEFAULT_PARAMETER_VALUES.a.filtersMaxAdx,
        rsiSlopeMin: DEFAULT_PARAMETER_VALUES.a.filtersRsiSlopeMin,
        tpPct: DEFAULT_PARAMETER_VALUES.a.tpPct,
        partialRatio: DEFAULT_PARAMETER_VALUES.a.partialRatio,
        trailAtrMult: DEFAULT_PARAMETER_VALUES.a.trailAtrMult,
        timeExitMaxHoldBars: DEFAULT_PARAMETER_VALUES.a.timeExitMaxHoldBars,
        stopMultRanging: DEFAULT_PARAMETER_VALUES.a.stopMultRanging,
        stopMultTrending: DEFAULT_PARAMETER_VALUES.a.stopMultTrending,
        stopMultVolatile: DEFAULT_PARAMETER_VALUES.a.stopMultVolatile
      }
    }
  },
  STRAT_B: {
    strategyId: 'STRAT_B',
    strategyName: 'OB+FVG',
    momentum: {
      entryThresholdPct: 0.12,
      takeProfitPct: 0.25,
      stopLossPct: 0.2,
      maxHoldBars: DEFAULT_PARAMETER_VALUES.b.timeExitBars,
      stratB: {
        atrPeriod: DEFAULT_PARAMETER_VALUES.b.atrPeriod,
        impulseMult: DEFAULT_PARAMETER_VALUES.b.impulseMult,
        impulseBodyRatioMin: DEFAULT_PARAMETER_VALUES.b.impulseBodyRatioMin,
        poiValidBars: DEFAULT_PARAMETER_VALUES.b.poiValidBars,
        obLookback: DEFAULT_PARAMETER_VALUES.b.obLookback,
        slBuffer: DEFAULT_PARAMETER_VALUES.b.slBuffer,
        tpRrFallback: DEFAULT_PARAMETER_VALUES.b.tpRrFallback
      }
    }
  },
  STRAT_C: {
    strategyId: 'STRAT_C',
    strategyName: 'Profit-Max Scalper',
    momentum: {
      entryThresholdPct: 0.2,
      takeProfitPct: DEFAULT_PARAMETER_VALUES.c.tp2Pct,
      stopLossPct: DEFAULT_PARAMETER_VALUES.c.slPct,
      maxHoldBars: DEFAULT_PARAMETER_VALUES.c.timeStopMinutes,
      stratC: {
        allowedHoursKst: DEFAULT_PARAMETER_VALUES.c.entryAllowedHoursKst,
        breakoutLookbackCandles: DEFAULT_PARAMETER_VALUES.c.breakoutLookbackCandles,
        valueSpikeLookbackCandles: DEFAULT_PARAMETER_VALUES.c.valueSpikeLookbackCandles,
        valueSpikeMult: DEFAULT_PARAMETER_VALUES.c.valueSpikeMult,
        buyRatioMin: DEFAULT_PARAMETER_VALUES.c.buyRatioMin,
        bodyRatioMin: DEFAULT_PARAMETER_VALUES.c.bodyRatioMin,
        tp1Pct: DEFAULT_PARAMETER_VALUES.c.tp1Pct,
        tp2Pct: DEFAULT_PARAMETER_VALUES.c.tp2Pct,
        slPct: DEFAULT_PARAMETER_VALUES.c.slPct,
        timeStopMinutes: DEFAULT_PARAMETER_VALUES.c.timeStopMinutes
      }
    }
  }
} as const;

// Keep explicit parameter-key references in code to avoid silent hardcoding drift.
void PARAMETER_KEYS;

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
