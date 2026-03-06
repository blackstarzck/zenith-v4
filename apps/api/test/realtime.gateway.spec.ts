import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WsEventEnvelopeDto } from '@zenith/contracts';
import { RuntimeMetricsService } from '../src/modules/observability/runtime-metrics.service';
import { SequenceGuardService } from '../src/modules/resilience/idempotency/sequence-guard';
import { RunsService } from '../src/modules/runs/runs.service';
import { RealtimeGateway } from '../src/modules/ws/gateways/realtime.gateway';

class FakeLogger {
  info(): void {}
  warn(): void {}
  error(): void {}
}

test('RealtimeGateway emits PAUSE when runConfig mismatch block is enabled', async () => {
  const previous = process.env.RUNCONFIG_MISMATCH_BLOCK;
  process.env.RUNCONFIG_MISMATCH_BLOCK = 'true';

  try {
    const inserted: WsEventEnvelopeDto[] = [];
    const logger = new FakeLogger();
    const metrics = new RuntimeMetricsService();
    const sequenceGuard = new SequenceGuardService(logger as unknown as ConstructorParameters<typeof SequenceGuardService>[0]);
    const runsService = new RunsService();
    const db = {
      safeInsertRunEvent: async (event: WsEventEnvelopeDto) => {
        inserted.push(event);
        return { ok: true } as const;
      }
    };
    const gateway = new RealtimeGateway(
      logger as unknown as ConstructorParameters<typeof RealtimeGateway>[0],
      metrics,
      db as unknown as ConstructorParameters<typeof RealtimeGateway>[2],
      sequenceGuard,
      runsService
    );

    runsService.seedRun('run-mismatch', {
      strategyId: 'STRAT_B',
      strategyVersion: 'v1',
      mode: 'PAPER',
      market: 'KRW-XRP'
    });

    const event: WsEventEnvelopeDto = {
      runId: 'run-mismatch',
      seq: 1,
      traceId: 'trace-1',
      eventType: 'SIGNAL_EMIT',
      eventTs: new Date().toISOString(),
      payload: {
        strategyId: 'STRAT_A',
        strategyVersion: 'v2',
        market: 'KRW-BTC'
      }
    };

    await gateway.ingestEngineEvent(event);

    const run = runsService.getRun('run-mismatch');
    assert.equal(run?.events.length, 1);
    assert.equal(run?.events[0]?.eventType, 'PAUSE');
    assert.equal(run?.events[0]?.payload.blockedEventType, 'SIGNAL_EMIT');
    assert.equal(inserted.length, 1);
    assert.equal(inserted[0]?.eventType, 'PAUSE');
  } finally {
    if (typeof previous === 'string') {
      process.env.RUNCONFIG_MISMATCH_BLOCK = previous;
    } else {
      delete process.env.RUNCONFIG_MISMATCH_BLOCK;
    }
  }
});
