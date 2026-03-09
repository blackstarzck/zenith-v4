import { buildExitSequence, buildLongEntrySequence } from '../../execution-sequence';
import type { MomentumConfig, MomentumState } from '../../simple-momentum.strategy';
import {
  bodyRatio,
  pctChange,
  round,
  toKstHour
} from '../../shared/indicators';
import type { StrategyModule, StrategyModuleContext, StrategyModuleResult } from '../../shared/strategy-module';
import type { StrategyEntryReadiness } from '../../shared/strategy-readiness';
import type { StrategyCandle, StrategyMarketEvent } from '../../shared/market-types';

const ONE_MINUTE_SEC = 60;

export const stratCModule: StrategyModule = {
  strategyId: 'STRAT_C',
  evaluate: (state, event, context) => evaluateStratC(state, event, context)
};

function evaluateStratC(
  state: MomentumState,
  event: StrategyMarketEvent,
  context: StrategyModuleContext
): StrategyModuleResult {
  const stratC = context.config.stratC;
  if (!stratC) {
    return { nextState: state, decisions: [], readiness: idleReadiness(state) };
  }

  if (event.type === 'ORDERBOOK') {
    return {
      nextState: {
        ...state,
        lastOrderbook: event.orderbook
      },
      decisions: [],
      readiness: stratCReadiness(state)
    };
  }

  if (event.type === 'TRADE_TICK' || event.type === 'TICKER') {
    return evaluateStratCPrice(state, event.type === 'TRADE_TICK' ? event.tick.tsMs : event.tick.tsMs, event.type === 'TRADE_TICK' ? event.tick.price : event.tick.price, context.config);
  }

  if (event.timeframe !== '1m') {
    return {
      nextState: state,
      decisions: [],
      readiness: stratCReadiness(state)
    };
  }

  if (event.type === 'CANDLE_OPEN') {
    return evaluateStratCOpen(state, event.candle, context.config);
  }

  return evaluateStratCClose(state, event.candle, context.config);
}

function evaluateStratCClose(
  state: MomentumState,
  candle: StrategyCandle,
  config: MomentumConfig
): StrategyModuleResult {
  const stratC = config.stratC;
  if (!stratC) {
    return { nextState: state, decisions: [], readiness: idleReadiness(state) };
  }

  const recentCandles = [...state.recentCandles, candle].slice(-400);
  const stage = state.stratC?.stage ?? 'IDLE';
  const nowTs = candle.time;
  const paused = typeof state.stratC?.pausedUntil === 'number' && state.stratC.pausedUntil > nowTs;
  const cooldown = typeof state.stratC?.cooldownUntil === 'number' && state.stratC.cooldownUntil > nowTs;
  const lastTradeValue = candle.tradeValue ?? 0;
  const lastBuyValue = candle.buyValue ?? 0;
  const lastBuyRatio = typeof candle.buyRatio === 'number'
    ? candle.buyRatio
    : (lastTradeValue > 0 ? lastBuyValue / lastTradeValue : 0);
  const lastBodyRatio = Math.max(0, bodyRatio(candle));
  const breakoutRange = recentCandles.slice(0, -1).slice(-stratC.breakoutLookbackCandles);
  const prevHigh = breakoutRange.length > 0 ? Math.max(...breakoutRange.map((item) => item.high)) : undefined;
  const valueSeries = recentCandles.slice(0, -1).slice(-stratC.valueSpikeLookbackCandles)
    .map((item) => item.tradeValue ?? 0)
    .filter((value) => value > 0);
  const avgTradeValue = valueSeries.length > 0
    ? valueSeries.reduce((acc, value) => acc + value, 0) / valueSeries.length
    : 0;
  const valueSpike = avgTradeValue > 0 && lastTradeValue >= avgTradeValue * stratC.valueSpikeMult;
  const breakout = typeof prevHigh === 'number' && candle.close > prevHigh;
  const allowedHour = stratC.allowedHoursKst.includes(toKstHour(candle.time));

  const nextStateBase: MomentumState = {
    ...state,
    recentCandles,
    lastPrice: candle.close,
    stratC: {
      ...(state.stratC ?? { stage: 'IDLE', consecutiveStops: 0 }),
      stage: paused ? 'PAUSED' : cooldown ? 'COOLDOWN' : stage,
      lastTradeValue,
      lastBuyValue,
      lastBuyRatio,
      lastBodyRatio,
      ...(typeof prevHigh === 'number' ? { lastBreakoutLevel: prevHigh } : {})
    }
  };

  if (state.inPosition) {
    return {
      nextState: {
        ...nextStateBase,
        position: state.position
          ? {
            ...state.position,
            barsHeld: state.position.barsHeld + 1
          }
          : state.position,
        barsHeld: state.barsHeld + 1
      },
      decisions: [],
      readiness: {
        entryReadinessPct: 100,
        entryReady: false,
        reason: state.stratC?.stage ?? 'IN_POSITION',
        inPosition: true
      }
    };
  }

  if (paused || cooldown || !allowedHour) {
    return {
      nextState: nextStateBase,
      decisions: [],
      readiness: {
        entryReadinessPct: 0,
        entryReady: false,
        reason: paused ? 'PAUSED' : cooldown ? 'COOLDOWN' : 'ENTRY_WAIT',
        inPosition: false
      }
    };
  }

  const signalReady = breakout && valueSpike && lastBuyRatio >= stratC.buyRatioMin && lastBodyRatio >= stratC.bodyRatioMin;
  if (!signalReady) {
    return {
      nextState: nextStateBase,
      decisions: [],
      readiness: computeStratCReadiness({
        breakout,
        valueSpike,
        buyRatio: lastBuyRatio,
        bodyRatio: lastBodyRatio,
        buyRatioMin: stratC.buyRatioMin,
        bodyRatioMin: stratC.bodyRatioMin
      })
    };
  }

  return {
    nextState: {
      ...nextStateBase,
      stratC: {
        ...(nextStateBase.stratC ?? { stage: 'IDLE', consecutiveStops: 0 }),
        stage: 'ENTRY_PENDING',
        pendingEntryAt: candle.time + ONE_MINUTE_SEC
      }
    },
    decisions: [
      {
        eventType: 'SIGNAL_EMIT',
        payload: {
          signal: 'ENTRY_PENDING',
          reason: 'C_BREAKOUT_VALUE_SPIKE',
          breakoutLevel: prevHigh,
          tradeValue: round(lastTradeValue, 2),
          buyRatio: round(lastBuyRatio),
          bodyRatio: round(lastBodyRatio)
        }
      }
    ],
    readiness: {
      entryReadinessPct: 100,
      entryReady: true,
      reason: 'C_BREAKOUT_VALUE_SPIKE',
      inPosition: false
    }
  };
}

function evaluateStratCOpen(
  state: MomentumState,
  candle: StrategyCandle,
  config: MomentumConfig
): StrategyModuleResult {
  const stratC = config.stratC;
  if (!stratC) {
    return { nextState: state, decisions: [], readiness: idleReadiness(state) };
  }

  const stage = state.stratC?.stage ?? 'IDLE';
  if (stage !== 'ENTRY_PENDING' || state.stratC?.pendingEntryAt !== candle.time) {
    return {
      nextState: state,
      decisions: [],
      readiness: stratCReadiness(state)
    };
  }

  const entryPrice = candle.open;
  return {
    nextState: {
      ...state,
      inPosition: true,
      entryPrice,
      entryTime: candle.time,
      barsHeld: 0,
      stratC: {
        ...(state.stratC ?? { stage: 'IDLE', consecutiveStops: 0 }),
        stage: 'IN_POSITION',
        pendingEntryAt: undefined,
        tp1Done: false,
        tp1Price: entryPrice * (1 + stratC.tp1Pct),
        tp2Price: entryPrice * (1 + stratC.tp2Pct),
        stopPrice: entryPrice * (1 - stratC.slPct)
      }
    },
    decisions: buildLongEntrySequence({
      price: entryPrice,
      fillPrice: entryPrice,
      orderReason: 'C_NEXT_MINUTE_OPEN',
      signalPayload: {
        signal: 'LONG_ENTRY',
        reason: 'C_NEXT_MINUTE_OPEN'
      }
    }),
    readiness: {
      entryReadinessPct: 100,
      entryReady: true,
      reason: 'C_NEXT_MINUTE_OPEN',
      inPosition: false
    }
  };
}

function evaluateStratCPrice(
  state: MomentumState,
  nowTsMs: number,
  price: number,
  config: MomentumConfig
): StrategyModuleResult {
  const stratC = config.stratC;
  const position = state.position;
  if (!stratC || !position || !state.inPosition) {
    return {
      nextState: {
        ...state,
        lastPrice: price
      },
      decisions: [],
      readiness: stratCReadiness(state)
    };
  }

  const stage = state.stratC?.stage ?? 'IN_POSITION';
  const cooldownMinutes = stratC.cooldownMinutes ?? 2;
  const cooldownAfterStopMinutes = stratC.cooldownAfterStopMinutes ?? 5;
  const pauseMinutes = stratC.pauseMinutes ?? 20;
  const pauseAfterStops = stratC.pauseAfterConsecutiveStops ?? 2;
  const stopPrice = state.stratC?.stopPrice ?? position.avgEntryPrice * (1 - stratC.slPct);
  const tp1Price = state.stratC?.tp1Price ?? position.avgEntryPrice * (1 + stratC.tp1Pct);
  const tp2Price = state.stratC?.tp2Price ?? position.avgEntryPrice * (1 + stratC.tp2Pct);
  const timedOut = nowTsMs >= (position.entryTime * 1000) + (stratC.timeStopMinutes * 60_000);

  if (price <= stopPrice) {
    const consecutiveStops = (state.stratC?.consecutiveStops ?? 0) + 1;
    const pausedUntil = consecutiveStops >= pauseAfterStops ? Math.floor((nowTsMs + (pauseMinutes * 60_000)) / 1000) : undefined;
    return buildStratCExit(state, price, position.qty, 'SL', {
      nextStage: pausedUntil ? 'PAUSED' : 'COOLDOWN',
      cooldownUntil: pausedUntil ? undefined : Math.floor((nowTsMs + (cooldownAfterStopMinutes * 60_000)) / 1000),
      pausedUntil,
      consecutiveStops
    });
  }

  if (!state.stratC?.tp1Done && price >= tp1Price) {
    const tp1Ratio = stratC.tp1Ratio ?? 0.7;
    const exitQty = round(position.qty * tp1Ratio, 8);
    const remainingQty = round(Math.max(0, position.qty - exitQty), 8);
    return {
      nextState: {
        ...state,
        lastPrice: price,
        positionQty: remainingQty,
        position: {
          ...position,
          qty: remainingQty,
          partialExitQty: exitQty
        },
        stratC: {
          ...(state.stratC ?? { stage: 'IN_POSITION', consecutiveStops: 0 }),
          stage: 'IN_POSITION',
          tp1Done: true
        }
      },
      decisions: buildExitSequence({
        price,
        qty: exitQty,
        orderReason: 'EXIT_TP1',
        exitPayload: {
          reason: 'TP1',
          pnlPct: round(pctChange(price, position.avgEntryPrice)),
          barsHeld: position.barsHeld
        },
        positionPayload: {
          side: 'LONG',
          qty: remainingQty,
          avgEntry: position.avgEntryPrice,
          realizedPnlPct: round(pctChange(price, position.avgEntryPrice))
        }
      }),
      readiness: {
        entryReadinessPct: 100,
        entryReady: false,
        reason: 'IN_POSITION',
        inPosition: true
      }
    };
  }

  if ((state.stratC?.tp1Done ?? false) && price >= tp2Price) {
    return buildStratCExit(state, price, position.qty, 'TP2', {
      nextStage: 'COOLDOWN',
      cooldownUntil: Math.floor((nowTsMs + (cooldownMinutes * 60_000)) / 1000),
      consecutiveStops: 0
    });
  }

  if (timedOut) {
    return buildStratCExit(state, price, position.qty, 'TIME', {
      nextStage: 'COOLDOWN',
      cooldownUntil: Math.floor((nowTsMs + (cooldownMinutes * 60_000)) / 1000),
      consecutiveStops: 0
    });
  }

  return {
    nextState: {
      ...state,
      lastPrice: price,
      stratC: {
        ...(state.stratC ?? { stage: 'IN_POSITION', consecutiveStops: 0 }),
        stage
      }
    },
    decisions: [],
    readiness: {
      entryReadinessPct: 100,
      entryReady: false,
      reason: stage,
      inPosition: true
    }
  };
}

function buildStratCExit(
  state: MomentumState,
  price: number,
  qty: number,
  reason: 'TP2' | 'SL' | 'TIME',
  input: Readonly<{
    nextStage: 'COOLDOWN' | 'PAUSED';
    cooldownUntil?: number | undefined;
    pausedUntil?: number | undefined;
    consecutiveStops: number;
  }>
): StrategyModuleResult {
  const position = state.position;
  if (!position) {
    return {
      nextState: state,
      decisions: [],
      readiness: idleReadiness(state)
    };
  }

  return {
    nextState: {
      ...state,
      inPosition: false,
      entryPrice: undefined,
      entryTime: undefined,
      positionQty: undefined,
      position: undefined,
      barsHeld: 0,
      lastPrice: price,
      stratC: {
        ...(state.stratC ?? { stage: 'IDLE', consecutiveStops: 0 }),
        stage: input.nextStage,
        cooldownUntil: input.cooldownUntil,
        pausedUntil: input.pausedUntil,
        consecutiveStops: input.consecutiveStops,
        tp1Done: false
      }
    },
    decisions: buildExitSequence({
      price,
      qty,
      orderReason: `EXIT_${reason}`,
      exitPayload: {
        reason,
        pnlPct: round(pctChange(price, position.avgEntryPrice)),
        barsHeld: position.barsHeld
      }
    }),
    readiness: {
      entryReadinessPct: 0,
      entryReady: false,
      reason: input.nextStage,
      inPosition: false
    }
  };
}

function computeStratCReadiness(input: Readonly<{
  breakout: boolean;
  valueSpike: boolean;
  buyRatio: number;
  bodyRatio: number;
  buyRatioMin: number;
  bodyRatioMin: number;
}>): StrategyEntryReadiness {
  const breakoutScore = input.breakout ? 35 : 0;
  const valueScore = input.valueSpike ? 25 : 0;
  const buyScore = Math.min(20, Math.max(0, (input.buyRatio / Math.max(input.buyRatioMin, 1e-9)) * 20));
  const bodyScore = Math.min(20, Math.max(0, (input.bodyRatio / Math.max(input.bodyRatioMin, 1e-9)) * 20));
  return {
    entryReadinessPct: Math.min(99, Math.round(breakoutScore + valueScore + buyScore + bodyScore)),
    entryReady: false,
    reason: 'ENTRY_WAIT',
    inPosition: false
  };
}

function idleReadiness(state: MomentumState): StrategyEntryReadiness {
  return {
    entryReadinessPct: 0,
    entryReady: false,
    reason: 'ENTRY_WAIT',
    inPosition: state.inPosition
  };
}

function stratCReadiness(state: MomentumState): StrategyEntryReadiness {
  if (state.inPosition) {
    return {
      entryReadinessPct: 100,
      entryReady: false,
      reason: state.stratC?.stage ?? 'IN_POSITION',
      inPosition: true
    };
  }
  return idleReadiness(state);
}
