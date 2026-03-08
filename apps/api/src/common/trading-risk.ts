type RuntimeRiskSnapshotInput = Readonly<{
  strategyId: string;
}>;

export type RuntimeRiskSnapshot = Readonly<{
  seedKrw: number;
  maxPositionRatio: number;
  dailyLossLimitPct: number;
  maxConsecutiveLosses: number;
  maxDailyOrders: number;
  killSwitch: boolean;
}>;

export type EntryOrderSizing = Readonly<{
  qty: number;
  notionalKrw: number;
}>;

const DEFAULT_SEED_KRW = 1_000_000;
const DEFAULT_MAX_POSITION_RATIO = 0.2;
const DEFAULT_DAILY_LOSS_LIMIT_PCT = -2;
const DEFAULT_MAX_CONSECUTIVE_LOSSES = 3;
const DEFAULT_MAX_DAILY_ORDERS = 200;
const ENTRY_QTY_PRECISION = 8;

export function resolveRuntimeRiskSnapshot(input: RuntimeRiskSnapshotInput): RuntimeRiskSnapshot {
  return {
    seedKrw: resolveSeedCapitalKrw(input.strategyId),
    maxPositionRatio: clamp(
      resolveNumber(
        [
          process.env.RISK_MAX_POSITION_RATIO,
          process.env.MAX_POSITION_RATIO,
          process.env.VITE_MAX_POSITION_RATIO
        ],
        DEFAULT_MAX_POSITION_RATIO
      ),
      0,
      1
    ),
    dailyLossLimitPct: resolveNumber(
      [process.env.RISK_DAILY_LOSS_LIMIT_PCT],
      DEFAULT_DAILY_LOSS_LIMIT_PCT
    ),
    maxConsecutiveLosses: resolveInteger(
      [process.env.RISK_MAX_CONSECUTIVE_LOSSES],
      DEFAULT_MAX_CONSECUTIVE_LOSSES
    ),
    maxDailyOrders: resolveInteger(
      [process.env.RISK_MAX_DAILY_ORDERS],
      DEFAULT_MAX_DAILY_ORDERS
    ),
    killSwitch: process.env.RISK_KILL_SWITCH !== 'false'
  };
}

export function resolveSeedCapitalKrw(strategyId: string): number {
  const strategyKey = strategyId.toUpperCase();
  return resolveNumber(
    [
      process.env[`${strategyKey}_SEED_CAPITAL_KRW`],
      process.env[`SEED_CAPITAL_${strategyKey}_KRW`],
      process.env.SEED_CAPITAL_KRW,
      process.env.VITE_SEED_CAPITAL_KRW
    ],
    DEFAULT_SEED_KRW,
    (value) => value > 0
  );
}

export function computeEntryOrderSizing(input: Readonly<{
  accountBaseKrw: number;
  maxPositionRatio: number;
  price: number;
}>): EntryOrderSizing | undefined {
  const price = input.price;
  const accountBaseKrw = input.accountBaseKrw;
  const maxPositionRatio = clamp(input.maxPositionRatio, 0, 1);
  if (!Number.isFinite(price) || price <= 0) {
    return undefined;
  }
  if (!Number.isFinite(accountBaseKrw) || accountBaseKrw <= 0) {
    return undefined;
  }
  if (maxPositionRatio <= 0) {
    return undefined;
  }

  const targetNotionalKrw = accountBaseKrw * maxPositionRatio;
  const qty = floorTo(targetNotionalKrw / price, ENTRY_QTY_PRECISION);
  if (!Number.isFinite(qty) || qty <= 0) {
    return undefined;
  }

  return {
    qty,
    notionalKrw: roundMoney(qty * price)
  };
}

function resolveNumber(
  candidates: ReadonlyArray<string | undefined>,
  fallback: number,
  validate?: (value: number) => boolean
): number {
  for (const candidate of candidates) {
    const value = Number(candidate);
    if (!Number.isFinite(value)) {
      continue;
    }
    if (validate && !validate(value)) {
      continue;
    }
    return value;
  }
  return fallback;
}

function resolveInteger(candidates: ReadonlyArray<string | undefined>, fallback: number): number {
  return Math.max(0, Math.trunc(resolveNumber(candidates, fallback)));
}

function floorTo(value: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.floor((value * factor) + 1e-9) / factor;
}

function roundMoney(value: number): number {
  return Number(value.toFixed(2));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
