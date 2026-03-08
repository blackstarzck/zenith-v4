import { SYSTEM_EVENT_TYPE, type WsEventEnvelopeDto } from '@zenith/contracts';
import { Injectable } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { SupabaseClientService } from '../../../infra/db/supabase/client/supabase.client';
import { SystemEventLogger } from '../../observability/system-events/system-event.logger';
import { RuntimeMetricsService } from '../../observability/runtime-metrics.service';
import { SequenceGuardService } from '../../resilience/idempotency/sequence-guard';
import { RunsService } from '../../runs/runs.service';
import { RunEventPersistenceBuffer } from './run-event-persistence-buffer';

const STRATEGY_RUN_ID: Readonly<Record<'STRAT_A' | 'STRAT_B' | 'STRAT_C', string>> = {
  STRAT_A: 'run-strat-a-0001',
  STRAT_B: 'run-strat-b-0001',
  STRAT_C: 'run-strat-c-0001'
};

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/runs'
})
@Injectable()
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  private server?: Server;
  private readonly persistenceBuffer: RunEventPersistenceBuffer;

  constructor(
    private readonly logger: SystemEventLogger,
    private readonly metrics: RuntimeMetricsService,
    private readonly db: SupabaseClientService,
    private readonly sequenceGuard: SequenceGuardService,
    private readonly runsService: RunsService
  ) {
    this.persistenceBuffer = new RunEventPersistenceBuffer({
      persist: (event) => this.db.safeInsertRunEvent(event),
      publish: (event) => this.pushToSubscribers(event),
      logger: this.logger,
      metrics: this.metrics,
      runsService: this.runsService
    });
  }

  handleConnection(client: Socket): void {
    this.metrics.markWsConnection();
    this.logger.info('WS client connected', {
      source: 'modules.ws.realtime.handleConnection',
      eventType: SYSTEM_EVENT_TYPE.CIRCUIT_CLOSED,
      payload: { socketId: client.id }
    });
  }

  handleDisconnect(client: Socket): void {
    this.metrics.markWsDisconnection();
    this.logger.warn('WS client disconnected', {
      source: 'modules.ws.realtime.handleDisconnect',
      eventType: SYSTEM_EVENT_TYPE.WS_CLIENT_DROPPED,
      payload: { socketId: client.id }
    });
  }

  async ingestEngineEvent(event: WsEventEnvelopeDto): Promise<void> {
    const normalizedEvent = this.normalizeRunIdByStrategy(event);
    this.metrics.markEvent(normalizedEvent.eventType, normalizedEvent.eventTs);
    const accepted = this.sequenceGuard.accept(normalizedEvent.runId, normalizedEvent.seq, 'modules.ws.realtime.ingestEngineEvent');
    if (accepted === 'duplicate') {
      return;
    }

    const mismatches = this.runsService.validateEventAgainstRunConfig(normalizedEvent);
    if (mismatches.length > 0) {
      this.metrics.markRunConfigMismatch();
      this.logger.warn('Event payload mismatches runConfig snapshot', {
        source: 'modules.ws.realtime.ingestEngineEvent',
        eventType: SYSTEM_EVENT_TYPE.ENGINE_STATE_INVALID,
        runId: normalizedEvent.runId,
        traceId: normalizedEvent.traceId,
        payload: { seq: normalizedEvent.seq, eventType: normalizedEvent.eventType, mismatches }
      });
      if (process.env.RUNCONFIG_MISMATCH_BLOCK === 'true') {
        const pauseEvent: WsEventEnvelopeDto = {
          runId: normalizedEvent.runId,
          seq: normalizedEvent.seq,
          traceId: normalizedEvent.traceId,
          eventType: 'PAUSE',
          eventTs: normalizedEvent.eventTs,
          payload: {
            reason: 'RUNCONFIG_MISMATCH_BLOCKED',
            blockedEventType: normalizedEvent.eventType,
            mismatches
          }
        };

        await this.persistAndPublish(pauseEvent);
        this.logger.error('Blocked event by RUNCONFIG_MISMATCH_BLOCK guard', {
          source: 'modules.ws.realtime.ingestEngineEvent',
          eventType: SYSTEM_EVENT_TYPE.ENGINE_STATE_INVALID,
          runId: normalizedEvent.runId,
          traceId: normalizedEvent.traceId,
          payload: { seq: normalizedEvent.seq, eventType: normalizedEvent.eventType }
        });
        return;
      }
    }

    await this.persistAndPublish(normalizedEvent);
  }

  private async persistAndPublish(event: WsEventEnvelopeDto): Promise<void> {
    this.runsService.ingestEvent(event);
    await this.persistenceBuffer.enqueue(event);
  }

  private pushToSubscribers(event: WsEventEnvelopeDto): void {
    try {
      this.server?.emit('run-event', event);
    } catch (error: unknown) {
      this.metrics.markWsPushFailure();
      this.logger.warn('WS serialization or send failed', {
        source: 'modules.ws.realtime.pushToSubscribers',
        eventType: SYSTEM_EVENT_TYPE.WS_SERIALIZE_FAILED,
        runId: event.runId,
        traceId: event.traceId,
        payload: { reason: error instanceof Error ? error.message : 'unknown' }
      });
    }
  }

  private normalizeRunIdByStrategy(event: WsEventEnvelopeDto): WsEventEnvelopeDto {
    const payload = event.payload as Readonly<Record<string, unknown>>;
    const strategyId = payload.strategyId;
    if (strategyId !== 'STRAT_A' && strategyId !== 'STRAT_B' && strategyId !== 'STRAT_C') {
      return event;
    }
    const runId = STRATEGY_RUN_ID[strategyId];
    if (event.runId === runId) {
      return event;
    }
    return {
      ...event,
      runId
    };
  }
}
