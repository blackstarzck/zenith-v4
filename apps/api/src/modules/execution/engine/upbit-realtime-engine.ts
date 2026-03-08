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
import { UpbitRealtimeConnection } from './upbit-realtime-connection';

type UpbitTradeMessage = Readonly<{
  code?: string;
  trade_price?: number;
  trade_volume?: number;
  ask_bid?: string;
  change?: string;
  timestamp?: number;
  trade_timestamp?: number;
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
      this.runsService.seedRun(runtime.runId, {
        strategyId: runtime.strategyId,
        strategyVersion: this.strategyVersion,
        mode: this.mode,
        market: this.market
      });
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
      const trade = JSON.parse(decoded) as UpbitTradeMessage;
      if (!trade.code || typeof trade.trade_price !== 'number') {
        return;
      }

      const tradeTsMs = trade.trade_timestamp ?? trade.timestamp ?? Date.now();
      const candleUpdate = updateOneMinuteCandle(this.candleState, tradeTsMs, trade.trade_price, trade.trade_volume ?? 0);
      this.candleState = candleUpdate.nextState;
      this.clearSnapshotDelayAfterLiveTrade();

      for (const strategyId of STRATEGY_IDS) {
        const runtime = this.runtimeByStrategy[strategyId];
        const event: WsEventEnvelopeDto = {
          runId: runtime.runId,
          seq: this.nextSeq(runtime),
          traceId: crypto.randomUUID(),
          eventType: 'MARKET_TICK',
          eventTs: new Date(tradeTsMs).toISOString(),
          payload: {
            market: trade.code,
            strategyId: runtime.strategyId,
            strategyVersion: this.strategyVersion,
            strategyName: runtime.strategyName,
            tradePrice: trade.trade_price,
            tradeVolume: trade.trade_volume ?? 0,
            askBid: trade.ask_bid ?? 'UNKNOWN',
            change: trade.change ?? 'UNKNOWN',
            candle: candleUpdate.current
          }
        };

        await this.gateway.ingestEngineEvent(event);
      }
      if (candleUpdate.closed) {
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
        await this.processClosedCandle(candleUpdate.closed, tradeTsMs);
      }
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

  private async processClosedCandle(candle: RuntimeCandle, eventTsMs: number): Promise<void> {
    for (const strategyId of STRATEGY_IDS) {
      const runtime = this.runtimeByStrategy[strategyId];
      await this.processClosedCandleForStrategy(runtime, candle, eventTsMs);
    }
  }

  private async processClosedCandleForStrategy(
    runtime: StrategyRuntimeState,
    candle: RuntimeCandle,
    eventTsMs: number
  ): Promise<void> {
    await this.runtimeProcessor.processClosedCandle(runtime, candle, eventTsMs);
  }

  private async emitEntryReadiness(
    runtime: StrategyRuntimeState,
    eventTsMs: number,
    candle: RuntimeCandle,
    payload: Readonly<{
      entryReadinessPct: number;
      entryReady: boolean;
      entryExecutable: boolean;
      reason: string;
      inPosition: boolean;
    }>
  ): Promise<void> {
    await this.emitStrategyEvent(runtime, 'ENTRY_READINESS', eventTsMs, candle, payload);
  }

  private nextSeq(runtime: StrategyRuntimeState): number {
    runtime.seq += 1;
    return runtime.seq;
  }

  private async hydrateRuntimeRecentCandles(runtime: StrategyRuntimeState): Promise<void> {
    const candles = await this.runsService.getCandles(runtime.runId, 200);
    if (!candles || candles.length === 0) {
      return;
    }

    runtime.strategyState = {
      ...runtime.strategyState,
      recentCandles: candles.slice(-200).map((item) => ({
        time: item.time,
        open: item.open,
        high: item.high,
        low: item.low,
        close: item.close
      }))
    };
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

  private async emitSemiAutoApprovedEntry(
    runtime: StrategyRuntimeState,
    candle: RuntimeCandle,
    eventTsMs: number
  ): Promise<void> {
    await this.runtimeProcessor.emitSemiAutoApprovedEntry(runtime, candle, eventTsMs);
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
