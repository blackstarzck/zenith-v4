import {
  SYSTEM_EVENT_LEVEL,
  SYSTEM_EVENT_TYPE,
  type SystemEventDto,
  type SystemEventLevel,
  type SystemEventType
} from '@zenith/contracts';
import { Injectable } from '@nestjs/common';

type LogInput = Readonly<{
  source: string;
  eventType?: SystemEventType;
  runId?: string;
  traceId?: string;
  payload?: Readonly<Record<string, unknown>>;
}>;

@Injectable()
export class SystemEventLogger {
  emit(level: SystemEventLevel, message: string, input: LogInput): void {
    const event: SystemEventDto = {
      ts: new Date().toISOString(),
      level,
      eventType: input.eventType ?? SYSTEM_EVENT_TYPE.CIRCUIT_CLOSED,
      message,
      traceId: input.traceId ?? crypto.randomUUID(),
      source: input.source,
      ...(input.runId ? { runId: input.runId } : {}),
      ...(input.payload ? { payload: input.payload } : {})
    };

    const line = JSON.stringify(event);
    if (level === SYSTEM_EVENT_LEVEL.ERROR || level === SYSTEM_EVENT_LEVEL.FATAL) {
      console.error(line);
      return;
    }
    console.log(line);
  }

  info(message: string, input: LogInput): void {
    this.emit(SYSTEM_EVENT_LEVEL.INFO, message, input);
  }

  warn(message: string, input: LogInput): void {
    this.emit(SYSTEM_EVENT_LEVEL.WARN, message, input);
  }

  error(message: string, input: LogInput): void {
    this.emit(SYSTEM_EVENT_LEVEL.ERROR, message, input);
  }
}
