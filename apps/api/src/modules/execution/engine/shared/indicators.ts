import type { StrategyCandle } from './market-types';

export function average(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((acc, value) => acc + value, 0) / values.length;
}

export function bollinger(
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

export function atr(candles: readonly StrategyCandle[], period: number): number | undefined {
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

    tr.push(Math.max(
      curr.high - curr.low,
      Math.abs(curr.high - prev.close),
      Math.abs(curr.low - prev.close)
    ));
  }

  return tr.length > 0 ? average(tr) : undefined;
}

export function adx(candles: readonly StrategyCandle[], period: number): number | undefined {
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

export function rsi(closes: readonly number[], period: number): number | undefined {
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

export function pctChange(current: number, base: number): number {
  if (base === 0) {
    return 0;
  }
  return ((current - base) / base) * 100;
}

export function bodyRatio(candle: StrategyCandle): number {
  const range = Math.max(1e-9, candle.high - candle.low);
  return Math.abs(candle.close - candle.open) / range;
}

export function directionalBodyRatio(candle: StrategyCandle): number {
  const range = Math.max(1e-9, candle.high - candle.low);
  return (candle.close - candle.open) / range;
}

export function toKstHour(epochSec: number): number {
  const kstMs = epochSec * 1000 + (9 * 60 * 60 * 1000);
  return new Date(kstMs).getUTCHours();
}

export function round(value: number, digits = 4): number {
  return Number(value.toFixed(digits));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
