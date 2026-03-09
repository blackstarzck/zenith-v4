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
      feePerSide: DEFAULT_PARAMETER_VALUES.common.feePerSide,
      slippageRate: DEFAULT_PARAMETER_VALUES.common.slippageAssumedPct,
      stratA: {
        entryAfterConfirmFill: DEFAULT_PARAMETER_VALUES.a.entryAfterConfirmFill,
        partialExitFillTiming: DEFAULT_PARAMETER_VALUES.a.partialExitFillTiming,
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
      feePerSide: DEFAULT_PARAMETER_VALUES.common.feePerSide,
      slippageRate: DEFAULT_PARAMETER_VALUES.common.slippageAssumedPct,
      stratB: {
        requireUserConfirm: DEFAULT_PARAMETER_VALUES.b.requireUserConfirm,
        approvalDelayBars: DEFAULT_PARAMETER_VALUES.b.approvalDelayBars,
        fillWhenAuto: DEFAULT_PARAMETER_VALUES.b.entryFillWhenAuto,
        fillWhenSemiAuto: DEFAULT_PARAMETER_VALUES.b.entryFillWhenSemiAuto,
        atrPeriod: DEFAULT_PARAMETER_VALUES.b.atrPeriod,
        impulseMult: DEFAULT_PARAMETER_VALUES.b.impulseMult,
        impulseBodyRatioMin: DEFAULT_PARAMETER_VALUES.b.impulseBodyRatioMin,
        poiValidBars: DEFAULT_PARAMETER_VALUES.b.poiValidBars,
        obLookback: DEFAULT_PARAMETER_VALUES.b.obLookback,
        slBuffer: DEFAULT_PARAMETER_VALUES.b.slBuffer,
        tpRrFallback: DEFAULT_PARAMETER_VALUES.b.tpRrFallback,
        trendlineLookback: DEFAULT_PARAMETER_VALUES.b.trendlineLookback,
        bullModeLookback: DEFAULT_PARAMETER_VALUES.b.bullModeLookback,
        bullModeMinClosesAboveTrend: DEFAULT_PARAMETER_VALUES.b.bullModeMinClosesAboveTrend,
        fvgMinGapPct: DEFAULT_PARAMETER_VALUES.b.fvgMinGapPct,
        timeExitBars: DEFAULT_PARAMETER_VALUES.b.timeExitBars
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
      orderKrw: DEFAULT_PARAMETER_VALUES.c.fixedOrderKrw,
      feePerSide: DEFAULT_PARAMETER_VALUES.common.feePerSide,
      slippageRate: DEFAULT_PARAMETER_VALUES.common.slippageAssumedPct,
      stratC: {
        allowedHoursKst: DEFAULT_PARAMETER_VALUES.c.entryAllowedHoursKst,
        breakoutLookbackCandles: DEFAULT_PARAMETER_VALUES.c.breakoutLookbackCandles,
        valueSpikeLookbackCandles: DEFAULT_PARAMETER_VALUES.c.valueSpikeLookbackCandles,
        valueSpikeMult: DEFAULT_PARAMETER_VALUES.c.valueSpikeMult,
        buyRatioMin: DEFAULT_PARAMETER_VALUES.c.buyRatioMin,
        bodyRatioMin: DEFAULT_PARAMETER_VALUES.c.bodyRatioMin,
        fixedOrderKrw: DEFAULT_PARAMETER_VALUES.c.fixedOrderKrw,
        tp1Pct: DEFAULT_PARAMETER_VALUES.c.tp1Pct,
        tp1Ratio: DEFAULT_PARAMETER_VALUES.c.tp1Ratio,
        tp2Pct: DEFAULT_PARAMETER_VALUES.c.tp2Pct,
        tp2Ratio: DEFAULT_PARAMETER_VALUES.c.tp2Ratio,
        slPct: DEFAULT_PARAMETER_VALUES.c.slPct,
        timeStopMinutes: DEFAULT_PARAMETER_VALUES.c.timeStopMinutes,
        cooldownMinutes: DEFAULT_PARAMETER_VALUES.c.cooldownMinutes,
        cooldownAfterStopMinutes: DEFAULT_PARAMETER_VALUES.c.cooldownAfterStopMinutes,
        pauseAfterConsecutiveStops: DEFAULT_PARAMETER_VALUES.c.pauseAfterConsecutiveStops,
        pauseMinutes: DEFAULT_PARAMETER_VALUES.c.pauseMinutes
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
