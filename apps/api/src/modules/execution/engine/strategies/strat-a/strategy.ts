import { buildExitSequence, buildLongEntrySequence, type StrategyEventDecision } from '../../execution-sequence';
import type { MomentumConfig, MomentumState } from '../../simple-momentum.strategy';
import {
  adx,
  atr,
  bollinger,
  pctChange,
  round,
  rsi,
  toKstHour
} from '../../shared/indicators';
import type { StrategyCandle, StrategyMarketEvent } from '../../shared/market-types';
import type { StrategyModule, StrategyModuleContext, StrategyModuleResult } from '../../shared/strategy-module';
import type { StrategyEntryReadiness } from '../../shared/strategy-readiness';

const FIFTEEN_MINUTES_SEC = 15 * 60;

export const stratAModule: StrategyModule = {
  strategyId: 'STRAT_A',
  evaluate: (state, event, context) => evaluateStratA(state, event, context)
};

function evaluateStratA(
  state: MomentumState,
  event: StrategyMarketEvent,
  context: StrategyModuleContext
): StrategyModuleResult {
  const stratA = context.config.stratA;
  if (!stratA) {
    return { nextState: state, decisions: [], readiness: flatReadiness(state) };
  }

  if (event.type === 'TRADE_TICK' || event.type === 'TICKER') {
    return evaluateStratAPriceTick(state, event.tick.price, context);
  }

  if (event.type === 'ORDERBOOK') {
    return {
      nextState: {
        ...state,
        lastOrderbook: event.orderbook
      },
      decisions: [],
      readiness: stratAReadiness(state)
    };
  }

  if (event.timeframe !== '15m') {
    return {
      nextState: state,
      decisions: [],
      readiness: stratAReadiness(state)
    };
  }

  if (event.type === 'CANDLE_OPEN') {
    return evaluateStratAOpen(state, event.candle, context.config);
  }

  return evaluateStratAClose(state, event.candle, context.config);
}

function evaluateStratAClose(
  state: MomentumState,
  candle: StrategyCandle,
  config: MomentumConfig
): StrategyModuleResult {
  const stratA = config.stratA;
  if (!stratA) {
    return { nextState: state, decisions: [], readiness: flatReadiness(state) };
  }

  const candles15m = [...(state.candles15m ?? []), candle].slice(-200);
  const nextStateBase: MomentumState = {
    ...state,
    candles15m
  };
  const stage = state.stratA?.stage ?? 'FLAT';

  if (stage === 'WAIT_CONFIRM') {
    const bullish = candle.close > candle.open;
    if (!bullish) {
      return {
        nextState: {
          ...nextStateBase,
          stratA: { stage: 'FLAT' }
        },
        decisions: [],
        readiness: flatReadiness(state)
      };
    }

    if (stratA.entryAfterConfirmFill === 'ON_CLOSE') {
      return buildStratAEntry(nextStateBase, candle, config, candle.close, 'A_CONFIRM_ON_CLOSE');
    }

    return {
      nextState: {
        ...nextStateBase,
        stratA: {
          ...(state.stratA ?? { stage: 'WAIT_CONFIRM' }),
          stage: 'WAIT_ENTRY',
          confirmCandleTime: candle.time,
          pendingEntryAt: candle.time + FIFTEEN_MINUTES_SEC
        }
      },
      decisions: [
        {
          eventType: 'SIGNAL_EMIT',
          payload: {
            signal: 'WAIT_ENTRY',
            reason: 'A_CONFIRM_WAIT_NEXT_OPEN',
            confirmCandleTime: candle.time
          }
        }
      ],
      readiness: {
        entryReadinessPct: 100,
        entryReady: true,
        reason: 'A_CONFIRM_WAIT_NEXT_OPEN',
        inPosition: false
      }
    };
  }

  if (stage === 'IN_POSITION' || stage === 'IN_TRAIL') {
    return evaluateStratAInPositionClose(nextStateBase, candle, config);
  }

  const closes = candles15m.map((item) => item.close);
  const bands = bollinger(closes, stratA.bbPeriod, stratA.bbStd);
  const adxValue = adx(candles15m, stratA.adxPeriod);
  const rsiNow = rsi(closes, stratA.rsiPeriod);
  const lookbackCloses = closes.slice(0, -stratA.rsiSlopeLookback);
  const rsiPast = rsi(lookbackCloses, stratA.rsiPeriod);
  const excludedHour = stratA.excludeEntryHoursKst.includes(toKstHour(candle.time + FIFTEEN_MINUTES_SEC));
  if (!bands || typeof adxValue !== 'number' || typeof rsiNow !== 'number' || typeof rsiPast !== 'number' || excludedHour) {
    return {
      nextState: {
        ...nextStateBase,
        stratA: { stage: 'FLAT' }
      },
      decisions: [],
      readiness: flatReadiness(state)
    };
  }

  const rsiSlope = rsiNow - rsiPast;
  const trigger = candle.low < bands.lower && candle.close > bands.lower;
  const filtersOk = adxValue <= stratA.maxAdx && rsiSlope >= stratA.rsiSlopeMin;
  if (!trigger || !filtersOk) {
    return {
      nextState: {
        ...nextStateBase,
        stratA: { stage: 'FLAT' }
      },
      decisions: [],
      readiness: computeStratAWaitingReadiness(candle.close, bands.lower, adxValue, rsiSlope, stratA)
    };
  }

  return {
    nextState: {
      ...nextStateBase,
      stratA: {
        stage: 'WAIT_CONFIRM',
        triggerCandleTime: candle.time
      }
    },
    decisions: [
      {
        eventType: 'SIGNAL_EMIT',
        payload: {
          signal: 'WAIT_CONFIRM',
          reason: 'A_BB_RECLAIM',
          adx: round(adxValue),
          rsi: round(rsiNow),
          rsiSlope: round(rsiSlope)
        }
      }
    ],
    readiness: {
      entryReadinessPct: 85,
      entryReady: false,
      reason: 'A_WAIT_CONFIRM',
      inPosition: false
    }
  };
}

function evaluateStratAOpen(
  state: MomentumState,
  candle: StrategyCandle,
  config: MomentumConfig
): StrategyModuleResult {
  const stratA = config.stratA;
  if (!stratA) {
    return { nextState: state, decisions: [], readiness: flatReadiness(state) };
  }

  const stage = state.stratA?.stage ?? 'FLAT';
  if (stage === 'WAIT_ENTRY' && state.stratA?.pendingEntryAt === candle.time) {
    return buildStratAEntry(state, candle, config, candle.open, 'A_CONFIRM_NEXT_OPEN');
  }

  const pendingExit = state.stratA?.pendingExit;
  if ((stage === 'IN_POSITION' || stage === 'IN_TRAIL') && pendingExit && pendingExit.executeAt === candle.time) {
    return executePendingStratAExit(state, candle, pendingExit);
  }

  return {
    nextState: state,
    decisions: [],
    readiness: stratAReadiness(state)
  };
}

function evaluateStratAPriceTick(
  state: MomentumState,
  price: number,
  context: StrategyModuleContext
): StrategyModuleResult {
  const stratA = context.config.stratA;
  const position = state.position;
  const stage = state.stratA?.stage ?? 'FLAT';
  if (!stratA || !position || !(stage === 'IN_POSITION' || stage === 'IN_TRAIL')) {
    return {
      nextState: {
        ...state,
        lastPrice: price
      },
      decisions: [],
      readiness: stratAReadiness(state)
    };
  }

  const stopPrice = state.stratA?.trailingStop ?? state.stratA?.stopPrice;
  if (typeof stopPrice === 'number' && price <= stopPrice) {
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
        stratA: { stage: 'FLAT' }
      },
      decisions: buildExitSequence({
        price,
        qty: position.qty,
        orderReason: 'EXIT_STOP_OR_TRAIL',
        exitPayload: {
          reason: 'STOP_OR_TRAIL',
          pnlPct: round(pctChange(price, position.avgEntryPrice)),
          barsHeld: position.barsHeld
        }
      }),
      readiness: flatReadiness(state)
    };
  }

  const tpPrice = position.avgEntryPrice * (1 + stratA.tpPct);
  if (!state.stratA?.partialDone && price >= tpPrice) {
    if (stratA.partialExitFillTiming === 'INTRABAR_APPROX') {
      const sellQty = round(position.qty * stratA.partialRatio, 8);
      const remainingQty = round(Math.max(0, position.qty - sellQty), 8);
      return {
        nextState: {
          ...state,
          lastPrice: price,
          positionQty: remainingQty,
          position: {
            ...position,
            qty: remainingQty,
            partialExitQty: sellQty
          },
          stratA: {
            ...(state.stratA ?? { stage: 'IN_POSITION' }),
            stage: 'IN_TRAIL',
            partialDone: true,
            trailingStop: price - (stratA.trailAtrMult * (state.stratA?.atrAtEntry ?? 0))
          }
        },
        decisions: buildExitSequence({
          price,
          qty: sellQty,
          orderReason: 'EXIT_TP_PARTIAL',
          exitPayload: {
            reason: 'TP_PARTIAL',
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
          reason: 'IN_TRAIL',
          inPosition: true
        }
      };
    }

    return {
      nextState: {
        ...state,
        lastPrice: price,
        stratA: {
          ...(state.stratA ?? { stage: 'IN_POSITION' }),
          pendingExit: {
            reason: 'TP_PARTIAL',
            executeAt: next15mOpen(position.entryTime, price, state.candles15m),
            qtyRatio: stratA.partialRatio
          }
        }
      },
      decisions: [],
      readiness: {
        entryReadinessPct: 100,
        entryReady: false,
        reason: 'A_PENDING_PARTIAL_EXIT',
        inPosition: true
      }
    };
  }

  return {
    nextState: {
      ...state,
      lastPrice: price
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

function evaluateStratAInPositionClose(
  state: MomentumState,
  candle: StrategyCandle,
  config: MomentumConfig
): StrategyModuleResult {
  const stratA = config.stratA;
  const position = state.position;
  if (!stratA || !position) {
    return {
      nextState: {
        ...state,
        stratA: { stage: 'FLAT' }
      },
      decisions: [],
      readiness: flatReadiness(state)
    };
  }

  const candles15m = state.candles15m ?? [];
  const atrValue = atr(candles15m, stratA.atrPeriod) ?? state.stratA?.atrAtEntry ?? 0;
  const nextBarsHeld = position.barsHeld + 1;
  const nextStratA = {
    ...(state.stratA ?? { stage: 'IN_POSITION' as const }),
    ...(state.stratA?.partialDone
      ? { trailingStop: Math.max(state.stratA?.trailingStop ?? Number.NEGATIVE_INFINITY, candle.close - (stratA.trailAtrMult * atrValue)) }
      : {}),
    stage: state.stratA?.partialDone ? 'IN_TRAIL' as const : 'IN_POSITION' as const
  };

  if (nextBarsHeld >= stratA.timeExitMaxHoldBars) {
    return {
      nextState: {
        ...state,
        position: {
          ...position,
          barsHeld: nextBarsHeld
        },
        barsHeld: nextBarsHeld,
        stratA: {
          ...nextStratA,
          pendingExit: {
            reason: 'TIME_EXIT',
            executeAt: candle.time + FIFTEEN_MINUTES_SEC,
            qtyRatio: 1
          }
        }
      },
      decisions: [],
      readiness: {
        entryReadinessPct: 100,
        entryReady: false,
        reason: 'A_PENDING_TIME_EXIT',
        inPosition: true
      }
    };
  }

  return {
    nextState: {
      ...state,
      position: {
        ...position,
        barsHeld: nextBarsHeld
      },
      barsHeld: nextBarsHeld,
      stratA: nextStratA
    },
    decisions: [],
    readiness: {
      entryReadinessPct: 100,
      entryReady: false,
      reason: nextStratA.stage,
      inPosition: true
    }
  };
}

function buildStratAEntry(
  state: MomentumState,
  candle: StrategyCandle,
  config: MomentumConfig,
  entryPrice: number,
  reason: string
): StrategyModuleResult {
  const stratA = config.stratA;
  if (!stratA) {
    return { nextState: state, decisions: [], readiness: flatReadiness(state) };
  }

  const candles15m = state.candles15m ?? [];
  const atrValue = atr(candles15m, stratA.atrPeriod) ?? 0;
  const adxValue = adx(candles15m, stratA.adxPeriod) ?? 0;
  const regime = adxValue < 20 ? 'RANGING' : adxValue < stratA.maxAdx ? 'TRENDING' : 'VOLATILE';
  const stopMult = regime === 'RANGING'
    ? stratA.stopMultRanging
    : regime === 'TRENDING'
      ? stratA.stopMultTrending
      : stratA.stopMultVolatile;
  const stopPrice = entryPrice - (stopMult * atrValue);

  return {
    nextState: {
      ...state,
      inPosition: true,
      entryPrice,
      entryTime: candle.time,
      barsHeld: 0,
      stratA: {
        stage: 'IN_POSITION',
        confirmCandleTime: candle.time,
        stopPrice,
        trailingStop: undefined,
        regime,
        partialDone: false,
        atrAtEntry: atrValue
      }
    },
    decisions: buildLongEntrySequence({
      price: entryPrice,
      fillPrice: entryPrice,
      orderReason: reason,
      signalPayload: {
        signal: 'LONG_ENTRY',
        reason,
        timeframe: '15m'
      }
    }),
    readiness: {
      entryReadinessPct: 100,
      entryReady: true,
      reason,
      inPosition: false
    }
  };
}

function executePendingStratAExit(
  state: MomentumState,
  candle: StrategyCandle,
  pendingExit: NonNullable<NonNullable<MomentumState['stratA']>['pendingExit']>
): StrategyModuleResult {
  const position = state.position;
  if (!position) {
    return {
      nextState: {
        ...state,
        stratA: { stage: 'FLAT' }
      },
      decisions: [],
      readiness: flatReadiness(state)
    };
  }

  const exitQty = round(position.qty * pendingExit.qtyRatio, 8);
  const remainingQty = round(Math.max(0, position.qty - exitQty), 8);
  const isFlat = remainingQty <= 0;
  return {
    nextState: {
      ...state,
      inPosition: !isFlat,
      entryPrice: isFlat ? undefined : state.entryPrice,
      entryTime: isFlat ? undefined : state.entryTime,
      positionQty: isFlat ? undefined : remainingQty,
      position: isFlat
        ? undefined
        : {
          ...position,
          qty: remainingQty,
          partialExitQty: exitQty
        },
      barsHeld: isFlat ? 0 : state.barsHeld,
      stratA: isFlat
        ? { stage: 'FLAT' }
        : {
          ...(state.stratA ?? { stage: 'IN_POSITION' }),
          stage: pendingExit.reason === 'TP_PARTIAL' ? 'IN_TRAIL' : 'IN_POSITION',
          partialDone: pendingExit.reason === 'TP_PARTIAL' ? true : state.stratA?.partialDone,
          pendingExit: undefined
        }
    },
    decisions: buildExitSequence({
      price: candle.open,
      qty: exitQty,
      orderReason: `EXIT_${pendingExit.reason}`,
      exitPayload: {
        reason: pendingExit.reason,
        pnlPct: round(pctChange(candle.open, position.avgEntryPrice)),
        barsHeld: position.barsHeld
      },
      positionPayload: isFlat
        ? {
          side: 'FLAT',
          qty: 0,
          realizedPnlPct: round(pctChange(candle.open, position.avgEntryPrice))
        }
        : {
          side: 'LONG',
          qty: remainingQty,
          avgEntry: position.avgEntryPrice,
          realizedPnlPct: round(pctChange(candle.open, position.avgEntryPrice))
        }
    }),
    readiness: isFlat
      ? flatReadiness(state)
      : {
        entryReadinessPct: 100,
        entryReady: false,
        reason: 'IN_TRAIL',
        inPosition: true
      }
  };
}

function computeStratAWaitingReadiness(
  close: number,
  lowerBand: number,
  adxValue: number,
  rsiSlope: number,
  stratA: NonNullable<MomentumConfig['stratA']>
): StrategyEntryReadiness {
  const lowerDistPct = lowerBand > 0 ? Math.abs(close - lowerBand) / lowerBand : 1;
  const adxScore = Math.max(0, Math.min(1, (stratA.maxAdx - adxValue) / Math.max(1, stratA.maxAdx))) * 30;
  const slopeScore = Math.max(0, Math.min(1, (rsiSlope - stratA.rsiSlopeMin + 2) / 4)) * 40;
  const distScore = Math.max(0, Math.min(1, 1 - lowerDistPct * 50)) * 30;
  return {
    entryReadinessPct: Math.round(Math.min(99, adxScore + slopeScore + distScore)),
    entryReady: false,
    reason: 'ENTRY_WAIT',
    inPosition: false
  };
}

function flatReadiness(state: MomentumState): StrategyEntryReadiness {
  return {
    entryReadinessPct: 0,
    entryReady: false,
    reason: 'ENTRY_WAIT',
    inPosition: state.inPosition
  };
}

function stratAReadiness(state: MomentumState): StrategyEntryReadiness {
  if (state.inPosition) {
    return {
      entryReadinessPct: 100,
      entryReady: false,
      reason: state.stratA?.stage ?? 'IN_POSITION',
      inPosition: true
    };
  }
  return flatReadiness(state);
}

function next15mOpen(
  _entryTime: number,
  _price: number,
  candles15m: readonly StrategyCandle[] | undefined
): number {
  const latest = candles15m?.[candles15m.length - 1];
  return (latest?.time ?? 0) + FIFTEEN_MINUTES_SEC;
}
