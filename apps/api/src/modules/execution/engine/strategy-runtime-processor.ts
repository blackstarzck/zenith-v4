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
import { evaluateStrategyEventDetailed } from './strategy-evaluator';
import type { MomentumState } from './simple-momentum.strategy';
import type {
  OrderbookTop,
  RealtimePriceTick,
  StrategyMarketEvent,
  TimeframeKey
} from './shared/market-types';
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
  private readonly lastEntryReadinessSignatureByRun = new Map<string, string>();

  constructor(private readonly options: StrategyRuntimeProcessorOptions) {}

  async processClosedCandle(
    runtime: StrategyRuntimeState,
    candle: RuntimeCandle,
    eventTsMs: number,
    timeframe: TimeframeKey = '1m'
  ): Promise<void> {
    await this.processStrategyEvent(runtime, {
      type: 'CANDLE_CLOSE',
      timeframe,
      candle
    }, candle, eventTsMs);
  }

  async processCandleOpen(
    runtime: StrategyRuntimeState,
    candle: RuntimeCandle,
    eventTsMs: number,
    timeframe: TimeframeKey = '1m'
  ): Promise<void> {
    await this.processStrategyEvent(runtime, {
      type: 'CANDLE_OPEN',
      timeframe,
      candle
    }, candle, eventTsMs);
  }

  async processTradeTick(
    runtime: StrategyRuntimeState,
    tick: RealtimePriceTick,
    candle: RuntimeCandle,
    eventTsMs: number
  ): Promise<void> {
    await this.processStrategyEvent(runtime, {
      type: 'TRADE_TICK',
      tick
    }, candle, eventTsMs);
  }

  async processTicker(
    runtime: StrategyRuntimeState,
    tick: RealtimePriceTick,
    candle: RuntimeCandle,
    eventTsMs: number
  ): Promise<void> {
    await this.processStrategyEvent(runtime, {
      type: 'TICKER',
      tick
    }, candle, eventTsMs);
  }

  async processOrderbook(
    runtime: StrategyRuntimeState,
    orderbook: OrderbookTop,
    candle: RuntimeCandle,
    eventTsMs: number
  ): Promise<void> {
    await this.processStrategyEvent(runtime, {
      type: 'ORDERBOOK',
      orderbook
    }, candle, eventTsMs);
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
      position: {
        qty: sizing.qty,
        initialQty: sizing.qty,
        avgEntryPrice: candle.open,
        entryTime: candle.time,
        entryNotionalKrw: sizing.notionalKrw,
        barsHeld: 0,
        partialExitQty: 0,
        realizedPnlPct: 0,
        realizedPnlKrw: 0
      },
      barsHeld: 0
    };
    delete runtime.pendingSemiAutoEntry;
    syncStrategyRuntimeLifecycleState(runtime, this.options.mode);
  }

  private async processStrategyEvent(
    runtime: StrategyRuntimeState,
    event: StrategyMarketEvent,
    candle: RuntimeCandle,
    eventTsMs: number
  ): Promise<void> {
    syncStrategyRuntimeLifecycleState(runtime, this.options.mode);

    if (runtime.lifecycleState === 'WAITING_APPROVAL') {
      if (event.type === 'CANDLE_OPEN' && this.options.consumeApproval(runtime.runId)) {
        await this.emitSemiAutoApprovedEntry(runtime, candle, eventTsMs);
        await this.emitEntryReadiness(runtime, eventTsMs, candle, {
          entryReadinessPct: 100,
          entryReady: false,
          entryExecutable: false,
          reason: this.readinessReasonForLifecycle(runtime),
          inPosition: runtime.strategyState.inPosition
        });
        return;
      }

      await this.emitEntryReadiness(runtime, eventTsMs, candle, {
        entryReadinessPct: 100,
        entryReady: true,
        entryExecutable: false,
        reason: 'AWAITING_APPROVAL',
        inPosition: false
      });
      return;
    }

    if (await this.tryForceSemiAutoApproval(runtime, event, candle, eventTsMs)) {
      return;
    }

    const detailed = evaluateStrategyEventDetailed(runtime.strategyId, runtime.strategyState, event, runtime.momentum);
    let nextState = detailed.result.nextState;
    let executableDecisions = detailed.result.decisions;
    let entryExecutable = false;

    const isEntrySignal = !runtime.strategyState.inPosition && detailed.result.decisions.some((decision) => (
      decision.eventType === 'SIGNAL_EMIT'
    ));

    if (!runtime.strategyState.inPosition && isEntrySignal && event.type === 'CANDLE_CLOSE') {
      const approvalRequestTransition = transitionStrategyRuntimeMode({
        mode: this.options.mode,
        currentState: runtime.lifecycleState,
        trigger: {
          type: 'STRATEGY_ENTRY_SIGNAL'
        }
      });
      if (approvalRequestTransition.action === 'REQUEST_SEMI_AUTO_APPROVAL') {
        runtime.strategyState = this.toApprovalPendingState(nextState);
        const signal = detailed.result.decisions.find((decision) => decision.eventType === 'SIGNAL_EMIT');
        await this.requestSemiAutoApproval(runtime, candle, eventTsMs, {
          suggestedPrice: candle.close,
          ...(signal ? { signalPayload: signal.payload } : {})
        });
        return;
      }
    }

    if (!runtime.strategyState.inPosition && this.isEntryDecisions(detailed.result.decisions)) {
      const directEntryTransition = transitionStrategyRuntimeMode({
        mode: this.options.mode,
        currentState: runtime.lifecycleState,
        trigger: {
          type: 'ENTRY_INTENT_READY'
        }
      });

      if (directEntryTransition.action === 'PROCESS_DIRECT_ENTRY') {
        const blockReason = this.evaluateEntryBlockReason(runtime, eventTsMs);
        runtime.strategyState = nextState;
        if (blockReason) {
          syncStrategyRuntimeLifecycleState(runtime, this.options.mode);
          await this.emitRiskBlock(runtime, blockReason, eventTsMs, candle);
          await this.emitEntryReadiness(runtime, eventTsMs, candle, {
            entryReadinessPct: detailed.readiness.entryReadinessPct,
            entryReady: detailed.readiness.entryReady,
            entryExecutable: false,
            reason: blockReason,
            inPosition: false
          });
          return;
        }

        const preparedEntry = await this.prepareEntryExecution(runtime, detailed.result.decisions, nextState);
        if (!preparedEntry) {
          await this.emitRiskBlock(runtime, 'ENTRY_SIZE_INVALID', eventTsMs, candle);
          await this.emitEntryReadiness(runtime, eventTsMs, candle, {
            entryReadinessPct: detailed.readiness.entryReadinessPct,
            entryReady: false,
            entryExecutable: false,
            reason: 'ENTRY_SIZE_INVALID',
            inPosition: false
          });
          return;
        }

        executableDecisions = preparedEntry.decisions;
        nextState = preparedEntry.nextState;
        entryExecutable = true;
        this.incrementDailyOrders(runtime, eventTsMs);
      }
    }

    if (runtime.strategyState.inPosition && this.isExitDecisions(detailed.result.decisions)) {
      executableDecisions = this.prepareExitExecution(runtime, detailed.result.decisions);
    }

    runtime.strategyState = nextState;
    syncStrategyRuntimeLifecycleState(runtime, this.options.mode);

    if (executableDecisions.length > 0) {
      await this.emitDecisionSequence(runtime, eventTsMs, candle, executableDecisions);
    }

    if (
      event.type !== 'CANDLE_CLOSE' &&
      event.type !== 'CANDLE_OPEN' &&
      executableDecisions.length === 0
    ) {
      return;
    }

    await this.emitEntryReadiness(runtime, eventTsMs, candle, {
      entryReadinessPct: detailed.readiness.entryReadinessPct,
      entryReady: detailed.readiness.entryReady,
      entryExecutable: entryExecutable && detailed.readiness.entryReady,
      reason: runtime.strategyState.inPosition ? this.readinessReasonForLifecycle(runtime) : detailed.readiness.reason,
      inPosition: runtime.strategyState.inPosition
    });
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

  private async tryForceSemiAutoApproval(
    runtime: StrategyRuntimeState,
    event: StrategyMarketEvent,
    candle: RuntimeCandle,
    eventTsMs: number
  ): Promise<boolean> {
    if (
      !this.options.e2eForceSemiAutoSignal ||
      this.options.mode !== 'SEMI_AUTO' ||
      runtime.strategyId !== 'STRAT_B' ||
      runtime.lifecycleState !== 'FLAT' ||
      runtime.strategyState.inPosition ||
      runtime.pendingSemiAutoEntry ||
      event.type !== 'CANDLE_OPEN' ||
      event.timeframe !== '1m'
    ) {
      return false;
    }

    const transition = transitionStrategyRuntimeMode({
      mode: this.options.mode,
      currentState: runtime.lifecycleState,
      trigger: {
        type: 'FORCE_SEMI_AUTO_SIGNAL'
      }
    });
    if (transition.action !== 'REQUEST_SEMI_AUTO_APPROVAL') {
      return false;
    }

    runtime.strategyState = this.toApprovalPendingState(runtime.strategyState);
    await this.requestSemiAutoApproval(runtime, candle, eventTsMs, {
      suggestedPrice: candle.open,
      signalPayload: {
        signal: 'LONG_ENTRY',
        reason: 'E2E_FORCE_SEMI_AUTO_SIGNAL',
        forced: true
      }
    });
    return true;
  }

  private async emitEntryReadiness(
    runtime: StrategyRuntimeState,
    eventTsMs: number,
    candle: RuntimeCandle,
    payload: EntryReadinessPayload
  ): Promise<void> {
    const nextSignature = buildEntryReadinessSignature(candle, payload);
    if (this.lastEntryReadinessSignatureByRun.get(runtime.runId) === nextSignature) {
      return;
    }

    this.lastEntryReadinessSignatureByRun.set(runtime.runId, nextSignature);
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
    decisions: readonly StrategyEventDecision[],
    nextState: MomentumState
  ): Promise<Readonly<{
    decisions: readonly StrategyEventDecision[];
    nextState: MomentumState;
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
      decisions: buildLongEntrySequence({
        price: orderPrice,
        qty: sizing.qty,
        notionalKrw: sizing.notionalKrw,
        orderReason,
        ...(signalPayload ? { signalPayload } : {}),
        includeSignal,
        fillPrice
      }),
      nextState: {
        ...nextState,
        positionQty: sizing.qty,
        entryNotionalKrw: sizing.notionalKrw,
        position: {
          qty: sizing.qty,
          initialQty: sizing.qty,
          avgEntryPrice: fillPrice,
          entryTime: nextState.entryTime ?? 0,
          entryNotionalKrw: sizing.notionalKrw,
          barsHeld: 0,
          partialExitQty: 0,
          realizedPnlPct: 0,
          realizedPnlKrw: 0
        }
      }
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

    const desiredQty = numberFromPayload(orderIntent.payload.qty) ?? this.resolveRuntimePositionQty(runtime.strategyState);
    const orderPrice = numberFromPayload(orderIntent.payload.price);
    const fillDecision = decisions.find((decision) => decision.eventType === 'FILL');
    const fillPrice = numberFromPayload(fillDecision?.payload.fillPrice) ?? orderPrice;
    const orderReason = typeof orderIntent.payload.reason === 'string'
      ? orderIntent.payload.reason
      : 'EXIT';
    const positionPayload = decisions.find((decision) => decision.eventType === 'POSITION_UPDATE')?.payload;
    if (desiredQty <= 0 || typeof orderPrice !== 'number' || typeof fillPrice !== 'number') {
      return decisions;
    }

    return buildExitSequence({
      price: orderPrice,
      qty: desiredQty,
      notionalKrw: fillPrice * desiredQty,
      orderReason,
      exitPayload: exitDecision.payload,
      fillPrice,
      ...(positionPayload ? { positionPayload } : {})
    });
  }

  private async resolveEntrySizing(
    runtime: StrategyRuntimeState,
    price: number
  ): Promise<Readonly<{ qty: number; notionalKrw: number }> | undefined> {
    if (runtime.strategyId === 'STRAT_C') {
      const orderKrw = runtime.momentum.stratC?.fixedOrderKrw ?? runtime.momentum.orderKrw;
      if (typeof orderKrw === 'number' && Number.isFinite(orderKrw) && orderKrw > 0) {
        const qty = Math.floor(((orderKrw / price) * 100_000_000) + 1e-9) / 100_000_000;
        if (qty > 0) {
          return {
            qty,
            notionalKrw: Number((qty * price).toFixed(2))
          };
        }
      }
    }

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
    if (typeof state.position?.qty === 'number' && Number.isFinite(state.position.qty) && state.position.qty > 0) {
      return state.position.qty;
    }
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

  private toApprovalPendingState(state: MomentumState): MomentumState {
    return {
      ...state,
      inPosition: false,
      entryPrice: undefined,
      entryTime: undefined,
      positionQty: undefined,
      entryNotionalKrw: undefined,
      position: undefined,
      barsHeld: 0,
      stratB: state.stratB
        ? {
          ...state.stratB,
          stage: 'WAIT_APPROVAL'
        }
        : state.stratB
    };
  }
}

function buildEntryReadinessSignature(
  candle: RuntimeCandle,
  payload: EntryReadinessPayload
): string {
  return [
    candle.time,
    payload.entryReadinessPct,
    payload.entryReady ? 1 : 0,
    payload.entryExecutable ? 1 : 0,
    payload.reason,
    payload.inPosition ? 1 : 0
  ].join('|');
}

function numberFromPayload(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
