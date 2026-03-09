import type { StrategyCandle, StrategyMarketEvent, TimeframeKey } from './shared/market-types';
import type { StrategyEntryReadiness } from './shared/strategy-readiness';
import type { StrategyEventDecision } from './execution-sequence';
import { evaluateStrategyEvent } from './strategies';
import type { StrategyId } from './strategy-config';
import type { MomentumConfig, MomentumState } from './simple-momentum.strategy';

export type StrategyEvaluateResult = Readonly<{
  nextState: MomentumState;
  decisions: readonly StrategyEventDecision[];
}>;

export type { StrategyEntryReadiness } from './shared/strategy-readiness';

export type StrategyEvaluationDetailed = Readonly<{
  result: StrategyEvaluateResult;
  readiness: StrategyEntryReadiness;
}>;

export function evaluateStrategyCandle(
  strategyId: StrategyId,
  state: MomentumState,
  candle: StrategyCandle,
  config: MomentumConfig
): StrategyEvaluateResult {
  return evaluateStrategyCandleDetailed(strategyId, state, candle, config).result;
}

export function evaluateStrategyCandleDetailed(
  strategyId: StrategyId,
  state: MomentumState,
  candle: StrategyCandle,
  config: MomentumConfig,
  timeframe: TimeframeKey = resolveDefaultTimeframe(strategyId)
): StrategyEvaluationDetailed {
  return evaluateStrategyEventDetailed(strategyId, state, {
    type: 'CANDLE_CLOSE',
    timeframe,
    candle
  }, config);
}

export function evaluateStrategyEventDetailed(
  strategyId: StrategyId,
  state: MomentumState,
  event: StrategyMarketEvent,
  config: MomentumConfig
): StrategyEvaluationDetailed {
  const result = evaluateStrategyEvent(strategyId, state, event, config);
  const readiness = result.readiness ?? defaultReadiness(result.nextState);
  return {
    result: {
      nextState: result.nextState,
      decisions: result.decisions
    },
    readiness
  };
}

export function evaluateStrategyEntryReadiness(
  strategyId: StrategyId,
  state: MomentumState,
  candle: StrategyCandle,
  config: MomentumConfig,
  timeframe: TimeframeKey = resolveDefaultTimeframe(strategyId)
): StrategyEntryReadiness {
  return evaluateStrategyCandleDetailed(strategyId, state, candle, config, timeframe).readiness;
}

function resolveDefaultTimeframe(strategyId: StrategyId): TimeframeKey {
  if (strategyId === 'STRAT_A' || strategyId === 'STRAT_B') {
    return '15m';
  }
  return '1m';
}

function defaultReadiness(state: MomentumState): StrategyEntryReadiness {
  return {
    entryReadinessPct: state.inPosition ? 100 : 0,
    entryReady: false,
    reason: state.inPosition ? 'IN_POSITION' : 'ENTRY_WAIT',
    inPosition: state.inPosition
  };
}
