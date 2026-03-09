import {
  SYSTEM_EVENT_TYPE,
  type ConnectionState,
  type WsEventEnvelopeDto
} from '@zenith/contracts';
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SystemEventLogger } from '../../observability/system-events/system-event.logger';
import { RuntimeMetricsService } from '../../observability/runtime-metrics.service';
import { RunsService } from '../../runs/runs.service';
import { RealtimeGateway } from '../../ws/gateways/realtime.gateway';
import { UpbitMarketClient, type UpbitMinuteCandleDto } from '../upbit.market.client';
import {
  isStaleClosedCandle,
  resolveSnapshotBucketMs,
  snapshotToCandleState,
  toRuntimeCandle,
  updateOneMinuteCandle,
  type CandleState,
  type RuntimeCandle
} from './realtime-candle-state';
import { StrategyRuntimeProcessor } from './strategy-runtime-processor';
import { type StrategyId } from './strategy-config';
import {
  createStrategyRuntimeState,
  STRATEGY_IDS,
  type StrategyRuntimeState
} from './strategy-runtime-state';
import type { OrderbookTop, RealtimePriceTick, TimeframeKey } from './shared/market-types';
import {
  shouldEmitOpenForTimeframe,
  updateAggregatedCandle,
  type AggregatedCandleState
} from './shared/timeframe-aggregator';
import { UpbitRealtimeConnection } from './upbit-realtime-connection';

type UpbitTradeMessage = Readonly<{
  type?: string;
  code?: string;
  trade_price?: number;
  trade_volume?: number;
  ask_bid?: string;
  change?: string;
  timestamp?: number;
  trade_timestamp?: number;
  best_bid_price?: number;
  best_ask_price?: number;
}>;

type UpbitOrderbookUnit = Readonly<{
  ask_price?: number;
  bid_price?: number;
  ask_size?: number;
  bid_size?: number;
}>;

type UpbitOrderbookMessage = Readonly<{
  type?: string;
  code?: string;
  timestamp?: number;
  orderbook_units?: readonly UpbitOrderbookUnit[];
}>;

const MAX_CLOSED_CANDLE_LAG_MS = 10 * 60_000;

@Injectable()
export class UpbitRealtimeEngine implements OnModuleInit, OnModuleDestroy {
  private readonly market = process.env.UPBIT_MARKET ?? 'KRW-XRP';
  private readonly mode = (process.env.RUN_MODE as 'PAPER' | 'SEMI_AUTO' | 'AUTO' | 'LIVE' | undefined) ?? 'PAPER';
  private readonly wsUrl = 'wss://api.upbit.com/websocket/v1';
  private readonly strategyVersion = process.env.STRATEGY_VERSION ?? 'v1';
  private readonly allowLiveTrading = process.env.ALLOW_LIVE_TRADING === 'true';
  private readonly e2eForceSemiAutoSignal = process.env.E2E_FORCE_SEMI_AUTO_SIGNAL === 'true';
  private readonly riskDailyLossLimitPct = Number(process.env.RISK_DAILY_LOSS_LIMIT_PCT ?? '-2');
  private readonly riskMaxConsecutiveLosses = Number(process.env.RISK_MAX_CONSECUTIVE_LOSSES ?? '3');
  private readonly riskMaxDailyOrders = Number(process.env.RISK_MAX_DAILY_ORDERS ?? '200');
  private readonly riskKillSwitchEnabled = process.env.RISK_KILL_SWITCH !== 'false';

  private candleState: CandleState | undefined;
  private candleState15m: AggregatedCandleState | undefined;
  private candleState1h: AggregatedCandleState | undefined;
  private latestOrderbook: OrderbookTop | undefined;
  private snapshotRecoveryPending = false;
  private readonly connection: UpbitRealtimeConnection;
  private readonly runtimeProcessor: StrategyRuntimeProcessor;
  private readonly runtimeByStrategy: Record<StrategyId, StrategyRuntimeState> = {
    STRAT_A: createStrategyRuntimeState('STRAT_A', this.strategyVersion),
    STRAT_B: createStrategyRuntimeState('STRAT_B', this.strategyVersion),
    STRAT_C: createStrategyRuntimeState('STRAT_C', this.strategyVersion)
  };

  constructor(
    private readonly gateway: RealtimeGateway,
    private readonly logger: SystemEventLogger,
    private readonly metrics: RuntimeMetricsService,
    private readonly runsService: RunsService,
    private readonly upbitClient: UpbitMarketClient
  ) {
    this.runtimeProcessor = new StrategyRuntimeProcessor({
      mode: this.mode,
      allowLiveTrading: this.allowLiveTrading,
      e2eForceSemiAutoSignal: this.e2eForceSemiAutoSignal,
      riskConfig: {
        dailyLossLimitPct: this.riskDailyLossLimitPct,
        maxConsecutiveLosses: this.riskMaxConsecutiveLosses,
        maxDailyOrders: this.riskMaxDailyOrders,
        killSwitchEnabled: this.riskKillSwitchEnabled
      },
      consumeApproval: (runId) => this.runsService.consumeApproval(runId),
      resolveAccountBaseKrw: async (runtime) => {
        const summary = await this.runsService.getStrategyAccountSummary(runtime.strategyId);
        return summary.equityKrw;
      },
      emitStrategyEvent: (runtime, eventType, eventTsMs, candle, payload) => (
        this.emitStrategyEvent(runtime, eventType, eventTsMs, candle, payload)
      )
    });
    this.connection = new UpbitRealtimeConnection({
      wsUrl: this.wsUrl,
      market: this.market,
      logger: this.logger,
      metrics: this.metrics,
      getRunId: () => this.primaryRunId(),
      onMessage: (raw) => this.handleUpbitMessage(raw),
      onStateChange: (input) => this.applyTransportStateToAllRuns(input)
    });
  }

  async onModuleInit(): Promise<void> {
    for (const strategyId of STRATEGY_IDS) {
      const runtime = this.runtimeByStrategy[strategyId];
      await this.runsService.restoreRun(runtime.runId);
      try {
        await this.runsService.updateRunControl(runtime.runId, {
          strategyId: runtime.strategyId,
          strategyVersion: this.strategyVersion,
          mode: this.mode,
          market: this.market
        });
      } catch (error: unknown) {
        this.logger.warn('Failed to sync runtime session control to current engine env', {
          source: 'modules.execution.upbitRealtime.onModuleInit',
          runId: runtime.runId,
          payload: {
            reason: error instanceof Error ? error.message : 'unknown',
            mode: this.mode,
            market: this.market,
            strategyVersion: this.strategyVersion
          }
        });
      }
      runtime.seq = this.runsService.getLastSeq(runtime.runId);
      await this.hydrateRuntimeRecentCandles(runtime);
      this.runsService.setSnapshotDelay(runtime.runId, true);
    }
    const snapshotLoaded = await this.bootstrapMinuteCandlesWithTimeout();
    this.snapshotRecoveryPending = !snapshotLoaded;
    if (snapshotLoaded) {
      this.markAllRunsSnapshotDelay(false);
    }
    this.connection.start();
  }

  onModuleDestroy(): void {
    this.connection.stop();
  }

  forceReconnectForTest(): Readonly<{ ok: boolean; reason?: string }> {
    return this.connection.forceReconnectForTest();
  }

  private async handleUpbitMessage(raw: unknown): Promise<void> {
    let decoded = '';
    try {
      decoded = await this.decodeMessage(raw);
      const message = JSON.parse(decoded) as UpbitTradeMessage & UpbitOrderbookMessage;
      if (Array.isArray(message.orderbook_units)) {
        await this.handleOrderbookMessage(message);
        return;
      }
      if (typeof message.trade_price !== 'number' || !message.code) {
        return;
      }
      if (message.type === 'ticker') {
        await this.handleTickerMessage(message);
        return;
      }
      await this.handleTradeMessage(message);
    } catch (error: unknown) {
      this.logger.warn('Failed to decode/process Upbit message', {
        source: 'modules.execution.upbitRealtime.handleMessage',
        runId: this.primaryRunId(),
        payload: {
          reason: error instanceof Error ? error.message : 'unknown',
          rawLength: decoded.length
        }
      });
    }
  }

  private async handleTradeMessage(trade: UpbitTradeMessage): Promise<void> {
    const tradeTsMs = trade.trade_timestamp ?? trade.timestamp ?? Date.now();
    const candleUpdate = updateOneMinuteCandle(
      this.candleState,
      tradeTsMs,
      trade.trade_price ?? 0,
      trade.trade_volume ?? 0,
      trade.ask_bid,
      trade.best_bid_price ?? this.latestOrderbook?.bidPrice,
      trade.best_ask_price ?? this.latestOrderbook?.askPrice
    );
    this.candleState = candleUpdate.nextState;
    this.clearSnapshotDelayAfterLiveTrade();

    const tick = this.toRealtimeTick(trade, tradeTsMs);
    for (const strategyId of STRATEGY_IDS) {
      const runtime = this.runtimeByStrategy[strategyId];
      await this.gateway.ingestEngineEvent(this.buildMarketTickEvent(runtime, tradeTsMs, candleUpdate.current, tick, trade.change));
      await this.runtimeProcessor.processTradeTick(runtime, tick, candleUpdate.current, tradeTsMs);
    }

    if (!candleUpdate.closed) {
      return;
    }

    if (isStaleClosedCandle(candleUpdate.closed.time, tradeTsMs, MAX_CLOSED_CANDLE_LAG_MS)) {
      this.logger.warn('Skipped stale closed candle during live processing', {
        source: 'modules.execution.upbitRealtime.handleMessage',
        eventType: SYSTEM_EVENT_TYPE.ENGINE_STATE_INVALID,
        runId: this.primaryRunId(),
        payload: {
          closedTime: candleUpdate.closed.time,
          closedTs: new Date(candleUpdate.closed.time * 1000).toISOString(),
          tradeTs: new Date(tradeTsMs).toISOString(),
          lagMs: tradeTsMs - candleUpdate.closed.time * 1000
        }
      });
      return;
    }

    await this.processMinuteBoundary(candleUpdate.closed, candleUpdate.current, tradeTsMs);
  }

  private async handleTickerMessage(message: UpbitTradeMessage): Promise<void> {
    const tradeTsMs = message.trade_timestamp ?? message.timestamp ?? Date.now();
    const candle = this.candleState ? toRuntimeCandle(this.candleState) : {
      time: Math.floor(tradeTsMs / 1000 / 60) * 60,
      open: message.trade_price ?? 0,
      high: message.trade_price ?? 0,
      low: message.trade_price ?? 0,
      close: message.trade_price ?? 0,
      volume: 0
    };
    const tick = this.toRealtimeTick(message, tradeTsMs);
    for (const strategyId of STRATEGY_IDS) {
      const runtime = this.runtimeByStrategy[strategyId];
      await this.runtimeProcessor.processTicker(runtime, tick, candle, tradeTsMs);
    }
  }

  private async handleOrderbookMessage(message: UpbitOrderbookMessage): Promise<void> {
    const first = message.orderbook_units?.[0];
    if (!message.code || !first || typeof first.ask_price !== 'number' || typeof first.bid_price !== 'number') {
      return;
    }

    const orderbook: OrderbookTop = {
      askPrice: first.ask_price,
      bidPrice: first.bid_price,
      ...(typeof first.ask_size === 'number' ? { askSize: first.ask_size } : {}),
      ...(typeof first.bid_size === 'number' ? { bidSize: first.bid_size } : {}),
      tsMs: message.timestamp ?? Date.now()
    };
    this.latestOrderbook = orderbook;
    const candle = this.candleState ? toRuntimeCandle(this.candleState) : {
      time: Math.floor(orderbook.tsMs / 1000 / 60) * 60,
      open: orderbook.bidPrice,
      high: orderbook.askPrice,
      low: orderbook.bidPrice,
      close: orderbook.askPrice,
      volume: 0
    };
    for (const strategyId of STRATEGY_IDS) {
      const runtime = this.runtimeByStrategy[strategyId];
      await this.runtimeProcessor.processOrderbook(runtime, orderbook, candle, orderbook.tsMs);
    }
  }

  private async processMinuteBoundary(
    closedMinute: RuntimeCandle,
    currentMinute: RuntimeCandle,
    eventTsMs: number
  ): Promise<void> {
    await this.processClosedCandle(closedMinute, eventTsMs, '1m');

    const fifteenResult = updateAggregatedCandle(this.candleState15m, closedMinute, '15m');
    this.candleState15m = fifteenResult.nextState;
    if (fifteenResult.closed) {
      await this.processClosedCandle(
        {
          ...fifteenResult.closed,
          volume: fifteenResult.closed.volume ?? 0
        },
        eventTsMs,
        '15m'
      );
    }

    const oneHourResult = updateAggregatedCandle(this.candleState1h, closedMinute, '1h');
    this.candleState1h = oneHourResult.nextState;
    if (oneHourResult.closed) {
      await this.processClosedCandle(
        {
          ...oneHourResult.closed,
          volume: oneHourResult.closed.volume ?? 0
        },
        eventTsMs,
        '1h'
      );
    }

    await this.processOpenCandle(currentMinute, eventTsMs, '1m');
    if (shouldEmitOpenForTimeframe('15m', currentMinute.time)) {
      await this.processOpenCandle(currentMinute, eventTsMs, '15m');
    }
    if (shouldEmitOpenForTimeframe('1h', currentMinute.time)) {
      await this.processOpenCandle(currentMinute, eventTsMs, '1h');
    }
  }

  private async processClosedCandle(candle: RuntimeCandle, eventTsMs: number, timeframe: TimeframeKey): Promise<void> {
    for (const strategyId of STRATEGY_IDS) {
      const runtime = this.runtimeByStrategy[strategyId];
      await this.runtimeProcessor.processClosedCandle(runtime, candle, eventTsMs, timeframe);
    }
  }

  private async processClosedCandleForStrategy(
    runtime: StrategyRuntimeState,
    candle: Readonly<{ time: number; open: number; high: number; low: number; close: number }>,
    eventTsMs: number,
    timeframe: TimeframeKey = '1m'
  ): Promise<void> {
    await this.runtimeProcessor.processClosedCandle(runtime, {
      ...candle,
      volume: 0
    }, eventTsMs, timeframe);
  }

  private async processOpenCandle(candle: RuntimeCandle, eventTsMs: number, timeframe: TimeframeKey): Promise<void> {
    for (const strategyId of STRATEGY_IDS) {
      const runtime = this.runtimeByStrategy[strategyId];
      await this.runtimeProcessor.processCandleOpen(runtime, candle, eventTsMs, timeframe);
    }
  }

  private async emitSemiAutoApprovedEntry(
    runtime: StrategyRuntimeState,
    candle: Readonly<{ time: number; open: number; high: number; low: number; close: number }>,
    eventTsMs: number
  ): Promise<void> {
    await this.runtimeProcessor.emitSemiAutoApprovedEntry(runtime, {
      ...candle,
      volume: 0
    }, eventTsMs);
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

  private async hydrateRuntimeRecentCandles(runtime: StrategyRuntimeState): Promise<void> {
    const candles = await this.runsService.getCandles(runtime.runId, 400);
    if (!candles || candles.length === 0) {
      return;
    }

    const recentCandles = candles.slice(-400).map((item) => ({
      time: item.time,
      open: item.open,
      high: item.high,
      low: item.low,
      close: item.close,
      ...(typeof item.volume === 'number' ? { volume: item.volume } : {})
    }));
    const candles15m: RuntimeCandle[] = [];
    const candles1h: RuntimeCandle[] = [];
    let state15m = this.candleState15m;
    let state1h = this.candleState1h;

    for (const candle of recentCandles) {
      const fifteen = updateAggregatedCandle(state15m, candle, '15m');
      state15m = fifteen.nextState;
      if (fifteen.closed) {
        candles15m.push({
          ...fifteen.closed,
          volume: fifteen.closed.volume ?? 0
        });
      }

      const oneHour = updateAggregatedCandle(state1h, candle, '1h');
      state1h = oneHour.nextState;
      if (oneHour.closed) {
        candles1h.push({
          ...oneHour.closed,
          volume: oneHour.closed.volume ?? 0
        });
      }
    }

    runtime.strategyState = {
      ...runtime.strategyState,
      recentCandles,
      candles15m,
      candles1h
    };
    this.candleState15m = state15m;
    this.candleState1h = state1h;
  }

  private async bootstrapMinuteCandles(isCancelled?: () => boolean): Promise<boolean> {
    try {
      const candles = await this.upbitClient.getMinuteCandles(this.market, 1, 200);
      if (isCancelled?.()) {
        return false;
      }
      const asc = [...candles].sort((a, b) => resolveSnapshotBucketMs(a) - resolveSnapshotBucketMs(b));
      for (const candle of asc) {
        if (isCancelled?.()) {
          return false;
        }
        await this.emitSnapshotCandle(candle);
      }

      if (isCancelled?.()) {
        return false;
      }
      this.logger.info('Upbit candle snapshot loaded', {
        source: 'modules.execution.upbitRealtime.bootstrapMinuteCandles',
        runId: this.primaryRunId(),
        payload: { market: this.market, count: asc.length }
      });
      return true;
    } catch (error: unknown) {
      this.logger.warn('Failed to load Upbit candle snapshot', {
        source: 'modules.execution.upbitRealtime.bootstrapMinuteCandles',
        runId: this.primaryRunId(),
        payload: { market: this.market, reason: error instanceof Error ? error.message : 'unknown' }
      });
      return false;
    }
  }

  private async bootstrapMinuteCandlesWithTimeout(): Promise<boolean> {
    const timeoutMs = 7000;
    let cancelled = false;
    let completed = false;
    let snapshotLoaded = false;
    const bootstrapPromise = this.bootstrapMinuteCandles(() => cancelled)
      .then((loaded) => {
        snapshotLoaded = loaded;
      })
      .finally(() => {
        completed = true;
      });

    await Promise.race([
      bootstrapPromise,
      new Promise<void>((resolve) => {
        setTimeout(resolve, timeoutMs);
      })
    ]);

    if (!completed) {
      cancelled = true;
      this.candleState = undefined;
      this.logger.warn('Skipped waiting for candle snapshot due startup timeout', {
        source: 'modules.execution.upbitRealtime.bootstrapMinuteCandlesWithTimeout',
        runId: this.primaryRunId(),
        payload: { timeoutMs, market: this.market }
      });
      return false;
    }

    return snapshotLoaded;
  }

  private async emitSnapshotCandle(candle: UpbitMinuteCandleDto): Promise<void> {
    const nextCandleState = snapshotToCandleState(candle);
    const bucketMs = nextCandleState.bucketMs;
    if (this.candleState && bucketMs < this.candleState.bucketMs) {
      this.logger.warn('Ignored stale snapshot candle after live state advanced', {
        source: 'modules.execution.upbitRealtime.emitSnapshotCandle',
        eventType: SYSTEM_EVENT_TYPE.ENGINE_STATE_INVALID,
        runId: this.primaryRunId(),
        payload: {
          snapshotBucket: new Date(bucketMs).toISOString(),
          currentBucket: new Date(this.candleState.bucketMs).toISOString()
        }
      });
      return;
    }
    this.candleState = nextCandleState;
    const runtimeCandle = toRuntimeCandle(nextCandleState);

    for (const strategyId of STRATEGY_IDS) {
      const runtime = this.runtimeByStrategy[strategyId];
      runtime.strategyState = {
        ...runtime.strategyState,
        recentCandles: [...runtime.strategyState.recentCandles, runtimeCandle].slice(-400)
      };
      await this.gateway.ingestEngineEvent({
        runId: runtime.runId,
        seq: this.nextSeq(runtime),
        traceId: crypto.randomUUID(),
        eventType: 'MARKET_TICK',
        eventTs: new Date(bucketMs).toISOString(),
        payload: {
          market: this.market,
          strategyId: runtime.strategyId,
          strategyVersion: this.strategyVersion,
          strategyName: runtime.strategyName,
          source: 'CANDLE_SNAPSHOT',
          candle: runtimeCandle
        }
      });
    }
  }

  private buildMarketTickEvent(
    runtime: StrategyRuntimeState,
    eventTsMs: number,
    candle: RuntimeCandle,
    tick: RealtimePriceTick,
    change?: string
  ): WsEventEnvelopeDto {
    return {
      runId: runtime.runId,
      seq: this.nextSeq(runtime),
      traceId: crypto.randomUUID(),
      eventType: 'MARKET_TICK',
      eventTs: new Date(eventTsMs).toISOString(),
      payload: {
        market: tick.market,
        strategyId: runtime.strategyId,
        strategyVersion: this.strategyVersion,
        strategyName: runtime.strategyName,
        tradePrice: tick.price,
        tradeVolume: tick.volume ?? 0,
        askBid: tick.askBid ?? 'UNKNOWN',
        change: change ?? 'UNKNOWN',
        bestBidPrice: tick.bestBidPrice,
        bestAskPrice: tick.bestAskPrice,
        candle
      }
    };
  }

  private toRealtimeTick(message: UpbitTradeMessage, tsMs: number): RealtimePriceTick {
    return {
      market: message.code ?? this.market,
      price: message.trade_price ?? 0,
      volume: message.trade_volume ?? 0,
      askBid: message.ask_bid,
      tsMs,
      ...(typeof message.best_bid_price === 'number'
        ? { bestBidPrice: message.best_bid_price }
        : (this.latestOrderbook ? { bestBidPrice: this.latestOrderbook.bidPrice } : {})),
      ...(typeof message.best_ask_price === 'number'
        ? { bestAskPrice: message.best_ask_price }
        : (this.latestOrderbook ? { bestAskPrice: this.latestOrderbook.askPrice } : {}))
    };
  }

  private async emitStrategyEvent(
    runtime: StrategyRuntimeState,
    eventType: string,
    eventTsMs: number,
    candle: RuntimeCandle,
    payload: Readonly<Record<string, unknown>>
  ): Promise<void> {
    await this.gateway.ingestEngineEvent({
      runId: runtime.runId,
      seq: this.nextSeq(runtime),
      traceId: crypto.randomUUID(),
      eventType,
      eventTs: new Date(eventTsMs).toISOString(),
      payload: {
        market: this.market,
        candle,
        strategyId: runtime.strategyId,
        strategyVersion: this.strategyVersion,
        strategyName: runtime.strategyName,
        ...payload
      }
    });
  }

  private nextSeq(runtime: StrategyRuntimeState): number {
    runtime.seq += 1;
    return runtime.seq;
  }

  private primaryRunId(): string {
    return this.runtimeByStrategy.STRAT_B.runId;
  }

  private markAllRunsSnapshotDelay(delayed: boolean): void {
    for (const strategyId of STRATEGY_IDS) {
      const runtime = this.runtimeByStrategy[strategyId];
      this.runsService.setSnapshotDelay(runtime.runId, delayed);
    }
  }

  private clearSnapshotDelayAfterLiveTrade(): void {
    if (!this.snapshotRecoveryPending) {
      return;
    }

    this.snapshotRecoveryPending = false;
    this.markAllRunsSnapshotDelay(false);
    this.logger.info('Runtime snapshot delay cleared by live trade recovery', {
      source: 'modules.execution.upbitRealtime.handleMessage',
      runId: this.primaryRunId(),
      payload: { market: this.market }
    });
  }

  private applyTransportStateToAllRuns(input: Readonly<{
    connectionState: ConnectionState;
    retryCount?: number;
    nextRetryInMs?: number;
  }>): void {
    for (const strategyId of STRATEGY_IDS) {
      const runtime = this.runtimeByStrategy[strategyId];
      this.runsService.setTransportState(runtime.runId, input.connectionState, {
        ...(typeof input.retryCount === 'number' ? { retryCount: input.retryCount } : {}),
        ...(typeof input.nextRetryInMs === 'number' ? { nextRetryInMs: input.nextRetryInMs } : {})
      });
    }
  }
}
