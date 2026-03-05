import type { SystemEventLevel, SystemEventType } from './system-event-type';

export type SystemEventDto = Readonly<{
  ts: string;
  level: SystemEventLevel;
  eventType: SystemEventType;
  message: string;
  runId?: string;
  strategyId?: 'STRAT_A' | 'STRAT_B' | 'STRAT_C';
  mode?: 'PAPER' | 'SEMI_AUTO' | 'AUTO' | 'LIVE';
  fillModelApplied?: 'NEXT_OPEN' | 'ON_CLOSE' | 'NEXT_MINUTE_OPEN' | 'INTRABAR_APPROX';
  traceId: string;
  spanId?: string;
  source: string;
  payload?: Readonly<Record<string, unknown>>;
}>;
