import { resolveRuntimeRiskSnapshot, type RuntimeRiskSnapshot } from '../../../common/trading-risk';
import type { RiskState } from './risk-guard';
import { initialRiskState } from './risk-guard';
import {
  INITIAL_MOMENTUM_STATE,
  type MomentumState
} from './simple-momentum.strategy';
import { resolveStrategyConfig, type StrategyId } from './strategy-config';

export type StrategyRuntimeMode = 'PAPER' | 'SEMI_AUTO' | 'AUTO' | 'LIVE';
export type StrategyRuntimeLifecycleState = 'FLAT' | 'WAITING_APPROVAL' | 'IN_POSITION';

export type PendingSemiAutoEntry = Readonly<{
  signalTime: number;
  suggestedPrice: number;
}>;

type ResolvedStrategyConfig = ReturnType<typeof resolveStrategyConfig>;

export type StrategyRuntimeState = {
  strategyId: StrategyId;
  runId: string;
  strategyName: string;
  momentum: ResolvedStrategyConfig['momentum'];
  riskSnapshot: RuntimeRiskSnapshot;
  strategyState: MomentumState;
  lifecycleState: StrategyRuntimeLifecycleState;
  pendingSemiAutoEntry?: PendingSemiAutoEntry;
  riskState: RiskState;
  seq: number;
};

export const STRATEGY_IDS: readonly StrategyId[] = ['STRAT_A', 'STRAT_B', 'STRAT_C'];

export function strategyRunId(strategyId: StrategyId): string {
  if (strategyId === 'STRAT_A') {
    return 'run-strat-a-0001';
  }
  if (strategyId === 'STRAT_B') {
    return 'run-strat-b-0001';
  }
  return 'run-strat-c-0001';
}

export function createStrategyRuntimeState(
  strategyId: StrategyId,
  strategyVersion: string,
  nowTsMs = Date.now()
): StrategyRuntimeState {
  const strategy = resolveStrategyConfig(strategyId);
  return {
    strategyId,
    runId: strategyRunId(strategyId),
    strategyName: strategy.strategyName,
    momentum: strategy.momentum,
    riskSnapshot: resolveRuntimeRiskSnapshot({ strategyId }),
    strategyState: INITIAL_MOMENTUM_STATE,
    lifecycleState: 'FLAT',
    riskState: initialRiskState(nowTsMs),
    seq: 0
  };
}

export function deriveStrategyRuntimeLifecycleState(
  mode: StrategyRuntimeMode,
  runtime: Readonly<Pick<StrategyRuntimeState, 'strategyState' | 'pendingSemiAutoEntry'>>
): StrategyRuntimeLifecycleState {
  if (runtime.strategyState.inPosition) {
    return 'IN_POSITION';
  }
  if (mode === 'SEMI_AUTO' && runtime.pendingSemiAutoEntry) {
    return 'WAITING_APPROVAL';
  }
  return 'FLAT';
}

export function syncStrategyRuntimeLifecycleState(
  runtime: StrategyRuntimeState,
  mode: StrategyRuntimeMode
): StrategyRuntimeLifecycleState {
  runtime.lifecycleState = deriveStrategyRuntimeLifecycleState(mode, runtime);
  return runtime.lifecycleState;
}
