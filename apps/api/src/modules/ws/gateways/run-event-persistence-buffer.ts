import {
  SYSTEM_EVENT_TYPE,
  type WsEventEnvelopeDto
} from '@zenith/contracts';
import { RuntimeMetricsService } from '../../observability/runtime-metrics.service';
import { SystemEventLogger } from '../../observability/system-events/system-event.logger';
import { RunsService } from '../../runs/runs.service';

type PersistResult = Readonly<{
  ok: boolean;
  reason?: string;
}>;

type BufferScheduler = Readonly<{
  setTimeout: (fn: () => void, delayMs: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}>;

type BufferedRunState = {
  items: WsEventEnvelopeDto[];
  flushing: boolean;
  retryCount: number;
  nextRetryInMs: number | undefined;
  timer: unknown | undefined;
};

export type RunEventPersistenceBufferOptions = Readonly<{
  persist: (event: WsEventEnvelopeDto) => Promise<PersistResult>;
  publish: (event: WsEventEnvelopeDto) => void;
  logger: SystemEventLogger;
  metrics: RuntimeMetricsService;
  runsService: RunsService;
  scheduler?: BufferScheduler;
}>;

const DEFAULT_SCHEDULER: BufferScheduler = {
  setTimeout: (fn, delayMs) => setTimeout(fn, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout)
};

export class RunEventPersistenceBuffer {
  private readonly scheduler: BufferScheduler;
  private readonly states = new Map<string, BufferedRunState>();

  constructor(private readonly options: RunEventPersistenceBufferOptions) {
    this.scheduler = options.scheduler ?? DEFAULT_SCHEDULER;
  }

  async enqueue(event: WsEventEnvelopeDto): Promise<void> {
    const state = this.getOrCreateState(event.runId);
    state.items.push(event);
    this.syncRealtimeBacklog(event.runId, state);

    if (state.flushing || state.timer) {
      return;
    }

    await this.flush(event.runId);
  }

  private async flush(runId: string): Promise<void> {
    const state = this.states.get(runId);
    if (!state || state.flushing) {
      return;
    }
    if (state.timer) {
      this.scheduler.clearTimeout(state.timer);
      state.timer = undefined;
    }

    state.flushing = true;

    while (state.items.length > 0) {
      const event = state.items[0];
      if (!event) {
        break;
      }

      const persisted = await this.options.persist(event);
      if (!persisted.ok) {
        state.retryCount += 1;
        state.nextRetryInMs = calculateRetryDelayMs(state.retryCount);
        this.options.metrics.markDbWriteFailure();
        this.options.logger.warn('Buffered run event after persistence failure', {
          source: 'modules.ws.realtime.persistenceBuffer.flush',
          eventType: SYSTEM_EVENT_TYPE.DB_WRITE_FAILED,
          runId: event.runId,
          traceId: event.traceId,
          payload: {
            seq: event.seq,
            reason: persisted.reason ?? 'write_failed',
            queueDepth: state.items.length,
            retryCount: state.retryCount,
            nextRetryInMs: state.nextRetryInMs
          }
        });
        this.syncRealtimeBacklog(runId, state);
        state.flushing = false;
        state.timer = this.scheduler.setTimeout(() => {
          state.timer = undefined;
          void this.flush(runId);
        }, state.nextRetryInMs);
        return;
      }

      state.items.shift();
      state.retryCount = 0;
      state.nextRetryInMs = undefined;
      this.syncRealtimeBacklog(runId, state);
      this.options.publish(event);
    }

    state.flushing = false;
    this.syncRealtimeBacklog(runId, state);

    if (state.items.length === 0 && !state.timer) {
      this.states.delete(runId);
    }
  }

  private getOrCreateState(runId: string): BufferedRunState {
    const existing = this.states.get(runId);
    if (existing) {
      return existing;
    }

    const created: BufferedRunState = {
      items: [],
      flushing: false,
      retryCount: 0,
      nextRetryInMs: undefined,
      timer: undefined
    };
    this.states.set(runId, created);
    return created;
  }

  private syncRealtimeBacklog(runId: string, state: BufferedRunState): void {
    this.options.runsService.setPersistenceBacklog(runId, {
      queueDepth: state.items.length,
      retryCount: state.retryCount,
      ...(typeof state.nextRetryInMs === 'number'
        ? { nextRetryInMs: state.nextRetryInMs }
        : {})
    });
  }
}

function calculateRetryDelayMs(retryCount: number): number {
  return Math.min(30_000, 500 * 2 ** Math.min(retryCount - 1, 5));
}
