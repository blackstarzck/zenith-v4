export type RiskState = Readonly<{
  dayKey: string;
  dailyOrders: number;
  consecutiveLosses: number;
  dailyPnlPct: number;
}>;

export type RiskConfig = Readonly<{
  dailyLossLimitPct: number;
  maxConsecutiveLosses: number;
  maxDailyOrders: number;
  killSwitchEnabled: boolean;
}>;

export function initialRiskState(nowTsMs: number): RiskState {
  return {
    dayKey: dayKey(nowTsMs),
    dailyOrders: 0,
    consecutiveLosses: 0,
    dailyPnlPct: 0
  };
}

export function evaluateEntryBlock(
  state: RiskState,
  config: RiskConfig,
  mode: 'PAPER' | 'SEMI_AUTO' | 'AUTO' | 'LIVE',
  allowLiveTrading: boolean,
  tsMs: number
): Readonly<{ nextState: RiskState; reason?: string }> {
  const rolled = rollRiskDay(state, tsMs);

  if (mode === 'LIVE' && !allowLiveTrading) {
    return { nextState: rolled, reason: 'LIVE_GUARD_BLOCKED' };
  }
  if (!config.killSwitchEnabled) {
    return { nextState: rolled };
  }
  if (rolled.dailyPnlPct <= config.dailyLossLimitPct) {
    return { nextState: rolled, reason: 'DAILY_LOSS_LIMIT' };
  }
  if (rolled.consecutiveLosses >= config.maxConsecutiveLosses) {
    return { nextState: rolled, reason: 'MAX_CONSECUTIVE_LOSSES' };
  }
  if (rolled.dailyOrders >= config.maxDailyOrders) {
    return { nextState: rolled, reason: 'MAX_DAILY_ORDERS' };
  }
  return { nextState: rolled };
}

export function onEntryAccepted(state: RiskState, tsMs: number): RiskState {
  const rolled = rollRiskDay(state, tsMs);
  return {
    ...rolled,
    dailyOrders: rolled.dailyOrders + 1
  };
}

export function onExitPnl(state: RiskState, pnlPct: number, tsMs: number): RiskState {
  const rolled = rollRiskDay(state, tsMs);
  return {
    ...rolled,
    dailyPnlPct: Number((rolled.dailyPnlPct + pnlPct).toFixed(4)),
    consecutiveLosses: pnlPct < 0 ? rolled.consecutiveLosses + 1 : 0
  };
}

function rollRiskDay(state: RiskState, tsMs: number): RiskState {
  const nextDay = dayKey(tsMs);
  if (nextDay === state.dayKey) {
    return state;
  }
  return {
    dayKey: nextDay,
    dailyOrders: 0,
    consecutiveLosses: 0,
    dailyPnlPct: 0
  };
}

function dayKey(tsMs: number): string {
  return new Date(tsMs).toISOString().slice(0, 10);
}
