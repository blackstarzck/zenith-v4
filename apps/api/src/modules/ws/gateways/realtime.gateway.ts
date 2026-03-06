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

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/runs'
})
@Injectable()
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  private server?: Server;

  constructor(
    private readonly logger: SystemEventLogger,
    private readonly metrics: RuntimeMetricsService,
    private readonly db: SupabaseClientService,
    private readonly sequenceGuard: SequenceGuardService,
    private readonly runsService: RunsService
  ) {}

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
    this.metrics.markEvent(event.eventType, event.eventTs);
    const accepted = this.sequenceGuard.accept(event.runId, event.seq, 'modules.ws.realtime.ingestEngineEvent');
    if (accepted === 'duplicate') {
      return;
    }

    const mismatches = this.runsService.validateEventAgainstRunConfig(event);
    if (mismatches.length > 0) {
      this.metrics.markRunConfigMismatch();
      this.logger.warn('Event payload mismatches runConfig snapshot', {
        source: 'modules.ws.realtime.ingestEngineEvent',
        eventType: SYSTEM_EVENT_TYPE.ENGINE_STATE_INVALID,
        runId: event.runId,
        traceId: event.traceId,
        payload: { seq: event.seq, eventType: event.eventType, mismatches }
      });
      if (process.env.RUNCONFIG_MISMATCH_BLOCK === 'true') {
        const pauseEvent: WsEventEnvelopeDto = {
          runId: event.runId,
          seq: event.seq,
          traceId: event.traceId,
          eventType: 'PAUSE',
          eventTs: event.eventTs,
          payload: {
            reason: 'RUNCONFIG_MISMATCH_BLOCKED',
            blockedEventType: event.eventType,
            mismatches
          }
        };

        await this.persistAndPublish(pauseEvent);
        this.logger.error('Blocked event by RUNCONFIG_MISMATCH_BLOCK guard', {
          source: 'modules.ws.realtime.ingestEngineEvent',
          eventType: SYSTEM_EVENT_TYPE.ENGINE_STATE_INVALID,
          runId: event.runId,
          traceId: event.traceId,
          payload: { seq: event.seq, eventType: event.eventType }
        });
        return;
      }
    }

    await this.persistAndPublish(event);
  }

  private async persistAndPublish(event: WsEventEnvelopeDto): Promise<void> {
    this.runsService.ingestEvent(event);
    const persisted = await this.db.safeInsertRunEvent(event);
    if (!persisted.ok) {
      this.metrics.markDbWriteFailure();
      this.logger.warn('Event persistence skipped; runtime loop continues', {
        source: 'modules.ws.realtime.ingestEngineEvent',
        eventType: SYSTEM_EVENT_TYPE.DB_WRITE_FAILED,
        runId: event.runId,
        traceId: event.traceId,
        payload: { seq: event.seq, reason: persisted.reason }
      });
      return;
    }

    this.pushToSubscribers(event);
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
}
