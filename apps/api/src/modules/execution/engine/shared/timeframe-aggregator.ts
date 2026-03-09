import type { StrategyCandle, TimeframeKey } from './market-types';

export type AggregatedCandleState = Readonly<{
  timeframe: TimeframeKey;
  bucketSizeMinutes: number;
  bucketStartSec: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  tradeValue: number;
  buyValue: number;
}>;

export type AggregationUpdateResult = Readonly<{
  nextState: AggregatedCandleState;
  current: StrategyCandle;
  closed?: StrategyCandle;
}>;

export function updateAggregatedCandle(
  prevState: AggregatedCandleState | undefined,
  sourceCandle: StrategyCandle,
  timeframe: TimeframeKey
): AggregationUpdateResult {
  const bucketSizeMinutes = timeframeToMinutes(timeframe);
  const bucketStartSec = Math.floor(sourceCandle.time / (bucketSizeMinutes * 60)) * bucketSizeMinutes * 60;
  let closed: StrategyCandle | undefined;
  let nextState: AggregatedCandleState;

  if (!prevState || prevState.bucketStartSec !== bucketStartSec) {
    if (prevState) {
      closed = toStrategyCandle(prevState);
    }
    nextState = {
      timeframe,
      bucketSizeMinutes,
      bucketStartSec,
      open: sourceCandle.open,
      high: sourceCandle.high,
      low: sourceCandle.low,
      close: sourceCandle.close,
      volume: sourceCandle.volume ?? 0,
      tradeValue: sourceCandle.tradeValue ?? 0,
      buyValue: sourceCandle.buyValue ?? 0
    };
  } else {
    nextState = {
      ...prevState,
      high: Math.max(prevState.high, sourceCandle.high),
      low: Math.min(prevState.low, sourceCandle.low),
      close: sourceCandle.close,
      volume: prevState.volume + (sourceCandle.volume ?? 0),
      tradeValue: prevState.tradeValue + (sourceCandle.tradeValue ?? 0),
      buyValue: prevState.buyValue + (sourceCandle.buyValue ?? 0)
    };
  }

  return {
    nextState,
    current: toStrategyCandle(nextState),
    ...(closed ? { closed } : {})
  };
}

export function timeframeToMinutes(timeframe: TimeframeKey): number {
  if (timeframe === '15m') {
    return 15;
  }
  if (timeframe === '1h') {
    return 60;
  }
  return 1;
}

export function shouldEmitOpenForTimeframe(timeframe: TimeframeKey, candleTimeSec: number): boolean {
  const minutes = timeframeToMinutes(timeframe);
  return Math.floor(candleTimeSec / 60) % minutes === 0;
}

function toStrategyCandle(state: AggregatedCandleState): StrategyCandle {
  const tradeValue = state.tradeValue > 0 ? state.tradeValue : undefined;
  const buyValue = state.buyValue > 0 ? state.buyValue : undefined;
  const buyRatio = typeof tradeValue === 'number' && tradeValue > 0
    ? ((buyValue ?? 0) / tradeValue)
    : undefined;

  return {
    time: state.bucketStartSec,
    open: state.open,
    high: state.high,
    low: state.low,
    close: state.close,
    volume: state.volume,
    ...(typeof tradeValue === 'number' ? { tradeValue } : {}),
    ...(typeof buyValue === 'number' ? { buyValue } : {}),
    ...(typeof buyRatio === 'number' ? { buyRatio } : {})
  };
}
