import type { WsEventEnvelopeDto } from '@zenith/contracts';
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SystemEventLogger } from '../../observability/system-events/system-event.logger';
import { RuntimeMetricsService } from '../../observability/runtime-metrics.service';
import { RunsService } from '../../runs/runs.service';
import { RealtimeGateway } from '../../ws/gateways/realtime.gateway';
import { UpbitMarketClient, type UpbitMinuteCandleDto } from '../upbit.market.client';
import {
  INITIAL_MOMENTUM_STATE,
  type MomentumState
} from './simple-momentum.strategy';
import { resolveStrategyConfig } from './strategy-config';
import { evaluateStrategyCandle } from './strategy-evaluator';
import { evaluateEntryBlock, initialRiskState, onEntryAccepted, onExitPnl, type RiskState } from './risk-guard';

type UpbitTradeMessage = Readonly<{
  code?: string;
  trade_price?: number;
  trade_volume?: number;
  ask_bid?: string;
  change?: string;
  timestamp?: number;
  trade_timestamp?: number;
}>;

type CandleState = Readonly<{
  bucketMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}>;

type CandleUpdateResult = Readonly<{
  current: Readonly<{
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
  closed?: Readonly<{
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
}>;

type PendingSemiAutoEntry = Readonly<{
  signalTime: number;
  suggestedPrice: number;
}>;

@Injectable()
export class UpbitRealtimeEngine implements OnModuleInit, OnModuleDestroy {
  private readonly runId = 'run-dev-0001';
  private readonly market = process.env.UPBIT_MARKET ?? 'KRW-XRP';
  private readonly mode = (process.env.RUN_MODE as 'PAPER' | 'SEMI_AUTO' | 'AUTO' | 'LIVE' | undefined) ?? 'PAPER';
  private readonly wsUrl = 'wss://api.upbit.com/websocket/v1';
  private readonly strategy = resolveStrategyConfig(process.env.STRATEGY_ID);
  private readonly strategyVersion = process.env.STRATEGY_VERSION ?? 'v1';
  private readonly allowLiveTrading = process.env.ALLOW_LIVE_TRADING === 'true';
  private readonly e2eForceSemiAutoSignal = process.env.E2E_FORCE_SEMI_AUTO_SIGNAL === 'true';
  private readonly riskDailyLossLimitPct = Number(process.env.RISK_DAILY_LOSS_LIMIT_PCT ?? '-2');
  private readonly riskMaxConsecutiveLosses = Number(process.env.RISK_MAX_CONSECUTIVE_LOSSES ?? '3');
  private readonly riskMaxDailyOrders = Number(process.env.RISK_MAX_DAILY_ORDERS ?? '200');
  private readonly riskKillSwitchEnabled = process.env.RISK_KILL_SWITCH !== 'false';

  private ws: WebSocket | undefined;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private connectionHealthTimer: NodeJS.Timeout | undefined;
  private reconnectScheduledAtMs: number | undefined;
  private lastMessageAtMs: number | undefined;
  private seq = 0;
  private reconnectAttempt = 0;
  private closedByModuleDestroy = false;
  private candleState: CandleState | undefined;
  private strategyState: MomentumState = INITIAL_MOMENTUM_STATE;
  private pendingSemiAutoEntry: PendingSemiAutoEntry | undefined;
  private riskState: RiskState = initialRiskState(Date.now());

  constructor(
    private readonly gateway: RealtimeGateway,
    private readonly logger: SystemEventLogger,
    private readonly metrics: RuntimeMetricsService,
    private readonly runsService: RunsService,
    private readonly upbitClient: UpbitMarketClient
  ) {}

  async onModuleInit(): Promise<void> {
    await this.runsService.restoreRun(this.runId);
    this.runsService.seedRun(this.runId, {
      strategyId: this.strategy.strategyId,
      strategyVersion: this.strategyVersion,
      mode: this.mode,
      market: this.market
    });
    this.seq = this.runsService.getLastSeq(this.runId);
    await this.bootstrapMinuteCandlesWithTimeout();
    this.connect();
    this.startConnectionHealthMonitor();
  }

  onModuleDestroy(): void {
    this.closedByModuleDestroy = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    if (this.connectionHealthTimer) {
      clearInterval(this.connectionHealthTimer);
      this.connectionHealthTimer = undefined;
    }
    this.ws?.close();
    this.ws = undefined;
  }

  forceReconnectForTest(): Readonly<{ ok: boolean; reason?: string }> {
    if (!this.ws) {
      return { ok: false, reason: 'WS_UNINITIALIZED' };
    }
    this.ws.close();
    return { ok: true };
  }

  private connect(): void {
    try {
      this.ws = new WebSocket(this.wsUrl);
    } catch (error: unknown) {
      this.logger.error('Failed to construct Upbit websocket client', {
        source: 'modules.execution.upbitRealtime.connect',
        runId: this.runId,
        payload: { reason: error instanceof Error ? error.message : 'unknown' }
      });
      this.scheduleReconnect();
      return;
    }

    this.ws.addEventListener('open', () => {
      if (typeof this.reconnectScheduledAtMs === 'number') {
        this.metrics.markUpbitReconnectRecovered(Date.now() - this.reconnectScheduledAtMs);
        this.reconnectScheduledAtMs = undefined;
      }
      this.reconnectAttempt = 0;
      this.lastMessageAtMs = Date.now();
      this.logger.info('Upbit websocket connected', {
        source: 'modules.execution.upbitRealtime.open',
        runId: this.runId,
        payload: { market: this.market }
      });
      this.subscribeTradeStream();
    });

    this.ws.addEventListener('message', (event) => {
      this.lastMessageAtMs = Date.now();
      void this.handleUpbitMessage(event.data);
    });

    this.ws.addEventListener('error', (event) => {
      this.logger.warn('Upbit websocket error event', {
        source: 'modules.execution.upbitRealtime.error',
        runId: this.runId,
        payload: { message: String((event as { message?: string }).message ?? 'unknown') }
      });
    });

    this.ws.addEventListener('close', () => {
      this.logger.warn('Upbit websocket closed', {
        source: 'modules.execution.upbitRealtime.close',
        runId: this.runId,
        payload: { market: this.market, closedByModuleDestroy: this.closedByModuleDestroy }
      });
      this.ws = undefined;
      if (!this.closedByModuleDestroy) {
        this.scheduleReconnect();
      }
    });
  }

  private subscribeTradeStream(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const payload = JSON.stringify([
      { ticket: `zenith-${this.runId}` },
      { type: 'trade', codes: [this.market], isOnlyRealtime: true }
    ]);

    this.ws.send(payload);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.closedByModuleDestroy) {
      return;
    }

    this.reconnectAttempt += 1;
    const delayMs = Math.min(30_000, 1_000 * 2 ** Math.min(this.reconnectAttempt, 5));
    this.reconnectScheduledAtMs = Date.now();
    this.metrics.markUpbitReconnectAttempt();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, delayMs);

    this.logger.warn('Scheduled Upbit websocket reconnect', {
      source: 'modules.execution.upbitRealtime.scheduleReconnect',
      runId: this.runId,
      payload: { reconnectAttempt: this.reconnectAttempt, delayMs }
    });
  }

  private startConnectionHealthMonitor(): void {
    const intervalMs = 10 * 60_000;
    this.connectionHealthTimer = setInterval(() => {
      const wsReadyState = this.ws?.readyState;
      this.logger.info('Upbit websocket health check', {
        source: 'modules.execution.upbitRealtime.health',
        runId: this.runId,
        payload: {
          market: this.market,
          connected: wsReadyState === WebSocket.OPEN,
          readyState: this.toReadyStateLabel(wsReadyState),
          reconnectAttempt: this.reconnectAttempt,
          lastMessageAgeMs: typeof this.lastMessageAtMs === 'number' ? Date.now() - this.lastMessageAtMs : null
        }
      });
    }, intervalMs);
  }

  private toReadyStateLabel(state: number | undefined): string {
    if (state === WebSocket.CONNECTING) {
      return 'CONNECTING';
    }
    if (state === WebSocket.OPEN) {
      return 'OPEN';
    }
    if (state === WebSocket.CLOSING) {
      return 'CLOSING';
    }
    if (state === WebSocket.CLOSED) {
      return 'CLOSED';
    }
    return 'UNINITIALIZED';
  }

  private async handleUpbitMessage(raw: unknown): Promise<void> {
    let decoded = '';
    try {
      decoded = await this.decodeMessage(raw);
      const trade = JSON.parse(decoded) as UpbitTradeMessage;
      if (!trade.code || typeof trade.trade_price !== 'number') {
        return;
      }

      const tradeTsMs = trade.trade_timestamp ?? trade.timestamp ?? Date.now();
      const candleUpdate = this.updateOneMinuteCandle(tradeTsMs, trade.trade_price, trade.trade_volume ?? 0);

      const event: WsEventEnvelopeDto = {
        runId: this.runId,
        seq: this.nextSeq(),
        traceId: crypto.randomUUID(),
        eventType: 'MARKET_TICK',
        eventTs: new Date(tradeTsMs).toISOString(),
        payload: {
          market: trade.code,
          tradePrice: trade.trade_price,
          tradeVolume: trade.trade_volume ?? 0,
          askBid: trade.ask_bid ?? 'UNKNOWN',
          change: trade.change ?? 'UNKNOWN',
          candle: candleUpdate.current
        }
      };

      await this.gateway.ingestEngineEvent(event);
      if (candleUpdate.closed) {
        await this.processClosedCandle(candleUpdate.closed, tradeTsMs);
      }
    } catch (error: unknown) {
      this.logger.warn('Failed to decode/process Upbit message', {
        source: 'modules.execution.upbitRealtime.handleMessage',
        runId: this.runId,
        payload: {
          reason: error instanceof Error ? error.message : 'unknown',
          rawLength: decoded.length
        }
      });
    }
  }

  private async decodeMessage(raw: unknown): Promise<string> {
    if (typeof raw === 'string') {
      return raw;
    }
    if (raw instanceof ArrayBuffer) {
      return new TextDecoder().decode(new Uint8Array(raw));
    }
    if (raw instanceof Blob) {
      return raw.text();
    }
    if (ArrayBuffer.isView(raw)) {
      return new TextDecoder().decode(raw);
    }
    return '';
  }

  private updateOneMinuteCandle(tradeTsMs: number, price: number, tradeVolume: number): CandleUpdateResult {
    const bucketMs = Math.floor(tradeTsMs / 60_000) * 60_000;
    const prev = this.candleState;
    let closed:
      | Readonly<{
          time: number;
          open: number;
          high: number;
          low: number;
          close: number;
          volume: number;
        }>
      | undefined;
    if (!prev || prev.bucketMs !== bucketMs) {
      if (prev) {
        closed = {
          time: Math.floor(prev.bucketMs / 1000),
          open: prev.open,
          high: prev.high,
          low: prev.low,
          close: prev.close,
          volume: prev.volume
        };
      }
      this.candleState = { bucketMs, open: price, high: price, low: price, close: price, volume: tradeVolume };
    } else {
      this.candleState = {
        bucketMs,
        open: prev.open,
        high: Math.max(prev.high, price),
        low: Math.min(prev.low, price),
        close: price,
        volume: prev.volume + tradeVolume
      };
    }

    const candle = this.candleState;
    const current = {
      time: Math.floor(candle.bucketMs / 1000),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume
    };
    if (closed) {
      return { current, closed };
    }
    return {
      current
    };
  }

  private async processClosedCandle(
    candle: Readonly<{
      time: number;
      open: number;
      high: number;
      low: number;
      close: number;
    }>,
    eventTsMs: number
  ): Promise<void> {
    if (this.mode === 'SEMI_AUTO' && this.pendingSemiAutoEntry) {
      if (!this.runsService.consumeApproval(this.runId)) {
        return;
      }
      await this.emitSemiAutoApprovedEntry(candle, eventTsMs);
      return;
    }

    if (this.mode === 'SEMI_AUTO' && this.e2eForceSemiAutoSignal && !this.strategyState.inPosition) {
      await this.emitStrategyEvent('SIGNAL_EMIT', eventTsMs, candle, {
        signal: 'LONG_ENTRY',
        reason: 'E2E_FORCE_SEMI_AUTO_SIGNAL'
      });
      await this.emitStrategyEvent('APPROVE_ENTER', eventTsMs, candle, {
        approvalMode: 'SEMI_AUTO',
        entryPolicy: 'NEXT_OPEN_AFTER_APPROVAL',
        suggestedPrice: candle.close
      });
      this.pendingSemiAutoEntry = {
        signalTime: candle.time,
        suggestedPrice: candle.close
      };
      return;
    }

    const result = evaluateStrategyCandle(this.strategy.strategyId, this.strategyState, candle, this.strategy.momentum);

    const isEntrySignal = result.decisions.some((decision) => decision.eventType === 'SIGNAL_EMIT');
    if (this.mode === 'SEMI_AUTO' && !this.strategyState.inPosition && isEntrySignal) {
      const signal = result.decisions.find((decision) => decision.eventType === 'SIGNAL_EMIT');
      if (signal) {
        await this.emitStrategyEvent('SIGNAL_EMIT', eventTsMs, candle, signal.payload);
      }
      await this.emitStrategyEvent('APPROVE_ENTER', eventTsMs, candle, {
        approvalMode: 'SEMI_AUTO',
        entryPolicy: 'NEXT_OPEN_AFTER_APPROVAL',
        suggestedPrice: candle.close
      });
      this.pendingSemiAutoEntry = {
        signalTime: candle.time,
        suggestedPrice: candle.close
      };
      return;
    }

    if (!this.strategyState.inPosition && this.isEntryDecisions(result.decisions)) {
      const blockReason = this.evaluateEntryBlockReason(eventTsMs);
      if (blockReason) {
        await this.emitRiskBlock(blockReason, eventTsMs, candle);
        return;
      }
      this.incrementDailyOrders(eventTsMs);
    }

    this.strategyState = result.nextState;
    for (const decision of result.decisions) {
      await this.emitStrategyEvent(decision.eventType, eventTsMs, candle, decision.payload);
      this.trackRiskFromDecision(decision);
    }
  }

  private nextSeq(): number {
    this.seq += 1;
    return this.seq;
  }

  private async bootstrapMinuteCandles(): Promise<void> {
    try {
      const candles = await this.upbitClient.getMinuteCandles(this.market, 1, 200);
      const asc = [...candles].sort((a, b) => a.timestamp - b.timestamp);
      for (const candle of asc) {
        await this.emitSnapshotCandle(candle);
      }

      this.logger.info('Upbit candle snapshot loaded', {
        source: 'modules.execution.upbitRealtime.bootstrapMinuteCandles',
        runId: this.runId,
        payload: { market: this.market, count: asc.length }
      });
    } catch (error: unknown) {
      this.logger.warn('Failed to load Upbit candle snapshot', {
        source: 'modules.execution.upbitRealtime.bootstrapMinuteCandles',
        runId: this.runId,
        payload: { market: this.market, reason: error instanceof Error ? error.message : 'unknown' }
      });
    }
  }

  private async bootstrapMinuteCandlesWithTimeout(): Promise<void> {
    const timeoutMs = 7000;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
    }, timeoutMs);

    await Promise.race([
      this.bootstrapMinuteCandles(),
      new Promise<void>((resolve) => {
        setTimeout(resolve, timeoutMs);
      })
    ]);
    clearTimeout(timer);

    if (timedOut) {
      this.logger.warn('Skipped waiting for candle snapshot due startup timeout', {
        source: 'modules.execution.upbitRealtime.bootstrapMinuteCandlesWithTimeout',
        runId: this.runId,
        payload: { timeoutMs, market: this.market }
      });
    }
  }

  private async emitSnapshotCandle(candle: UpbitMinuteCandleDto): Promise<void> {
    this.candleState = {
      bucketMs: Math.floor(candle.timestamp / 60_000) * 60_000,
      open: candle.opening_price,
      high: candle.high_price,
      low: candle.low_price,
      close: candle.trade_price,
      volume: candle.candle_acc_trade_volume ?? 0
    };

    await this.gateway.ingestEngineEvent({
      runId: this.runId,
      seq: this.nextSeq(),
      traceId: crypto.randomUUID(),
      eventType: 'MARKET_TICK',
      eventTs: new Date(candle.timestamp).toISOString(),
      payload: {
        market: this.market,
        source: 'CANDLE_SNAPSHOT',
        candle: {
          time: Math.floor(candle.timestamp / 1000),
          open: candle.opening_price,
          high: candle.high_price,
          low: candle.low_price,
          close: candle.trade_price,
          volume: candle.candle_acc_trade_volume ?? 0
        }
      }
    });
  }

  private async emitSemiAutoApprovedEntry(
    candle: Readonly<{
      time: number;
      open: number;
      high: number;
      low: number;
      close: number;
    }>,
    eventTsMs: number
  ): Promise<void> {
    const blockReason = this.evaluateEntryBlockReason(eventTsMs);
    if (blockReason) {
      await this.emitRiskBlock(blockReason, eventTsMs, candle);
      return;
    }

    this.incrementDailyOrders(eventTsMs);
    await this.emitStrategyEvent('ORDER_INTENT', eventTsMs, candle, {
      side: 'BUY',
      qty: 1,
      price: candle.open,
      reason: 'SEMI_AUTO_NEXT_OPEN'
    });
    await this.emitStrategyEvent('FILL', eventTsMs, candle, {
      side: 'BUY',
      qty: 1,
      fillPrice: candle.open
    });
    await this.emitStrategyEvent('POSITION_UPDATE', eventTsMs, candle, {
      side: 'LONG',
      qty: 1,
      avgEntry: candle.open
    });

    this.strategyState = {
      ...this.strategyState,
      inPosition: true,
      entryPrice: candle.open,
      entryTime: candle.time,
      barsHeld: 0
    };
    this.pendingSemiAutoEntry = undefined;
  }

  private async emitStrategyEvent(
    eventType: string,
    eventTsMs: number,
    candle: Readonly<{
      time: number;
      open: number;
      high: number;
      low: number;
      close: number;
    }>,
    payload: Readonly<Record<string, unknown>>
  ): Promise<void> {
    await this.gateway.ingestEngineEvent({
      runId: this.runId,
      seq: this.nextSeq(),
      traceId: crypto.randomUUID(),
      eventType,
      eventTs: new Date(eventTsMs).toISOString(),
      payload: {
        market: this.market,
        candle,
        strategyId: this.strategy.strategyId,
        strategyVersion: this.strategyVersion,
        strategyName: this.strategy.strategyName,
        ...payload
      }
    });
  }

  private isEntryDecisions(decisions: ReadonlyArray<Readonly<{ eventType: string; payload: Readonly<Record<string, unknown>> }>>): boolean {
    return decisions.some((decision) => (
      decision.eventType === 'ORDER_INTENT' &&
      String(decision.payload.side ?? '').toUpperCase() === 'BUY'
    ));
  }

  private evaluateEntryBlockReason(eventTsMs: number): string | undefined {
    const result = evaluateEntryBlock(
      this.riskState,
      {
        dailyLossLimitPct: this.riskDailyLossLimitPct,
        maxConsecutiveLosses: this.riskMaxConsecutiveLosses,
        maxDailyOrders: this.riskMaxDailyOrders,
        killSwitchEnabled: this.riskKillSwitchEnabled
      },
      this.mode,
      this.allowLiveTrading,
      eventTsMs
    );
    this.riskState = result.nextState;
    return result.reason;
  }

  private async emitRiskBlock(
    reason: string,
    eventTsMs: number,
    candle: Readonly<{ time: number; open: number; high: number; low: number; close: number }>
  ): Promise<void> {
    const blockedEventType = reason === 'LIVE_GUARD_BLOCKED' ? 'LIVE_GUARD_BLOCKED' : 'RISK_BLOCK';
    await this.emitStrategyEvent(blockedEventType, eventTsMs, candle, {
      reason,
      riskSnapshot: this.riskState
    });
    await this.emitStrategyEvent('PAUSE', eventTsMs, candle, {
      reason,
      riskSnapshot: this.riskState
    });
  }

  private trackRiskFromDecision(decision: Readonly<{ eventType: string; payload: Readonly<Record<string, unknown>> }>): void {
    if (decision.eventType !== 'EXIT') {
      return;
    }
    const pnlPct = decision.payload.pnlPct;
    if (typeof pnlPct !== 'number') {
      return;
    }
    this.riskState = onExitPnl(this.riskState, pnlPct, Date.now());
  }

  private incrementDailyOrders(eventTsMs: number): void {
    this.riskState = onEntryAccepted(this.riskState, eventTsMs);
  }
}
