import { Injectable } from '@nestjs/common';

type RuntimeMetrics = Readonly<{
  wsConnections: number;
  wsDisconnections: number;
  wsActiveClients: number;
  eventsIngested: number;
  marketTicks: number;
  signals: number;
  fills: number;
  exits: number;
  dbWriteFailures: number;
  wsPushFailures: number;
  runConfigMismatches: number;
  upbitReconnectAttempts: number;
  upbitReconnectRecoveries: number;
  upbitAvgRecoveryMs: number;
  lastDisconnectAt?: string;
  lastEventAt?: string;
}>;

@Injectable()
export class RuntimeMetricsService {
  private wsConnections = 0;
  private wsDisconnections = 0;
  private wsActiveClients = 0;
  private eventsIngested = 0;
  private marketTicks = 0;
  private signals = 0;
  private fills = 0;
  private exits = 0;
  private dbWriteFailures = 0;
  private wsPushFailures = 0;
  private runConfigMismatches = 0;
  private upbitReconnectAttempts = 0;
  private upbitReconnectRecoveries = 0;
  private upbitRecoveryMsTotal = 0;
  private lastDisconnectAt: string | undefined;
  private lastEventAt: string | undefined;

  markWsConnection(): void {
    this.wsConnections += 1;
    this.wsActiveClients += 1;
  }

  markWsDisconnection(): void {
    this.wsDisconnections += 1;
    this.wsActiveClients = Math.max(0, this.wsActiveClients - 1);
    this.lastDisconnectAt = new Date().toISOString();
  }

  markEvent(eventType: string, eventTs: string): void {
    this.eventsIngested += 1;
    this.lastEventAt = eventTs;
    if (eventType === 'MARKET_TICK') this.marketTicks += 1;
    if (eventType === 'SIGNAL_EMIT') this.signals += 1;
    if (eventType === 'FILL') this.fills += 1;
    if (eventType === 'EXIT') this.exits += 1;
  }

  markDbWriteFailure(): void {
    this.dbWriteFailures += 1;
  }

  markWsPushFailure(): void {
    this.wsPushFailures += 1;
  }

  markRunConfigMismatch(): void {
    this.runConfigMismatches += 1;
  }

  markUpbitReconnectAttempt(): void {
    this.upbitReconnectAttempts += 1;
  }

  markUpbitReconnectRecovered(recoveryMs: number): void {
    this.upbitReconnectRecoveries += 1;
    this.upbitRecoveryMsTotal += Math.max(0, recoveryMs);
  }

  snapshot(): RuntimeMetrics {
    return {
      wsConnections: this.wsConnections,
      wsDisconnections: this.wsDisconnections,
      wsActiveClients: this.wsActiveClients,
      eventsIngested: this.eventsIngested,
      marketTicks: this.marketTicks,
      signals: this.signals,
      fills: this.fills,
      exits: this.exits,
      dbWriteFailures: this.dbWriteFailures,
      wsPushFailures: this.wsPushFailures,
      runConfigMismatches: this.runConfigMismatches,
      upbitReconnectAttempts: this.upbitReconnectAttempts,
      upbitReconnectRecoveries: this.upbitReconnectRecoveries,
      upbitAvgRecoveryMs: this.upbitReconnectRecoveries > 0
        ? Math.round(this.upbitRecoveryMsTotal / this.upbitReconnectRecoveries)
        : 0,
      ...(this.lastDisconnectAt ? { lastDisconnectAt: this.lastDisconnectAt } : {}),
      ...(this.lastEventAt ? { lastEventAt: this.lastEventAt } : {})
    };
  }
}
