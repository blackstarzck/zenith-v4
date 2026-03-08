import type { UpbitMinuteCandleDto } from '../upbit.market.client';

export type RuntimeCandle = Readonly<{
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}>;

export type CandleState = Readonly<{
  bucketMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
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
  tradeVolume: number
): CandleUpdateResult {
  const bucketMs = Math.floor(tradeTsMs / 60_000) * 60_000;
  let closed: RuntimeCandle | undefined;
  let nextState: CandleState;

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
      volume: tradeVolume
    };
  } else {
    nextState = {
      bucketMs,
      open: prevState.open,
      high: Math.max(prevState.high, price),
      low: Math.min(prevState.low, price),
      close: price,
      volume: prevState.volume + tradeVolume
    };
  }

  return {
    nextState,
    current: toRuntimeCandle(nextState),
    ...(closed ? { closed } : {})
  };
}

export function toRuntimeCandle(state: CandleState): RuntimeCandle {
  return {
    time: Math.floor(state.bucketMs / 1000),
    open: state.open,
    high: state.high,
    low: state.low,
    close: state.close,
    volume: state.volume
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
    volume: candle.candle_acc_trade_volume ?? 0
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
