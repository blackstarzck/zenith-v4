import type { UpbitMinuteCandleDto } from '../upbit.market.client';

export type RuntimeCandle = Readonly<{
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  tradeValue?: number | undefined;
  buyValue?: number | undefined;
  buyRatio?: number | undefined;
  bestBidPrice?: number | undefined;
  bestAskPrice?: number | undefined;
}>;

export type CandleState = Readonly<{
  bucketMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  tradeValue: number;
  buyValue: number;
  bestBidPrice?: number | undefined;
  bestAskPrice?: number | undefined;
}>;

export type CandleUpdateResult = Readonly<{
  nextState: CandleState;
  current: RuntimeCandle;
  closed?: RuntimeCandle;
}>;

export function updateOneMinuteCandle(
  prevState: CandleState | undefined,
  tradeTsMs: number,
  price: number,
  tradeVolume: number,
  askBid?: string,
  bestBidPrice?: number,
  bestAskPrice?: number
): CandleUpdateResult {
  const bucketMs = Math.floor(tradeTsMs / 60_000) * 60_000;
  let closed: RuntimeCandle | undefined;
  let nextState: CandleState;
  const tradeValue = price * tradeVolume;
  const buyValue = askBid === 'BID' ? tradeValue : 0;

  if (!prevState || prevState.bucketMs !== bucketMs) {
    if (prevState) {
      closed = toRuntimeCandle(prevState);
    }
    nextState = {
      bucketMs,
      open: price,
      high: price,
      low: price,
      close: price,
      volume: tradeVolume,
      tradeValue,
      buyValue,
      ...(typeof bestBidPrice === 'number' ? { bestBidPrice } : {}),
      ...(typeof bestAskPrice === 'number' ? { bestAskPrice } : {})
    };
  } else {
    nextState = {
      bucketMs,
      open: prevState.open,
      high: Math.max(prevState.high, price),
      low: Math.min(prevState.low, price),
      close: price,
      volume: prevState.volume + tradeVolume,
      tradeValue: prevState.tradeValue + tradeValue,
      buyValue: prevState.buyValue + buyValue,
      ...(typeof bestBidPrice === 'number' ? { bestBidPrice } : (typeof prevState.bestBidPrice === 'number' ? { bestBidPrice: prevState.bestBidPrice } : {})),
      ...(typeof bestAskPrice === 'number' ? { bestAskPrice } : (typeof prevState.bestAskPrice === 'number' ? { bestAskPrice: prevState.bestAskPrice } : {}))
    };
  }

  return {
    nextState,
    current: toRuntimeCandle(nextState),
    ...(closed ? { closed } : {})
  };
}

export function toRuntimeCandle(state: CandleState): RuntimeCandle {
  const buyRatio = state.tradeValue > 0 ? state.buyValue / state.tradeValue : undefined;
  return {
    time: Math.floor(state.bucketMs / 1000),
    open: state.open,
    high: state.high,
    low: state.low,
    close: state.close,
    volume: state.volume,
    ...(state.tradeValue > 0 ? { tradeValue: state.tradeValue } : {}),
    ...(state.buyValue > 0 ? { buyValue: state.buyValue } : {}),
    ...(typeof buyRatio === 'number' ? { buyRatio } : {}),
    ...(typeof state.bestBidPrice === 'number' ? { bestBidPrice: state.bestBidPrice } : {}),
    ...(typeof state.bestAskPrice === 'number' ? { bestAskPrice: state.bestAskPrice } : {})
  };
}

export function resolveSnapshotBucketMs(candle: UpbitMinuteCandleDto): number {
  const parsedUtc = Date.parse(`${candle.candle_date_time_utc}Z`);
  if (Number.isFinite(parsedUtc)) {
    return parsedUtc;
  }
  return Math.floor(candle.timestamp / 60_000) * 60_000;
}

export function snapshotToCandleState(candle: UpbitMinuteCandleDto): CandleState {
  return {
    bucketMs: resolveSnapshotBucketMs(candle),
    open: candle.opening_price,
    high: candle.high_price,
    low: candle.low_price,
    close: candle.trade_price,
    volume: candle.candle_acc_trade_volume ?? 0,
    tradeValue: 0,
    buyValue: 0
  };
}

export function isStaleClosedCandle(
  closedTimeSec: number,
  tradeTsMs: number,
  maxLagMs: number
): boolean {
  const lagMs = tradeTsMs - closedTimeSec * 1000;
  return lagMs > maxLagMs;
}
