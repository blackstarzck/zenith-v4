import { Injectable } from '@nestjs/common';

type RuntimeMetrics = Readonly<{
  wsConnections: number;
  wsDisconnections: number;
  eventsIngested: number;
  marketTicks: number;
  signals: number;
  fills: number;
  exits: number;
  lastEventAt?: string;
}>;

@Injectable()
export class RuntimeMetricsService {
  private wsConnections = 0;
  private wsDisconnections = 0;
  private eventsIngested = 0;
  private marketTicks = 0;
  private signals = 0;
  private fills = 0;
  private exits = 0;
  private lastEventAt: string | undefined;

  markWsConnection(): void {
    this.wsConnections += 1;
  }

  markWsDisconnection(): void {
    this.wsDisconnections += 1;
  }

  markEvent(eventType: string, eventTs: string): void {
    this.eventsIngested += 1;
    this.lastEventAt = eventTs;
    if (eventType === 'MARKET_TICK') this.marketTicks += 1;
    if (eventType === 'SIGNAL_EMIT') this.signals += 1;
    if (eventType === 'FILL') this.fills += 1;
    if (eventType === 'EXIT') this.exits += 1;
  }

  snapshot(): RuntimeMetrics {
    return {
      wsConnections: this.wsConnections,
      wsDisconnections: this.wsDisconnections,
      eventsIngested: this.eventsIngested,
      marketTicks: this.marketTicks,
      signals: this.signals,
      fills: this.fills,
      exits: this.exits,
      ...(this.lastEventAt ? { lastEventAt: this.lastEventAt } : {})
    };
  }
}
