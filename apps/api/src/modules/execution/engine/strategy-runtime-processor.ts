import {
  buildExitSequence,
  buildLongEntrySequence,
  buildSemiAutoApprovalSequence,
  type StrategyEventDecision
} from './execution-sequence';
import { computeEntryOrderSizing } from '../../../common/trading-risk';
import { evaluateEntryBlock, onEntryAccepted, onExitPnl, type RiskConfig } from './risk-guard';
import type { RuntimeCandle } from './realtime-candle-state';
import { transitionStrategyRuntimeMode } from './strategy-runtime-mode-machine';
import { evaluateStrategyCandleDetailed } from './strategy-evaluator';
import type { MomentumState } from './simple-momentum.strategy';
import type {
  StrategyRuntimeMode,
  StrategyRuntimeState
} from './strategy-runtime-state';
import { syncStrategyRuntimeLifecycleState } from './strategy-runtime-state';

type StrategyRuntimeEventPayload = Readonly<Record<string, unknown>>;

export type StrategyRuntimeEventEmitter = (
  runtime: StrategyRuntimeState,
  eventType: string,
  eventTsMs: number,
  candle: RuntimeCandle,
  payload: StrategyRuntimeEventPayload
) => Promise<void>;

export type StrategyRuntimeProcessorOptions = Readonly<{
  mode: StrategyRuntimeMode;
  allowLiveTrading: boolean;
  e2eForceSemiAutoSignal: boolean;
  riskConfig: RiskConfig;
  consumeApproval: (runId: string) => boolean;
  resolveAccountBaseKrw: (runtime: StrategyRuntimeState) => Promise<number>;
  emitStrategyEvent: StrategyRuntimeEventEmitter;
}>;

type EntryReadinessPayload = Readonly<{
  entryReadinessPct: number;
  entryReady: boolean;
  entryExecutable: boolean;
  reason: string;
  inPosition: boolean;
}>;

export class StrategyRuntimeProcessor {
  constructor(private readonly options: StrategyRuntimeProcessorOptions) {}

  async processClosedCandle(
    runtime: StrategyRuntimeState,
    candle: RuntimeCandle,
    eventTsMs: number
  ): Promise<void> {
    syncStrategyRuntimeLifecycleState(runtime, this.options.mode);

    if (runtime.lifecycleState === 'WAITING_APPROVAL') {
      const approvalTransition = transitionStrategyRuntimeMode({
        mode: this.options.mode,
        currentState: runtime.lifecycleState,
        trigger: {
          type: 'APPROVAL_TICK',
          approvalConsumed: this.options.consumeApproval(runtime.runId)
        }
      });
      if (approvalTransition.action === 'EMIT_AWAITING_APPROVAL') {
        await this.emitEntryReadiness(runtime, eventTsMs, candle, {
          entryReadinessPct: 100,
          entryReady: true,
          entryExecutable: false,
          reason: approvalTransition.reason,
          inPosition: false
        });
        return;
      }
      if (approvalTransition.action === 'EXECUTE_APPROVED_ENTRY') {
        await this.emitSemiAutoApprovedEntry(runtime, candle, eventTsMs);
        syncStrategyRuntimeLifecycleState(runtime, this.options.mode);
      }
      await this.emitEntryReadiness(runtime, eventTsMs, candle, {
        entryReadinessPct: 100,
        entryReady: false,
        entryExecutable: false,
        reason: this.readinessReasonForLifecycle(runtime),
        inPosition: runtime.strategyState.inPosition
      });
      return;
    }

    if (!runtime.strategyState.inPosition && this.options.e2eForceSemiAutoSignal) {
      const forceTransition = transitionStrategyRuntimeMode({
        mode: this.options.mode,
        currentState: runtime.lifecycleState,
        trigger: {
          type: 'FORCE_SEMI_AUTO_SIGNAL'
        }
      });
      if (forceTransition.action === 'REQUEST_SEMI_AUTO_APPROVAL') {
        await this.requestSemiAutoApproval(runtime, candle, eventTsMs, {
          suggestedPrice: candle.close,
          signalPayload: {
            signal: 'LONG_ENTRY',
            reason: 'E2E_FORCE_SEMI_AUTO_SIGNAL'
          }
        });
        return;
      }
    }

    const detailed = evaluateStrategyCandleDetailed(runtime.strategyId, runtime.strategyState, candle, runtime.momentum);
    const result = detailed.result;
    const isEntrySignal = result.decisions.some((decision) => decision.eventType === 'SIGNAL_EMIT');
    const readiness = detailed.readiness;
    let entryExecutable = false;
    let nextState = result.nextState;
    let executableDecisions = result.decisions;

    if (!runtime.strategyState.inPosition && isEntrySignal) {
      const approvalRequestTransition = transitionStrategyRuntimeMode({
        mode: this.options.mode,
        currentState: runtime.lifecycleState,
        trigger: {
          type: 'STRATEGY_ENTRY_SIGNAL'
        }
      });
      if (approvalRequestTransition.action === 'REQUEST_SEMI_AUTO_APPROVAL') {
      const signal = result.decisions.find((decision) => decision.eventType === 'SIGNAL_EMIT');
        await this.requestSemiAutoApproval(runtime, candle, eventTsMs, {
          suggestedPrice: candle.close,
          ...(signal ? { signalPayload: signal.payload } : {})
        });
        return;
      }
    }

    if (!runtime.strategyState.inPosition && this.isEntryDecisions(result.decisions)) {
      const directEntryTransition = transitionStrategyRuntimeMode({
        mode: this.options.mode,
        currentState: runtime.lifecycleState,
        trigger: {
          type: 'ENTRY_INTENT_READY'
        }
      });
      if (directEntryTransition.action === 'PROCESS_DIRECT_ENTRY') {
        const blockReason = this.evaluateEntryBlockReason(runtime, eventTsMs);
        if (blockReason) {
          await this.emitRiskBlock(runtime, blockReason, eventTsMs, candle);
          await this.emitEntryReadiness(runtime, eventTsMs, candle, {
            entryReadinessPct: readiness.entryReadinessPct,
            entryReady: readiness.entryReady,
            entryExecutable: false,
            reason: blockReason,
            inPosition: false
          });
          return;
        }
        const preparedEntry = await this.prepareEntryExecution(runtime, result.decisions);
        if (!preparedEntry) {
          await this.emitRiskBlock(runtime, 'ENTRY_SIZE_INVALID', eventTsMs, candle);
          await this.emitEntryReadiness(runtime, eventTsMs, candle, {
            entryReadinessPct: readiness.entryReadinessPct,
            entryReady: false,
            entryExecutable: false,
            reason: 'ENTRY_SIZE_INVALID',
            inPosition: false
          });
          return;
        }
        executableDecisions = preparedEntry.decisions;
        nextState = {
          ...result.nextState,
          positionQty: preparedEntry.qty,
          entryNotionalKrw: preparedEntry.notionalKrw
        };
        entryExecutable = true;
        this.incrementDailyOrders(runtime, eventTsMs);
      }
    }

    if (runtime.strategyState.inPosition && this.isExitDecisions(result.decisions)) {
      executableDecisions = this.prepareExitExecution(runtime, result.decisions);
    }

    runtime.strategyState = nextState;
    syncStrategyRuntimeLifecycleState(runtime, this.options.mode);
    await this.emitDecisionSequence(runtime, eventTsMs, candle, executableDecisions);

    if (runtime.lifecycleState === 'IN_POSITION') {
      await this.emitEntryReadiness(runtime, eventTsMs, candle, {
        entryReadinessPct: 100,
        entryReady: false,
        entryExecutable: false,
        reason: this.readinessReasonForLifecycle(runtime),
        inPosition: true
      });
      return;
    }

    await this.emitEntryReadiness(runtime, eventTsMs, candle, {
      entryReadinessPct: readiness.entryReadinessPct,
      entryReady: readiness.entryReady,
      entryExecutable: entryExecutable && readiness.entryReady,
      reason: readiness.reason,
      inPosition: readiness.inPosition
    });
  }

  async emitSemiAutoApprovedEntry(
    runtime: StrategyRuntimeState,
    candle: RuntimeCandle,
    eventTsMs: number
  ): Promise<void> {
    const blockReason = this.evaluateEntryBlockReason(runtime, eventTsMs);
    if (blockReason) {
      await this.emitRiskBlock(runtime, blockReason, eventTsMs, candle);
      return;
    }

    const sizing = await this.resolveEntrySizing(runtime, candle.open);
    if (!sizing) {
      await this.emitRiskBlock(runtime, 'ENTRY_SIZE_INVALID', eventTsMs, candle);
      return;
    }

    this.incrementDailyOrders(runtime, eventTsMs);
    await this.emitDecisionSequence(
      runtime,
      eventTsMs,
      candle,
      buildLongEntrySequence({
        price: candle.open,
        qty: sizing.qty,
        notionalKrw: sizing.notionalKrw,
        fillPrice: candle.open,
        orderReason: 'SEMI_AUTO_NEXT_OPEN',
        includeSignal: false
      })
    );

    runtime.strategyState = {
      ...runtime.strategyState,
      inPosition: true,
      entryPrice: candle.open,
      entryTime: candle.time,
      positionQty: sizing.qty,
      entryNotionalKrw: sizing.notionalKrw,
      barsHeld: 0
    };
    delete runtime.pendingSemiAutoEntry;
    syncStrategyRuntimeLifecycleState(runtime, this.options.mode);
  }

  private async requestSemiAutoApproval(
    runtime: StrategyRuntimeState,
    candle: RuntimeCandle,
    eventTsMs: number,
    input: Readonly<{
      suggestedPrice: number;
      signalPayload?: StrategyRuntimeEventPayload;
    }>
  ): Promise<void> {
    await this.emitDecisionSequence(
      runtime,
      eventTsMs,
      candle,
      buildSemiAutoApprovalSequence({
        suggestedPrice: input.suggestedPrice,
        ...(input.signalPayload ? { signalPayload: input.signalPayload } : {})
      })
    );
    runtime.pendingSemiAutoEntry = {
      signalTime: candle.time,
      suggestedPrice: input.suggestedPrice
    };
    syncStrategyRuntimeLifecycleState(runtime, this.options.mode);
    await this.emitEntryReadiness(runtime, eventTsMs, candle, {
      entryReadinessPct: 100,
      entryReady: true,
      entryExecutable: false,
      reason: this.readinessReasonForLifecycle(runtime),
      inPosition: false
    });
  }

  private async emitEntryReadiness(
    runtime: StrategyRuntimeState,
    eventTsMs: number,
    candle: RuntimeCandle,
    payload: EntryReadinessPayload
  ): Promise<void> {
    await this.options.emitStrategyEvent(runtime, 'ENTRY_READINESS', eventTsMs, candle, payload);
  }

  private async emitDecisionSequence(
    runtime: StrategyRuntimeState,
    eventTsMs: number,
    candle: RuntimeCandle,
    decisions: readonly StrategyEventDecision[]
  ): Promise<void> {
    for (const decision of decisions) {
      await this.options.emitStrategyEvent(runtime, decision.eventType, eventTsMs, candle, decision.payload);
      this.trackRiskFromDecision(runtime, decision, eventTsMs);
    }
  }

  private isEntryDecisions(decisions: ReadonlyArray<Readonly<{ eventType: string; payload: StrategyRuntimeEventPayload }>>): boolean {
    return decisions.some((decision) => (
      decision.eventType === 'ORDER_INTENT' &&
      String(decision.payload.side ?? '').toUpperCase() === 'BUY'
    ));
  }

  private isExitDecisions(decisions: ReadonlyArray<Readonly<{ eventType: string; payload: StrategyRuntimeEventPayload }>>): boolean {
    return decisions.some((decision) => (
      decision.eventType === 'ORDER_INTENT' &&
      String(decision.payload.side ?? '').toUpperCase() === 'SELL'
    ));
  }

  private async prepareEntryExecution(
    runtime: StrategyRuntimeState,
    decisions: readonly StrategyEventDecision[]
  ): Promise<Readonly<{
    decisions: readonly StrategyEventDecision[];
    qty: number;
    notionalKrw: number;
  }> | undefined> {
    const orderIntent = decisions.find((decision) => (
      decision.eventType === 'ORDER_INTENT' &&
      String(decision.payload.side ?? '').toUpperCase() === 'BUY'
    ));
    if (!orderIntent) {
      return undefined;
    }

    const orderPrice = numberFromPayload(orderIntent.payload.price);
    const fillDecision = decisions.find((decision) => decision.eventType === 'FILL');
    const fillPrice = numberFromPayload(fillDecision?.payload.fillPrice) ?? orderPrice;
    const signalPayload = decisions.find((decision) => decision.eventType === 'SIGNAL_EMIT')?.payload;
    const includeSignal = decisions.some((decision) => decision.eventType === 'SIGNAL_EMIT');
    const orderReason = typeof orderIntent.payload.reason === 'string'
      ? orderIntent.payload.reason
      : 'ENTRY';
    if (typeof orderPrice !== 'number' || typeof fillPrice !== 'number') {
      return undefined;
    }
    const sizing = await this.resolveEntrySizing(runtime, fillPrice);
    if (!sizing) {
      return undefined;
    }

    return {
      qty: sizing.qty,
      notionalKrw: sizing.notionalKrw,
      decisions: buildLongEntrySequence({
        price: orderPrice,
        qty: sizing.qty,
        notionalKrw: sizing.notionalKrw,
        orderReason,
        ...(signalPayload ? { signalPayload } : {}),
        includeSignal,
        fillPrice
      })
    };
  }

  private prepareExitExecution(
    runtime: StrategyRuntimeState,
    decisions: readonly StrategyEventDecision[]
  ): readonly StrategyEventDecision[] {
    const exitDecision = decisions.find((decision) => decision.eventType === 'EXIT');
    const orderIntent = decisions.find((decision) => (
      decision.eventType === 'ORDER_INTENT' &&
      String(decision.payload.side ?? '').toUpperCase() === 'SELL'
    ));
    if (!exitDecision || !orderIntent) {
      return decisions;
    }

    const qty = this.resolveRuntimePositionQty(runtime.strategyState);
    const orderPrice = numberFromPayload(orderIntent.payload.price);
    const fillDecision = decisions.find((decision) => decision.eventType === 'FILL');
    const fillPrice = numberFromPayload(fillDecision?.payload.fillPrice) ?? orderPrice;
    const orderReason = typeof orderIntent.payload.reason === 'string'
      ? orderIntent.payload.reason
      : 'EXIT';
    if (qty <= 0 || typeof orderPrice !== 'number' || typeof fillPrice !== 'number') {
      return decisions;
    }

    return buildExitSequence({
      price: orderPrice,
      qty,
      notionalKrw: fillPrice * qty,
      orderReason,
      exitPayload: exitDecision.payload,
      fillPrice
    });
  }

  private async resolveEntrySizing(
    runtime: StrategyRuntimeState,
    price: number
  ): Promise<Readonly<{ qty: number; notionalKrw: number }> | undefined> {
    let accountBaseKrw = runtime.riskSnapshot.seedKrw;
    try {
      const resolved = await this.options.resolveAccountBaseKrw(runtime);
      if (Number.isFinite(resolved) && resolved > 0) {
        accountBaseKrw = resolved;
      }
    } catch {
      accountBaseKrw = runtime.riskSnapshot.seedKrw;
    }

    return computeEntryOrderSizing({
      accountBaseKrw,
      maxPositionRatio: runtime.riskSnapshot.maxPositionRatio,
      price
    });
  }

  private resolveRuntimePositionQty(state: MomentumState): number {
    if (typeof state.positionQty === 'number' && Number.isFinite(state.positionQty) && state.positionQty > 0) {
      return state.positionQty;
    }
    return 1;
  }

  private evaluateEntryBlockReason(runtime: StrategyRuntimeState, eventTsMs: number): string | undefined {
    const result = evaluateEntryBlock(
      runtime.riskState,
      this.options.riskConfig,
      this.options.mode,
      this.options.allowLiveTrading,
      eventTsMs
    );
    runtime.riskState = result.nextState;
    return result.reason;
  }

  private async emitRiskBlock(
    runtime: StrategyRuntimeState,
    reason: string,
    eventTsMs: number,
    candle: RuntimeCandle
  ): Promise<void> {
    const blockedEventType = reason === 'LIVE_GUARD_BLOCKED' ? 'LIVE_GUARD_BLOCKED' : 'RISK_BLOCK';
    await this.options.emitStrategyEvent(runtime, blockedEventType, eventTsMs, candle, {
      reason,
      riskSnapshot: runtime.riskState
    });
    await this.options.emitStrategyEvent(runtime, 'PAUSE', eventTsMs, candle, {
      reason,
      riskSnapshot: runtime.riskState
    });
  }

  private trackRiskFromDecision(
    runtime: StrategyRuntimeState,
    decision: Readonly<{ eventType: string; payload: StrategyRuntimeEventPayload }>,
    eventTsMs: number
  ): void {
    if (decision.eventType !== 'EXIT') {
      return;
    }
    const pnlPct = decision.payload.pnlPct;
    if (typeof pnlPct !== 'number') {
      return;
    }
    runtime.riskState = onExitPnl(runtime.riskState, pnlPct, eventTsMs);
  }

  private incrementDailyOrders(runtime: StrategyRuntimeState, eventTsMs: number): void {
    runtime.riskState = onEntryAccepted(runtime.riskState, eventTsMs);
  }

  private readinessReasonForLifecycle(runtime: StrategyRuntimeState): string {
    if (runtime.lifecycleState === 'WAITING_APPROVAL') {
      return 'AWAITING_APPROVAL';
    }
    return runtime.lifecycleState;
  }
}

function numberFromPayload(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
