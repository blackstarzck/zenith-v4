import type { StrategyEventDecision } from '../execution-sequence';
import type { MomentumConfig, MomentumState } from '../simple-momentum.strategy';
import type { StrategyId } from '../strategy-config';
import type { RealtimePriceTick, StrategyMarketEvent } from './market-types';
import type { StrategyEntryReadiness } from './strategy-readiness';

export type StrategyModuleResult = Readonly<{
  nextState: MomentumState;
  decisions: readonly StrategyEventDecision[];
  readiness?: StrategyEntryReadiness;
}>;

export type StrategyModuleContext = Readonly<{
  strategyId: StrategyId;
  config: MomentumConfig;
  tick?: RealtimePriceTick;
}>;

export type StrategyModule = Readonly<{
  strategyId: StrategyId;
  evaluate: (
    state: MomentumState,
    event: StrategyMarketEvent,
    context: StrategyModuleContext
  ) => StrategyModuleResult;
}>;
