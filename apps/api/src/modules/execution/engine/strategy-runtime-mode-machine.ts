import type {
  StrategyRuntimeLifecycleState,
  StrategyRuntimeMode
} from './strategy-runtime-state';

export type StrategyRuntimeModeAction =
  | 'NOOP'
  | 'EMIT_AWAITING_APPROVAL'
  | 'REQUEST_SEMI_AUTO_APPROVAL'
  | 'EXECUTE_APPROVED_ENTRY'
  | 'PROCESS_DIRECT_ENTRY';

export type StrategyRuntimeModeTrigger =
  | Readonly<{
      type: 'APPROVAL_TICK';
      approvalConsumed: boolean;
    }>
  | Readonly<{
      type: 'FORCE_SEMI_AUTO_SIGNAL';
    }>
  | Readonly<{
      type: 'STRATEGY_ENTRY_SIGNAL';
    }>
  | Readonly<{
      type: 'ENTRY_INTENT_READY';
    }>;

export type StrategyRuntimeModeTransition = Readonly<{
  action: StrategyRuntimeModeAction;
  nextState: StrategyRuntimeLifecycleState;
  reason: string;
}>;

export function transitionStrategyRuntimeMode(input: Readonly<{
  mode: StrategyRuntimeMode;
  currentState: StrategyRuntimeLifecycleState;
  trigger: StrategyRuntimeModeTrigger;
}>): StrategyRuntimeModeTransition {
  const { mode, currentState, trigger } = input;

  if (trigger.type === 'APPROVAL_TICK') {
    if (mode === 'SEMI_AUTO' && currentState === 'WAITING_APPROVAL') {
      if (trigger.approvalConsumed) {
        return {
          action: 'EXECUTE_APPROVED_ENTRY',
          nextState: 'IN_POSITION',
          reason: 'APPROVAL_CONSUMED'
        };
      }
      return {
        action: 'EMIT_AWAITING_APPROVAL',
        nextState: 'WAITING_APPROVAL',
        reason: 'AWAITING_APPROVAL'
      };
    }
    return noopTransition(currentState, 'APPROVAL_TICK_IGNORED');
  }

  if (trigger.type === 'FORCE_SEMI_AUTO_SIGNAL') {
    if (mode === 'SEMI_AUTO' && currentState === 'FLAT') {
      return {
        action: 'REQUEST_SEMI_AUTO_APPROVAL',
        nextState: 'WAITING_APPROVAL',
        reason: 'FORCED_APPROVAL_REQUEST'
      };
    }
    return noopTransition(currentState, 'FORCE_SIGNAL_IGNORED');
  }

  if (trigger.type === 'STRATEGY_ENTRY_SIGNAL') {
    if (mode === 'SEMI_AUTO' && currentState === 'FLAT') {
      return {
        action: 'REQUEST_SEMI_AUTO_APPROVAL',
        nextState: 'WAITING_APPROVAL',
        reason: 'ENTRY_SIGNAL_REQUIRES_APPROVAL'
      };
    }
    return noopTransition(currentState, 'ENTRY_SIGNAL_FALLTHROUGH');
  }

  if (trigger.type === 'ENTRY_INTENT_READY') {
    if (currentState !== 'FLAT') {
      return noopTransition(currentState, 'ENTRY_INTENT_IGNORED');
    }
    if (mode === 'PAPER' || mode === 'AUTO' || mode === 'LIVE') {
      return {
        action: 'PROCESS_DIRECT_ENTRY',
        nextState: 'IN_POSITION',
        reason: `${mode}_DIRECT_ENTRY`
      };
    }
    return noopTransition(currentState, 'ENTRY_INTENT_WAITS_FOR_APPROVAL');
  }

  return noopTransition(currentState, 'UNKNOWN_TRIGGER');
}

function noopTransition(
  currentState: StrategyRuntimeLifecycleState,
  reason: string
): StrategyRuntimeModeTransition {
  return {
    action: 'NOOP',
    nextState: currentState,
    reason
  };
}
