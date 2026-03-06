import type { StrategyId } from './strategy-config';
import type {
  MomentumConfig,
  MomentumState,
  StrategyCandle,
  StrategyEventDecision
} from './simple-momentum.strategy';
import { INITIAL_MOMENTUM_STATE } from './simple-momentum.strategy';

export type StrategyEvaluateResult = Readonly<{
  nextState: MomentumState;
  decisions: readonly StrategyEventDecision[];
}>;

export function evaluateStrategyCandle(
  strategyId: StrategyId,
  state: MomentumState,
  candle: StrategyCandle,
  config: MomentumConfig
): StrategyEvaluateResult {
  const nextHistory = [...state.recentCandles, candle].slice(-200);
  const stateWithHistory: MomentumState = {
    ...state,
    recentCandles: nextHistory
  };

  if (!state.inPosition) {
    return evaluateEntry(strategyId, stateWithHistory, candle, config);
  }
  return evaluateExit(strategyId, stateWithHistory, candle, config);
}

function evaluateEntry(
  strategyId: StrategyId,
  state: MomentumState,
  candle: StrategyCandle,
  config: MomentumConfig
): StrategyEvaluateResult {
  if (strategyId === 'STRAT_A') {
    return evaluateStratAEntry(state, candle, config);
  }
  if (strategyId === 'STRAT_B') {
    return evaluateStratBEntry(state, candle, config);
  }
  return evaluateStratCEntry(state, candle, config);
}

function evaluateExit(
  strategyId: StrategyId,
  state: MomentumState,
  candle: StrategyCandle,
  config: MomentumConfig
): StrategyEvaluateResult {
  const entry = state.entryPrice;
  if (typeof entry !== 'number' || entry <= 0) {
    return {
      nextState: INITIAL_MOMENTUM_STATE,
      decisions: []
    };
  }

  const barsHeld = state.barsHeld + 1;
  const pnlPct = pct(candle.close, entry);
  const takeProfitPct = resolveTakeProfitPct(strategyId, config);
  const stopLossPct = resolveStopLossPct(strategyId, config);
  const timeExitBars = resolveTimeExitBars(strategyId, config);
  const shouldTakeProfit = pnlPct >= takeProfitPct;
  const shouldStopLoss = pnlPct <= -stopLossPct;
  const shouldTimeout = barsHeld >= timeExitBars;

  if (!shouldTakeProfit && !shouldStopLoss && !shouldTimeout) {
    return {
      nextState: {
        ...state,
        barsHeld
      },
      decisions: []
    };
  }

  const reason = shouldTakeProfit ? 'TP' : shouldStopLoss ? 'SL' : 'TIME';
  const decisions: StrategyEventDecision[] = [
    {
      eventType: 'EXIT',
      payload: {
        reason,
        pnlPct: round(pnlPct),
        barsHeld
      }
    },
    {
      eventType: 'ORDER_INTENT',
      payload: {
        side: 'SELL',
        qty: 1,
        price: candle.close,
        reason: `EXIT_${reason}`
      }
    },
    {
      eventType: 'FILL',
      payload: {
        side: 'SELL',
        qty: 1,
        fillPrice: candle.close
      }
    },
    {
      eventType: 'POSITION_UPDATE',
      payload: {
        side: 'FLAT',
        qty: 0,
        realizedPnlPct: round(pnlPct)
      }
    }
  ];

  return {
    nextState: INITIAL_MOMENTUM_STATE,
    decisions
  };
}

function evaluateStratAEntry(
  state: MomentumState,
  candle: StrategyCandle,
  config: MomentumConfig
): StrategyEvaluateResult {
  const stratA = config.stratA;
  if (!stratA) {
    return { nextState: state, decisions: [] };
  }

  const kstHour = toKstHour(candle.time);
  const excludedHour = stratA.excludeEntryHoursKst.includes(kstHour);
  const pending = state.stratA?.pendingConfirmAt;
  const isBullish = candle.close > candle.open;
  if (typeof pending === 'number' && pending < candle.time && isBullish && !excludedHour) {
    return buildEntryResult(state, candle, 'A_CONFIRM_NEXT_BAR');
  }

  const closes = state.recentCandles.map((c) => c.close);
  const bb = bollinger(closes, stratA.bbPeriod, stratA.bbStd);
  const adx = adxValue(state.recentCandles, stratA.adxPeriod);
  const rsiNow = rsiValue(closes, stratA.rsiPeriod);
  const rsiPast = rsiValue(closes.slice(0, -stratA.rsiSlopeLookback), stratA.rsiPeriod);
  const rsiSlope = typeof rsiNow === 'number' && typeof rsiPast === 'number' ? rsiNow - rsiPast : 0;
  if (!bb || typeof adx !== 'number' || typeof rsiNow !== 'number' || excludedHour) {
    return {
      nextState: {
        ...state,
        stratA: {}
      },
      decisions: []
    };
  }

  const trigger = candle.low < bb.lower && candle.close > bb.lower;
  const filtersOk = adx <= stratA.maxAdx && rsiSlope >= stratA.rsiSlopeMin;
  if (!trigger || !filtersOk) {
    return {
      nextState: {
        ...state,
        stratA: {}
      },
      decisions: []
    };
  }

  return {
    nextState: {
      ...state,
      stratA: { pendingConfirmAt: candle.time }
    },
    decisions: [
      {
        eventType: 'SIGNAL_EMIT',
        payload: {
          signal: 'WAIT_CONFIRM',
          reason: 'A_BB_RECLAIM',
          adx: round(adx),
          rsi: round(rsiNow),
          rsiSlope: round(rsiSlope)
        }
      }
    ]
  };
}

function evaluateStratBEntry(
  state: MomentumState,
  candle: StrategyCandle,
  config: MomentumConfig
): StrategyEvaluateResult {
  const stratB = config.stratB;
  if (!stratB) {
    return { nextState: state, decisions: [] };
  }

  const history = state.recentCandles;
  const prev = history[history.length - 2];
  let poiLow = state.stratB?.poiLow;
  let poiHigh = state.stratB?.poiHigh;
  let poiExpiresAt = state.stratB?.poiExpiresAt;

  if (typeof poiExpiresAt === 'number' && candle.time > poiExpiresAt) {
    poiLow = undefined;
    poiHigh = undefined;
    poiExpiresAt = undefined;
  }

  const atr = atrValue(history, stratB.atrPeriod);
  if (prev && typeof atr === 'number') {
    const prevRange = Math.max(0, prev.high - prev.low);
    const prevBodyRatio = bodyRatio(prev);
    const impulse = prevRange >= atr * stratB.impulseMult && prevBodyRatio >= stratB.impulseBodyRatioMin && prev.close > prev.open;
    if (impulse) {
      const segment = history.slice(Math.max(0, history.length - 1 - stratB.obLookback), history.length - 1);
      const zoneLow = segment.length > 0 ? Math.min(...segment.map((c) => c.low)) : prev.low;
      const zoneHigh = prev.high;
      poiLow = zoneLow;
      poiHigh = zoneHigh;
      poiExpiresAt = candle.time + stratB.poiValidBars * 60;
    }
  }

  const touched = typeof poiLow === 'number' && typeof poiHigh === 'number'
    ? candle.low <= poiHigh && candle.high >= poiLow
    : false;
  const confirmed = touched && candle.close > candle.open;

  const nextStratB = {
    ...(typeof poiLow === 'number' ? { poiLow } : {}),
    ...(typeof poiHigh === 'number' ? { poiHigh } : {}),
    ...(typeof poiExpiresAt === 'number' ? { poiExpiresAt } : {})
  };

  if (!confirmed) {
    return {
      nextState: {
        ...state,
        stratB: nextStratB
      },
      decisions: []
    };
  }

  return buildEntryResult({
    ...state,
    stratB: nextStratB
  }, candle, 'B_POI_TOUCH_CONFIRM');
}

function evaluateStratCEntry(
  state: MomentumState,
  candle: StrategyCandle,
  config: MomentumConfig
): StrategyEvaluateResult {
  const stratC = config.stratC;
  if (!stratC) {
    return { nextState: state, decisions: [] };
  }

  const kstHour = toKstHour(candle.time);
  if (!stratC.allowedHoursKst.includes(kstHour)) {
    return { nextState: state, decisions: [] };
  }

  const beforeCurrent = state.recentCandles.slice(0, -1);
  const breakoutRange = beforeCurrent.slice(-stratC.breakoutLookbackCandles);
  if (breakoutRange.length === 0) {
    return { nextState: state, decisions: [] };
  }
  const prevHigh = Math.max(...breakoutRange.map((c) => c.high));
  const breakout = candle.close > prevHigh;

  const valueSeries = beforeCurrent.slice(-stratC.valueSpikeLookbackCandles).map(candleValueProxy);
  const avgValue = average(valueSeries);
  const currentValue = candleValueProxy(candle);
  const valueSpike = avgValue > 0 ? currentValue >= avgValue * stratC.valueSpikeMult : false;
  const bRatio = buyRatio(candle);
  const body = bodyRatio(candle);

  if (!(breakout && valueSpike && bRatio >= stratC.buyRatioMin && body >= stratC.bodyRatioMin)) {
    return { nextState: state, decisions: [] };
  }

  return buildEntryResult(state, candle, 'C_BREAKOUT_VALUE_SPIKE');
}

function resolveTakeProfitPct(strategyId: StrategyId, config: MomentumConfig): number {
  if (strategyId === 'STRAT_A' && config.stratA) {
    return config.stratA.tpPct;
  }
  if (strategyId === 'STRAT_C' && config.stratC) {
    return config.stratC.tp2Pct;
  }
  return config.takeProfitPct;
}

function resolveStopLossPct(strategyId: StrategyId, config: MomentumConfig): number {
  if (strategyId === 'STRAT_C' && config.stratC) {
    return config.stratC.slPct;
  }
  return config.stopLossPct;
}

function resolveTimeExitBars(strategyId: StrategyId, config: MomentumConfig): number {
  if (strategyId === 'STRAT_A' && config.stratA) {
    return config.stratA.timeExitMaxHoldBars;
  }
  if (strategyId === 'STRAT_C' && config.stratC) {
    return config.stratC.timeStopMinutes;
  }
  return config.maxHoldBars;
}

function buildEntryResult(
  state: MomentumState,
  candle: StrategyCandle,
  reason: string
): StrategyEvaluateResult {
  const decisions: StrategyEventDecision[] = [
    {
      eventType: 'SIGNAL_EMIT',
      payload: {
        signal: 'LONG_ENTRY',
        reason
      }
    },
    {
      eventType: 'ORDER_INTENT',
      payload: {
        side: 'BUY',
        qty: 1,
        price: candle.close,
        reason
      }
    },
    {
      eventType: 'FILL',
      payload: {
        side: 'BUY',
        qty: 1,
        fillPrice: candle.close
      }
    },
    {
      eventType: 'POSITION_UPDATE',
      payload: {
        side: 'LONG',
        qty: 1,
        avgEntry: candle.close
      }
    }
  ];

  return {
    nextState: {
      ...state,
      inPosition: true,
      entryPrice: candle.close,
      entryTime: candle.time,
      barsHeld: 0,
      stratA: {}
    },
    decisions
  };
}

function bollinger(
  closes: readonly number[],
  period: number,
  stdMultiplier: number
): Readonly<{ lower: number; mid: number; upper: number }> | undefined {
  if (closes.length < period) {
    return undefined;
  }
  const segment = closes.slice(-period);
  const mean = average(segment);
  const variance = average(segment.map((value) => (value - mean) ** 2));
  const std = Math.sqrt(variance);
  return {
    lower: mean - stdMultiplier * std,
    mid: mean,
    upper: mean + stdMultiplier * std
  };
}

function atrValue(candles: readonly StrategyCandle[], period: number): number | undefined {
  if (candles.length < period + 1) {
    return undefined;
  }
  const tr: number[] = [];
  for (let i = candles.length - period; i < candles.length; i += 1) {
    const curr = candles[i];
    const prev = candles[i - 1];
    if (!curr || !prev) {
      continue;
    }
    const range1 = curr.high - curr.low;
    const range2 = Math.abs(curr.high - prev.close);
    const range3 = Math.abs(curr.low - prev.close);
    tr.push(Math.max(range1, range2, range3));
  }
  if (tr.length === 0) {
    return undefined;
  }
  return average(tr);
}

function adxValue(candles: readonly StrategyCandle[], period: number): number | undefined {
  if (candles.length < period + 2) {
    return undefined;
  }

  const plusDm: number[] = [];
  const minusDm: number[] = [];
  const tr: number[] = [];

  for (let i = 1; i < candles.length; i += 1) {
    const curr = candles[i];
    const prev = candles[i - 1];
    if (!curr || !prev) {
      continue;
    }
    const upMove = curr.high - prev.high;
    const downMove = prev.low - curr.low;
    plusDm.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDm.push(downMove > upMove && downMove > 0 ? downMove : 0);
    tr.push(Math.max(
      curr.high - curr.low,
      Math.abs(curr.high - prev.close),
      Math.abs(curr.low - prev.close)
    ));
  }

  const plus = plusDm.slice(-period);
  const minus = minusDm.slice(-period);
  const trSlice = tr.slice(-period);
  const trAvg = average(trSlice);
  if (trAvg <= 0) {
    return undefined;
  }
  const plusDi = (average(plus) / trAvg) * 100;
  const minusDi = (average(minus) / trAvg) * 100;
  const denominator = plusDi + minusDi;
  if (denominator <= 0) {
    return undefined;
  }
  return (Math.abs(plusDi - minusDi) / denominator) * 100;
}

function rsiValue(closes: readonly number[], period: number): number | undefined {
  if (closes.length < period + 1) {
    return undefined;
  }
  const slice = closes.slice(-(period + 1));
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < slice.length; i += 1) {
    const current = slice[i];
    const prev = slice[i - 1];
    if (typeof current !== 'number' || typeof prev !== 'number') {
      continue;
    }
    const diff = current - prev;
    if (diff > 0) {
      gain += diff;
    } else {
      loss += Math.abs(diff);
    }
  }
  if (loss === 0) {
    return 100;
  }
  const rs = (gain / period) / (loss / period);
  return 100 - (100 / (1 + rs));
}

function toKstHour(epochSec: number): number {
  const kstMs = epochSec * 1000 + 9 * 60 * 60 * 1000;
  return new Date(kstMs).getUTCHours();
}

function candleValueProxy(candle: StrategyCandle): number {
  return Math.max(0, candle.high - candle.low) * candle.close;
}

function buyRatio(candle: StrategyCandle): number {
  const range = Math.max(1e-9, candle.high - candle.low);
  const bullishBody = Math.max(0, candle.close - candle.open);
  return Math.min(1, bullishBody / range);
}

function bodyRatio(candle: StrategyCandle): number {
  const range = Math.max(1e-9, candle.high - candle.low);
  return Math.abs(candle.close - candle.open) / range;
}

function average(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((acc, value) => acc + value, 0) / values.length;
}

function pct(a: number, b: number): number {
  if (b === 0) {
    return 0;
  }
  return ((a - b) / b) * 100;
}

function round(value: number): number {
  return Number(value.toFixed(4));
}
