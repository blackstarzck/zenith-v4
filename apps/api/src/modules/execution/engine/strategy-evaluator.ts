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
  const nextHistory = [...state.recentCandles, candle].slice(-80);
  const stateWithHistory: MomentumState = {
    ...state,
    recentCandles: nextHistory
  };

  if (!state.inPosition) {
    return evaluateEntry(strategyId, stateWithHistory, candle, config);
  }
  return evaluateExit(stateWithHistory, candle, config);
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
  const shouldTakeProfit = pnlPct >= config.takeProfitPct;
  const shouldStopLoss = pnlPct <= -config.stopLossPct;
  const shouldTimeout = barsHeld >= config.maxHoldBars;

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
  const bb = bollinger(state.recentCandles.slice(-20).map((c) => c.close), 2);
  const pending = state.stratA?.pendingConfirmAt;
  const isBullish = candle.close > candle.open;

  if (typeof pending === 'number' && pending < candle.time && isBullish) {
    return buildEntryResult(state, candle, 'MEAN_REVERSION_CONFIRM');
  }

  if (!bb) {
    return { nextState: state, decisions: [] };
  }

  const trigger = candle.low < bb.lower && candle.close > bb.lower;
  if (!trigger) {
    return { nextState: { ...state, stratA: {} }, decisions: [] };
  }

  return {
    nextState: {
      ...state,
      stratA: { pendingConfirmAt: candle.time }
    },
    decisions: [{
      eventType: 'SIGNAL_EMIT',
      payload: {
        signal: 'WAIT_CONFIRM',
        reason: 'BB_RECLAIM_TRIGGER',
        thresholdPct: config.entryThresholdPct
      }
    }]
  };
}

function evaluateStratBEntry(
  state: MomentumState,
  candle: StrategyCandle,
  config: MomentumConfig
): StrategyEvaluateResult {
  const history = state.recentCandles;
  const prev = history[history.length - 2];
  const rangePct = pct(candle.high, candle.low);
  const bullish = candle.close > candle.open;

  let poiLow = state.stratB?.poiLow;
  let poiHigh = state.stratB?.poiHigh;

  if (prev) {
    const prevRangePct = pct(prev.high, prev.low);
    const prevBullish = prev.close > prev.open;
    if (prevBullish && prevRangePct >= 0.3) {
      poiLow = prev.low;
      poiHigh = prev.high;
    }
  }

  const touched = typeof poiLow === 'number' && typeof poiHigh === 'number'
    ? candle.low <= poiHigh && candle.high >= poiLow
    : false;
  const closeNearHigh = candle.high > 0 && ((candle.high - candle.close) / candle.high) * 100 <= 0.12;
  const confirmed = touched && bullish && closeNearHigh && rangePct >= config.entryThresholdPct;

  if (!confirmed) {
  const nextStratB = {
    ...(typeof poiLow === 'number' ? { poiLow } : {}),
    ...(typeof poiHigh === 'number' ? { poiHigh } : {})
  };

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
    stratB: {
      ...(typeof poiLow === 'number' ? { poiLow } : {}),
      ...(typeof poiHigh === 'number' ? { poiHigh } : {})
    }
  }, candle, 'POI_CONFIRM');
}

function evaluateStratCEntry(
  state: MomentumState,
  candle: StrategyCandle,
  config: MomentumConfig
): StrategyEvaluateResult {
  const history = state.recentCandles.slice(-16, -1);
  const prevHigh = history.length > 0 ? Math.max(...history.map((c) => c.high)) : undefined;
  if (typeof prevHigh !== 'number') {
    return { nextState: state, decisions: [] };
  }

  const breakout = candle.close > prevHigh;
  const candleReturnPct = pct(candle.close, candle.open);
  const rangePct = pct(candle.high, candle.low);
  const confirmed = breakout && candleReturnPct >= config.entryThresholdPct && rangePct >= config.entryThresholdPct * 1.1;
  if (!confirmed) {
    return { nextState: state, decisions: [] };
  }

  return buildEntryResult(state, candle, 'BREAKOUT_MOMENTUM');
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

function bollinger(closes: readonly number[], stdMultiplier: number): Readonly<{ lower: number; mid: number; upper: number }> | undefined {
  if (closes.length < 20) {
    return undefined;
  }
  const mean = closes.reduce((acc, value) => acc + value, 0) / closes.length;
  const variance = closes.reduce((acc, value) => acc + (value - mean) ** 2, 0) / closes.length;
  const std = Math.sqrt(variance);
  return {
    lower: mean - stdMultiplier * std,
    mid: mean,
    upper: mean + stdMultiplier * std
  };
}

function pct(a: number, b: number): number {
  if (b === 0) return 0;
  return ((a - b) / b) * 100;
}

function round(value: number): number {
  return Number(value.toFixed(4));
}
