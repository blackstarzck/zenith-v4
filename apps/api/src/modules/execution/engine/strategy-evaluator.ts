import { buildExitSequence, buildLongEntrySequence, type StrategyEventDecision } from './execution-sequence';
import type { StrategyId } from './strategy-config';
import type {
  MomentumConfig,
  MomentumState,
  StrategyCandle
} from './simple-momentum.strategy';
import { INITIAL_MOMENTUM_STATE } from './simple-momentum.strategy';

export type StrategyEvaluateResult = Readonly<{
  nextState: MomentumState;
  decisions: readonly StrategyEventDecision[];
}>;

export type StrategyEntryReadiness = Readonly<{
  entryReadinessPct: number;
  entryReady: boolean;
  reason: string;
  inPosition: boolean;
}>;

export type StrategyEvaluationDetailed = Readonly<{
  result: StrategyEvaluateResult;
  readiness: StrategyEntryReadiness;
}>;

export function evaluateStrategyCandle(
  strategyId: StrategyId,
  state: MomentumState,
  candle: StrategyCandle,
  config: MomentumConfig
): StrategyEvaluateResult {
  return evaluateStrategyCandleDetailed(strategyId, state, candle, config).result;
}

export function evaluateStrategyCandleDetailed(
  strategyId: StrategyId,
  state: MomentumState,
  candle: StrategyCandle,
  config: MomentumConfig
): StrategyEvaluationDetailed {
  const nextHistory = [...state.recentCandles, candle].slice(-200);
  const stateWithHistory: MomentumState = {
    ...state,
    recentCandles: nextHistory
  };

  if (state.inPosition) {
    return {
      result: evaluateExit(strategyId, stateWithHistory, candle, config),
      readiness: {
        entryReadinessPct: 100,
        entryReady: false,
        reason: 'IN_POSITION',
        inPosition: true
      }
    };
  }

  const entryResult = evaluateEntry(strategyId, stateWithHistory, candle, config);
  const entryReady = entryResult.decisions.some((decision) => (
    decision.eventType === 'ORDER_INTENT' &&
    String(decision.payload.side ?? '').toUpperCase() === 'BUY'
  ));
  if (entryReady) {
    const signal = entryResult.decisions.find((decision) => decision.eventType === 'SIGNAL_EMIT');
    return {
      result: entryResult,
      readiness: {
        entryReadinessPct: 100,
        entryReady: true,
        reason: String(signal?.payload.reason ?? 'ENTRY_READY'),
        inPosition: false
      }
    };
  }

  return {
    result: entryResult,
    readiness: {
      entryReadinessPct: capWaitingReadiness(computeEntryReadinessPct(strategyId, stateWithHistory, candle, config)),
      entryReady: false,
      reason: 'ENTRY_WAIT',
      inPosition: false
    }
  };
}

export function evaluateStrategyEntryReadiness(
  strategyId: StrategyId,
  state: MomentumState,
  candle: StrategyCandle,
  config: MomentumConfig
): StrategyEntryReadiness {
  return evaluateStrategyCandleDetailed(strategyId, state, candle, config).readiness;
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
      nextState: buildFlatStateAfterExit(strategyId, state),
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
  return {
    nextState: buildFlatStateAfterExit(strategyId, state),
    decisions: buildExitSequence({
      price: candle.close,
      orderReason: `EXIT_${reason}`,
      exitPayload: {
        reason,
        pnlPct: round(pnlPct),
        barsHeld
      }
    })
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
    ...buildLongEntrySequence({
      price: candle.close,
      orderReason: reason
    })
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toPct(value: number): number {
  return Math.round(clamp(value, 0, 100));
}

function capWaitingReadiness(value: number): number {
  return Math.min(99, toPct(value));
}

function computeEntryReadinessPct(
  strategyId: StrategyId,
  state: MomentumState,
  candle: StrategyCandle,
  config: MomentumConfig
): number {
  if (strategyId === 'STRAT_A' && config.stratA) {
    const closes = state.recentCandles.map((item) => item.close);
    const bb = bollinger(closes, config.stratA.bbPeriod, config.stratA.bbStd);
    const adx = adxValue(state.recentCandles, config.stratA.adxPeriod);
    const rsiNow = rsiValue(closes, config.stratA.rsiPeriod);
    const rsiPast = rsiValue(closes.slice(0, -config.stratA.rsiSlopeLookback), config.stratA.rsiPeriod);
    if (!bb || typeof adx !== 'number' || typeof rsiNow !== 'number' || typeof rsiPast !== 'number') {
      return 0;
    }
    const lowerDistPct = bb.lower > 0 ? Math.abs(candle.close - bb.lower) / bb.lower : 1;
    const reclaimBonus = candle.low <= bb.lower && candle.close > bb.lower ? 20 : 0;
    const adxScore = clamp((config.stratA.maxAdx - adx) / Math.max(1, config.stratA.maxAdx), 0, 1) * 30;
    const rsiSlope = rsiNow - rsiPast;
    const slopeScore = clamp((rsiSlope - config.stratA.rsiSlopeMin + 2) / 4, 0, 1) * 30;
    const distScore = clamp(1 - lowerDistPct * 50, 0, 1) * 20;
    return toPct(adxScore + slopeScore + distScore + reclaimBonus);
  }

  if (strategyId === 'STRAT_B' && config.stratB) {
    const activeReadiness = computeStratBActivePoiReadiness(state, candle, config.stratB);
    if (activeReadiness > 0) {
      return activeReadiness;
    }
    return computeStratBRecentImpulseReadiness(state.recentCandles, candle, config.stratB);
  }

  if (config.stratC) {
    const stratC = config.stratC;
    const kstHour = toKstHour(candle.time);
    const isAllowedHour = stratC.allowedHoursKst.includes(kstHour);
    const beforeCurrent = state.recentCandles.slice(0, -1);
    const breakoutRange = beforeCurrent.slice(-stratC.breakoutLookbackCandles);
    if (breakoutRange.length === 0) {
      return 0;
    }
    const prevHigh = Math.max(...breakoutRange.map((item) => item.high));
    const breakoutRatio = prevHigh > 0 ? candle.close / prevHigh : 0;
    const breakoutScore = clamp((breakoutRatio - 0.97) / 0.03, 0, 1) * 70;
    const valueSeries = beforeCurrent.slice(-stratC.valueSpikeLookbackCandles).map(candleValueProxy);
    const avgValue = average(valueSeries);
    const currentValue = candleValueProxy(candle);
    const valueRatio = avgValue > 0 ? currentValue / avgValue : 0;
    const valueScore = clamp((valueRatio - 0.8) / Math.max(0.001, stratC.valueSpikeMult - 0.8), 0, 1) * 30;
    const readiness = toPct(breakoutScore + valueScore);
    return isAllowedHour ? readiness : Math.min(readiness, 89);
  }

  return 0;
}

function buildFlatStateAfterExit(strategyId: StrategyId, state: MomentumState): MomentumState {
  const baseState: MomentumState = {
    inPosition: false,
    barsHeld: 0,
    recentCandles: state.recentCandles
  };

  if (strategyId === 'STRAT_B' && state.stratB) {
    return {
      ...baseState,
      stratB: state.stratB
    };
  }

  return baseState;
}

function computeStratBActivePoiReadiness(
  state: MomentumState,
  candle: StrategyCandle,
  stratB: NonNullable<MomentumConfig['stratB']>
): number {
  const poiLow = state.stratB?.poiLow;
  const poiHigh = state.stratB?.poiHigh;
  const poiExpiresAt = state.stratB?.poiExpiresAt;
  if (
    typeof poiLow !== 'number' ||
    typeof poiHigh !== 'number' ||
    (typeof poiExpiresAt === 'number' && candle.time > poiExpiresAt)
  ) {
    return 0;
  }

  const high = Math.max(poiHigh, poiLow);
  const low = Math.min(poiHigh, poiLow);
  const touched = candle.low <= high && candle.high >= low;
  if (touched) {
    return toPct(candle.close > candle.open ? 100 : 85);
  }

  const nearest = candle.close > high ? high : low;
  const distPct = nearest > 0 ? Math.abs(candle.close - nearest) / nearest : 1;
  const distScore = clamp(1 - distPct * 40, 0, 1) * 70;
  const freshnessScore = typeof poiExpiresAt === 'number'
    ? clamp((poiExpiresAt - candle.time) / Math.max(60, stratB.poiValidBars * 60), 0, 1) * 30
    : 10;
  return toPct(distScore + freshnessScore);
}

function computeStratBRecentImpulseReadiness(
  history: readonly StrategyCandle[],
  candle: StrategyCandle,
  stratB: NonNullable<MomentumConfig['stratB']>
): number {
  if (history.length < 2) {
    return 0;
  }

  const maxCandidateBars = Math.max(stratB.poiValidBars, stratB.obLookback * 2);
  const startIndex = Math.max(1, history.length - maxCandidateBars);
  let bestScore = 0;

  for (let signalIndex = startIndex; signalIndex < history.length; signalIndex += 1) {
    const impulseCandle = history[signalIndex - 1];
    if (!impulseCandle) {
      continue;
    }

    const candidateHistory = history.slice(0, signalIndex + 1);
    const atr = resolveStratBReadinessAtr(candidateHistory, stratB.atrPeriod);
    if (typeof atr !== 'number' || atr <= 0) {
      continue;
    }

    const range = Math.max(0, impulseCandle.high - impulseCandle.low);
    const rangeScore = clamp(range / Math.max(1e-9, atr * Math.max(0.0001, stratB.impulseMult)), 0, 1);
    const bodyScore = clamp(bodyRatio(impulseCandle) / Math.max(0.0001, stratB.impulseBodyRatioMin), 0, 1);
    const bullishCloseScore = clamp(
      (impulseCandle.close - impulseCandle.low) / Math.max(impulseCandle.high - impulseCandle.low, 1e-9),
      0,
      1
    );
    const strength = (rangeScore * 0.45) + (bodyScore * 0.35) + (bullishCloseScore * 0.20);
    if (strength <= 0) {
      continue;
    }

    const segment = history.slice(Math.max(0, signalIndex - 1 - stratB.obLookback), signalIndex - 1);
    const poiLow = segment.length > 0 ? Math.min(...segment.map((item) => item.low)) : impulseCandle.low;
    const poiHigh = impulseCandle.high;
    const high = Math.max(poiHigh, poiLow);
    const low = Math.min(poiHigh, poiLow);
    const touched = candle.low <= high && candle.high >= low;
    const nearest = candle.close > high ? high : low;
    const distPct = nearest > 0 ? Math.abs(candle.close - nearest) / nearest : 1;
    const distScore = clamp(1 - distPct * 40, 0, 1);
    const ageBars = history.length - signalIndex;
    const ageScore = clamp(1 - ageBars / Math.max(1, stratB.poiValidBars), 0, 1);
    const score = touched && strength >= 0.6
      ? toPct(candle.close > candle.open ? 100 : 85)
      : toPct((strength * 45) + (distScore * 35) + (ageScore * 20) + (touched ? 10 : 0));
    bestScore = Math.max(bestScore, score);
  }

  return bestScore;
}

function resolveStratBReadinessAtr(candles: readonly StrategyCandle[], period: number): number | undefined {
  const atr = atrValue(candles, period);
  if (typeof atr === 'number') {
    return atr;
  }

  if (candles.length < 2) {
    return undefined;
  }

  const tr: number[] = [];
  for (let i = 1; i < candles.length; i += 1) {
    const prev = candles[i - 1];
    const curr = candles[i];
    if (!prev || !curr) {
      continue;
    }
    tr.push(Math.max(
      curr.high - curr.low,
      Math.abs(curr.high - prev.close),
      Math.abs(curr.low - prev.close)
    ));
  }

  return tr.length > 0 ? average(tr) : undefined;
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
