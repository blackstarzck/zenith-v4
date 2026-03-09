import type { MomentumConfig, MomentumState } from '../simple-momentum.strategy';
import type { StrategyId } from '../strategy-config';
import type { StrategyMarketEvent } from '../shared/market-types';
import type { StrategyModuleContext, StrategyModuleResult } from '../shared/strategy-module';
import { stratAModule } from './strat-a/strategy';
import { stratBModule } from './strat-b/strategy';
import { stratCModule } from './strat-c/strategy';

const STRATEGY_MODULES = {
  STRAT_A: stratAModule,
  STRAT_B: stratBModule,
  STRAT_C: stratCModule
} as const;

export function evaluateStrategyEvent(
  strategyId: StrategyId,
  state: MomentumState,
  event: StrategyMarketEvent,
  config: MomentumConfig
): StrategyModuleResult {
  const module = STRATEGY_MODULES[strategyId];
  const context: StrategyModuleContext = {
    strategyId,
    config
  };
  return module.evaluate(state, event, context);
}
