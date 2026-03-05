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
}>;

export type MomentumState = Readonly<{
  inPosition: boolean;
  entryPrice?: number;
  entryTime?: number;
  barsHeld: number;
  recentCandles: readonly StrategyCandle[];
  stratA?: Readonly<{
    pendingConfirmAt?: number;
  }>;
  stratB?: Readonly<{
    poiLow?: number;
    poiHigh?: number;
  }>;
}>;

export type StrategyEventDecision = Readonly<{
  eventType: 'SIGNAL_EMIT' | 'ORDER_INTENT' | 'FILL' | 'POSITION_UPDATE' | 'EXIT';
  payload: Readonly<Record<string, unknown>>;
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
  const decisions: StrategyEventDecision[] = [];
  const candleReturnPct = ((candle.close - candle.open) / candle.open) * 100;

  if (!state.inPosition) {
    if (candleReturnPct >= config.entryThresholdPct) {
      decisions.push({
        eventType: 'SIGNAL_EMIT',
        payload: {
          signal: 'LONG_ENTRY',
          candleReturnPct: round(candleReturnPct),
          thresholdPct: config.entryThresholdPct
        }
      });
      decisions.push({
        eventType: 'ORDER_INTENT',
        payload: {
          side: 'BUY',
          qty: 1,
          price: candle.close,
          reason: 'MOMENTUM_ENTRY'
        }
      });
      decisions.push({
        eventType: 'FILL',
        payload: {
          side: 'BUY',
          qty: 1,
          fillPrice: candle.close
        }
      });
      decisions.push({
        eventType: 'POSITION_UPDATE',
        payload: {
          side: 'LONG',
          qty: 1,
          avgEntry: candle.close
        }
      });
      return {
        nextState: {
          inPosition: true,
          entryPrice: candle.close,
          entryTime: candle.time,
          barsHeld: 0,
          recentCandles: nextHistory
        },
        decisions
      };
    }

    return {
      nextState: {
        ...state,
        recentCandles: nextHistory
      },
      decisions
    };
  }

  const entry = state.entryPrice;
  if (typeof entry !== 'number' || entry <= 0) {
    return {
      nextState: {
        ...INITIAL_MOMENTUM_STATE,
        recentCandles: nextHistory
      },
      decisions
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
      decisions
    };
  }

  const reason = shouldTakeProfit ? 'TP' : shouldStopLoss ? 'SL' : 'TIME';
  decisions.push({
    eventType: 'EXIT',
    payload: {
      reason,
      pnlPct: round(pnlPct),
      barsHeld
    }
  });
  decisions.push({
    eventType: 'ORDER_INTENT',
    payload: {
      side: 'SELL',
      qty: 1,
      price: candle.close,
      reason: `MOMENTUM_${reason}`
    }
  });
  decisions.push({
    eventType: 'FILL',
    payload: {
      side: 'SELL',
      qty: 1,
      fillPrice: candle.close
    }
  });
  decisions.push({
    eventType: 'POSITION_UPDATE',
    payload: {
      side: 'FLAT',
      qty: 0,
      realizedPnlPct: round(pnlPct)
    }
  });

  return {
    nextState: {
      ...INITIAL_MOMENTUM_STATE,
      recentCandles: nextHistory
    },
    decisions
  };
}

function round(value: number): number {
  return Number(value.toFixed(4));
}
