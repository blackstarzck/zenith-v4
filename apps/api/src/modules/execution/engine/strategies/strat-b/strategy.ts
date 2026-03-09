import { buildExitSequence, buildLongEntrySequence } from '../../execution-sequence';
import type { MomentumConfig, MomentumState } from '../../simple-momentum.strategy';
import { adx, atr, bodyRatio, pctChange, round } from '../../shared/indicators';
import type { StrategyCandle, StrategyMarketEvent } from '../../shared/market-types';
import type { StrategyModule, StrategyModuleContext, StrategyModuleResult } from '../../shared/strategy-module';
import type { StrategyEntryReadiness } from '../../shared/strategy-readiness';

export const stratBModule: StrategyModule = {
  strategyId: 'STRAT_B',
  evaluate: (state, event, context) => evaluateStratB(state, event, context)
};

function evaluateStratB(
  state: MomentumState,
  event: StrategyMarketEvent,
  context: StrategyModuleContext
): StrategyModuleResult {
  const stratB = context.config.stratB;
  if (!stratB) {
    return { nextState: state, decisions: [], readiness: flatReadiness(state) };
  }

  if (event.type === 'ORDERBOOK') {
    return {
      nextState: {
        ...state,
        lastOrderbook: event.orderbook
      },
      decisions: [],
      readiness: stratBReadiness(state)
    };
  }

  if (event.type === 'TRADE_TICK' || event.type === 'TICKER') {
    return evaluateStratBPrice(state, event.tick.price);
  }

  if (event.type === 'CANDLE_CLOSE' && event.timeframe === '1h') {
    return evaluateStratBOneHourClose(state, event.candle, context.config);
  }

  if (event.type === 'CANDLE_CLOSE' && event.timeframe === '15m') {
    return evaluateStratBFifteenMinuteClose(state, event.candle, context.config);
  }

  return {
    nextState: state,
    decisions: [],
    readiness: stratBReadiness(state)
  };
}

function evaluateStratBOneHourClose(
  state: MomentumState,
  candle: StrategyCandle,
  config: MomentumConfig
): StrategyModuleResult {
  const stratB = config.stratB;
  if (!stratB) {
    return { nextState: state, decisions: [], readiness: flatReadiness(state) };
  }

  const candles1h = [...(state.candles1h ?? []), candle].slice(-200);
  const bullMode = resolveBullMode(candles1h, stratB);

  if (state.inPosition && !bullMode) {
    const position = state.position;
    if (!position) {
      return {
        nextState: {
          ...state,
          candles1h,
          stratB: {
            ...(state.stratB ?? { stage: 'FLAT', bullMode }),
            bullMode
          }
        },
        decisions: [],
        readiness: stratBReadiness(state)
      };
    }

    return {
      nextState: {
        ...state,
        candles1h,
        inPosition: false,
        entryPrice: undefined,
        entryTime: undefined,
        positionQty: undefined,
        position: undefined,
        barsHeld: 0,
        stratB: {
          ...(state.stratB ?? { stage: 'IN_POSITION', bullMode }),
          stage: 'FLAT',
          bullMode,
          activeZone: undefined,
          stopPrice: undefined,
          targetPrice: undefined
        }
      },
      decisions: buildExitSequence({
        price: candle.close,
        qty: position.qty,
        orderReason: 'EXIT_BULL_OFF',
        exitPayload: {
          reason: 'BULL_OFF',
          pnlPct: round(pctChange(candle.close, position.avgEntryPrice)),
          barsHeld: position.barsHeld
        }
      }),
      readiness: flatReadiness(state)
    };
  }

  return {
    nextState: {
      ...state,
      candles1h,
      stratB: {
        ...(state.stratB ?? { stage: 'FLAT', bullMode }),
        bullMode
      }
    },
    decisions: [],
    readiness: bullMode ? computeBullModeReadiness(state) : flatReadiness(state)
  };
}

function evaluateStratBFifteenMinuteClose(
  state: MomentumState,
  candle: StrategyCandle,
  config: MomentumConfig
): StrategyModuleResult {
  const stratB = config.stratB;
  if (!stratB) {
    return { nextState: state, decisions: [], readiness: flatReadiness(state) };
  }

  const candles15m = [...(state.candles15m ?? []), candle].slice(-200);
  const stage = state.stratB?.stage ?? 'FLAT';
  let activeZone = state.stratB?.activeZone;
  if (activeZone && candle.time > activeZone.expiresAt) {
    activeZone = undefined;
  }

  if (state.inPosition && state.position) {
    const nextBarsHeld = state.position.barsHeld + 1;
    if (nextBarsHeld >= (stratB.timeExitBars ?? 24)) {
      return {
        nextState: {
          ...state,
          candles15m,
          inPosition: false,
          entryPrice: undefined,
          entryTime: undefined,
          positionQty: undefined,
          position: undefined,
          barsHeld: 0,
          stratB: {
            ...(state.stratB ?? { stage: 'IN_POSITION', bullMode: true }),
            stage: 'FLAT',
            activeZone
          }
        },
        decisions: buildExitSequence({
          price: candle.close,
          qty: state.position.qty,
          orderReason: 'EXIT_TIME',
          exitPayload: {
            reason: 'TIME',
            pnlPct: round(pctChange(candle.close, state.position.avgEntryPrice)),
            barsHeld: nextBarsHeld
          }
        }),
        readiness: flatReadiness(state)
      };
    }

    return {
      nextState: {
        ...state,
        candles15m,
        position: {
          ...state.position,
          barsHeld: nextBarsHeld
        },
        barsHeld: nextBarsHeld,
        stratB: {
          ...(state.stratB ?? { stage: 'IN_POSITION', bullMode: true }),
          stage,
          activeZone
        }
      },
      decisions: [],
      readiness: {
        entryReadinessPct: 100,
        entryReady: false,
        reason: 'IN_POSITION',
        inPosition: true
      }
    };
  }

  if (!(state.stratB?.bullMode ?? false)) {
    return {
      nextState: {
        ...state,
        candles15m,
        stratB: {
          ...(state.stratB ?? { stage: 'WAIT_POI', bullMode: false }),
          stage: 'WAIT_POI',
          bullMode: false,
          activeZone: undefined
        }
      },
      decisions: [],
      readiness: flatReadiness(state)
    };
  }

  const detectedZone = detectBullishZone(candles15m, stratB);
  if (detectedZone) {
    activeZone = detectedZone;
  }

  const touched = activeZone
    ? candle.low <= activeZone.zoneHigh && candle.high >= activeZone.zoneLow
    : false;
  const confirmed = touched && candle.close > candle.open;

  if (!confirmed || !activeZone) {
    return {
      nextState: {
        ...state,
        candles15m,
        stratB: {
          ...(state.stratB ?? { stage: 'WAIT_POI', bullMode: true }),
          stage: activeZone ? 'WAIT_CONFIRM' : 'WAIT_POI',
          bullMode: true,
          activeZone
        }
      },
      decisions: [],
      readiness: computeStratBReadiness(candle, activeZone)
    };
  }

  return {
    nextState: {
      ...state,
      candles15m,
      inPosition: true,
      entryPrice: candle.close,
      entryTime: candle.time,
      barsHeld: 0,
      stratB: {
        ...(state.stratB ?? { stage: 'FLAT', bullMode: true }),
        stage: 'IN_POSITION',
        bullMode: true,
        activeZone,
        stopPrice: activeZone.obLow * (1 - stratB.slBuffer),
        targetPrice: activeZone.targetPrice
      }
    },
    decisions: buildLongEntrySequence({
      price: candle.close,
      fillPrice: candle.close,
      orderReason: 'B_POI_TOUCH_CONFIRM',
      signalPayload: {
        signal: 'LONG_ENTRY',
        reason: 'B_POI_TOUCH_CONFIRM',
        zoneLow: activeZone.zoneLow,
        zoneHigh: activeZone.zoneHigh,
        targetPrice: activeZone.targetPrice
      }
    }),
    readiness: {
      entryReadinessPct: 100,
      entryReady: true,
      reason: 'B_POI_TOUCH_CONFIRM',
      inPosition: false
    }
  };
}

function evaluateStratBPrice(state: MomentumState, price: number): StrategyModuleResult {
  const position = state.position;
  if (!state.inPosition || !position) {
    return {
      nextState: {
        ...state,
        lastPrice: price
      },
      decisions: [],
      readiness: stratBReadiness(state)
    };
  }

  const stopPrice = state.stratB?.stopPrice;
  const targetPrice = state.stratB?.targetPrice;
  if (typeof stopPrice === 'number' && price <= stopPrice) {
    return buildStratBExit(state, price, 'SL');
  }

  if (typeof targetPrice === 'number' && price >= targetPrice) {
    return buildStratBExit(state, price, 'TP');
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
      reason: 'IN_POSITION',
      inPosition: true
    }
  };
}

function buildStratBExit(
  state: MomentumState,
  price: number,
  reason: 'SL' | 'TP'
): StrategyModuleResult {
  const position = state.position;
  if (!position) {
    return {
      nextState: state,
      decisions: [],
      readiness: flatReadiness(state)
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
      stratB: {
        ...(state.stratB ?? { stage: 'IN_POSITION', bullMode: true }),
        stage: 'FLAT',
        stopPrice: undefined,
        targetPrice: undefined
      }
    },
    decisions: buildExitSequence({
      price,
      qty: position.qty,
      orderReason: `EXIT_${reason}`,
      exitPayload: {
        reason,
        pnlPct: round(pctChange(price, position.avgEntryPrice)),
        barsHeld: position.barsHeld
      }
    }),
    readiness: flatReadiness(state)
  };
}

function resolveBullMode(
  candles1h: readonly StrategyCandle[],
  stratB: NonNullable<MomentumConfig['stratB']>
): boolean {
  const lookback = stratB.bullModeLookback ?? 5;
  const segment = candles1h.slice(-lookback);
  if (segment.length < 3) {
    return false;
  }

  const first = segment[0];
  const last = segment[segment.length - 1];
  if (!first || !last) {
    return false;
  }

  const slope = (last.close - first.close) / Math.max(1, segment.length - 1);
  const closesAboveMid = segment.filter((candle) => candle.close >= ((candle.high + candle.low) / 2)).length;
  const minCloses = stratB.bullModeMinClosesAboveTrend ?? Math.ceil(segment.length * 0.6);
  const trendStrength = adx(segment, Math.min(3, Math.max(2, segment.length - 1))) ?? 0;
  return slope > 0 && closesAboveMid >= minCloses && trendStrength >= 15;
}

function detectBullishZone(
  candles15m: readonly StrategyCandle[],
  stratB: NonNullable<MomentumConfig['stratB']>
): NonNullable<MomentumState['stratB']>['activeZone'] | undefined {
  if (candles15m.length < 3) {
    return undefined;
  }

  const latest = candles15m[candles15m.length - 1];
  const prev = candles15m[candles15m.length - 2];
  const older = candles15m[candles15m.length - 3];
  if (!latest || !prev || !older) {
    return undefined;
  }

  const atrValue = atr(candles15m, stratB.atrPeriod) ?? 0;
  const impulseRange = prev.high - prev.low;
  const impulse = prev.close > prev.open
    && bodyRatio(prev) >= stratB.impulseBodyRatioMin
    && impulseRange >= atrValue * stratB.impulseMult;
  const fvgMinGapPct = stratB.fvgMinGapPct ?? 0.001;
  const bullishFvg = latest.low > older.high * (1 + fvgMinGapPct);
  if (!impulse && !bullishFvg) {
    return undefined;
  }

  const lookbackSegment = candles15m.slice(Math.max(0, candles15m.length - 1 - stratB.obLookback), candles15m.length - 1);
  const obLow = Math.min(...lookbackSegment.map((item) => item.low));
  const obHigh = prev.high;
  const zoneLow = bullishFvg ? older.high : obLow;
  const zoneHigh = bullishFvg ? latest.low : obHigh;
  const rr = stratB.tpRrFallback;
  const risk = Math.max(0.0000001, prev.close - (obLow * (1 - stratB.slBuffer)));
  const targetFromRisk = prev.close + (risk * rr);
  const targetFromHigh = Math.max(...candles15m.slice(-stratB.obLookback).map((item) => item.high));
  const trendLine = resolveTrendLine(candles15m.slice(-(stratB.trendlineLookback ?? 6)));

  return {
    zoneLow,
    zoneHigh,
    obLow,
    obHigh,
    targetPrice: Math.max(targetFromRisk, targetFromHigh),
    createdAt: latest.time,
    expiresAt: latest.time + (stratB.poiValidBars * 15 * 60),
    sourceTime: prev.time,
    trendLineSlope: trendLine.slope,
    trendLineBase: trendLine.base,
    bullModeAtCreation: true
  };
}

function resolveTrendLine(candles: readonly StrategyCandle[]): Readonly<{ slope: number; base: number }> {
  if (candles.length < 2) {
    return { slope: 0, base: candles[0]?.low ?? 0 };
  }

  const first = candles[0];
  const last = candles[candles.length - 1];
  if (!first || !last) {
    return { slope: 0, base: 0 };
  }

  return {
    slope: (last.low - first.low) / Math.max(1, candles.length - 1),
    base: first.low
  };
}

function computeStratBReadiness(
  candle: StrategyCandle,
  zone: NonNullable<MomentumState['stratB']>['activeZone'] | undefined
): StrategyEntryReadiness {
  if (!zone) {
    return {
      entryReadinessPct: 0,
      entryReady: false,
      reason: 'ENTRY_WAIT',
      inPosition: false
    };
  }

  const touched = candle.low <= zone.zoneHigh && candle.high >= zone.zoneLow;
  if (touched) {
    return {
      entryReadinessPct: candle.close > candle.open ? 100 : 85,
      entryReady: false,
      reason: 'B_WAIT_CONFIRM',
      inPosition: false
    };
  }

  const nearest = candle.close > zone.zoneHigh ? zone.zoneHigh : zone.zoneLow;
  const distPct = nearest > 0 ? Math.abs(candle.close - nearest) / nearest : 1;
  const distScore = Math.max(0, Math.min(1, 1 - distPct * 40)) * 70;
  return {
    entryReadinessPct: Math.round(Math.min(99, distScore + 20)),
    entryReady: false,
    reason: 'ENTRY_WAIT',
    inPosition: false
  };
}

function computeBullModeReadiness(state: MomentumState): StrategyEntryReadiness {
  return {
    entryReadinessPct: 40,
    entryReady: false,
    reason: state.stratB?.activeZone ? 'B_WAIT_CONFIRM' : 'B_WAIT_POI',
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

function stratBReadiness(state: MomentumState): StrategyEntryReadiness {
  if (state.inPosition) {
    return {
      entryReadinessPct: 100,
      entryReady: false,
      reason: 'IN_POSITION',
      inPosition: true
    };
  }
  return flatReadiness(state);
}
