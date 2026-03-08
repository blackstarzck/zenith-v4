import { buildExitSequence, buildLongEntrySequence, type StrategyEventDecision } from './execution-sequence';

export type StrategyCandle = Readonly<{
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}>;

export type MomentumConfig = Readonly<{
  entryThresholdPct: number;
  takeProfitPct: number;
  stopLossPct: number;
  maxHoldBars: number;
  stratA?: Readonly<{
    bbPeriod: number;
    bbStd: number;
    atrPeriod: number;
    adxPeriod: number;
    rsiPeriod: number;
    rsiSlopeLookback: number;
    excludeEntryHoursKst: readonly number[];
    maxAdx: number;
    rsiSlopeMin: number;
    tpPct: number;
    partialRatio: number;
    trailAtrMult: number;
    timeExitMaxHoldBars: number;
    stopMultRanging: number;
    stopMultTrending: number;
    stopMultVolatile: number;
  }>;
  stratB?: Readonly<{
    atrPeriod: number;
    impulseMult: number;
    impulseBodyRatioMin: number;
    poiValidBars: number;
    obLookback: number;
    slBuffer: number;
    tpRrFallback: number;
  }>;
  stratC?: Readonly<{
    allowedHoursKst: readonly number[];
    breakoutLookbackCandles: number;
    valueSpikeLookbackCandles: number;
    valueSpikeMult: number;
    buyRatioMin: number;
    bodyRatioMin: number;
    tp1Pct: number;
    tp2Pct: number;
    slPct: number;
    timeStopMinutes: number;
  }>;
}>;

export type MomentumState = Readonly<{
  inPosition: boolean;
  entryPrice?: number;
  entryTime?: number;
  positionQty?: number;
  entryNotionalKrw?: number;
  barsHeld: number;
  recentCandles: readonly StrategyCandle[];
  stratA?: Readonly<{
    pendingConfirmAt?: number;
  }>;
  stratB?: Readonly<{
    poiLow?: number;
    poiHigh?: number;
    poiExpiresAt?: number;
  }>;
}>;

export type EvaluateResult = Readonly<{
  nextState: MomentumState;
  decisions: readonly StrategyEventDecision[];
}>;

export const DEFAULT_MOMENTUM_CONFIG: MomentumConfig = Object.freeze({
  entryThresholdPct: 0.12,
  takeProfitPct: 0.25,
  stopLossPct: 0.2,
  maxHoldBars: 5
});

export const INITIAL_MOMENTUM_STATE: MomentumState = Object.freeze({
  inPosition: false,
  barsHeld: 0,
  recentCandles: []
});

export function evaluateMomentumCandle(
  state: MomentumState,
  candle: StrategyCandle,
  config: MomentumConfig = DEFAULT_MOMENTUM_CONFIG
): EvaluateResult {
  const nextHistory = [...state.recentCandles, candle].slice(-60);
  const candleReturnPct = ((candle.close - candle.open) / candle.open) * 100;

  if (!state.inPosition) {
    if (candleReturnPct >= config.entryThresholdPct) {
      return {
        nextState: {
          inPosition: true,
          entryPrice: candle.close,
          entryTime: candle.time,
          barsHeld: 0,
          recentCandles: nextHistory
        },
        decisions: buildLongEntrySequence({
          price: candle.close,
          orderReason: 'MOMENTUM_ENTRY',
          signalPayload: {
            signal: 'LONG_ENTRY',
            reason: 'MOMENTUM_ENTRY',
            candleReturnPct: round(candleReturnPct),
            thresholdPct: config.entryThresholdPct
          }
        })
      };
    }

    return {
      nextState: {
        ...state,
        recentCandles: nextHistory
      },
      decisions: []
    };
  }

  const entry = state.entryPrice;
  if (typeof entry !== 'number' || entry <= 0) {
    return {
      nextState: {
        ...INITIAL_MOMENTUM_STATE,
        recentCandles: nextHistory
      },
      decisions: []
    };
  }

  const barsHeld = state.barsHeld + 1;
  const pnlPct = ((candle.close - entry) / entry) * 100;
  const shouldTakeProfit = pnlPct >= config.takeProfitPct;
  const shouldStopLoss = pnlPct <= -config.stopLossPct;
  const shouldTimeout = barsHeld >= config.maxHoldBars;

  if (!shouldTakeProfit && !shouldStopLoss && !shouldTimeout) {
    return {
      nextState: {
        ...state,
        recentCandles: nextHistory,
        barsHeld
      },
      decisions: []
    };
  }

  const reason = shouldTakeProfit ? 'TP' : shouldStopLoss ? 'SL' : 'TIME';

  return {
    nextState: {
      ...INITIAL_MOMENTUM_STATE,
      recentCandles: nextHistory
    },
    decisions: buildExitSequence({
      price: candle.close,
      orderReason: `MOMENTUM_${reason}`,
      exitPayload: {
        reason,
        pnlPct: round(pnlPct),
        barsHeld
      }
    })
  };
}

function round(value: number): number {
  return Number(value.toFixed(4));
}
