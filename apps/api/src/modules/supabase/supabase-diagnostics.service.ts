import { SYSTEM_EVENT_TYPE } from '@zenith/contracts';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { AxiosError } from 'axios';
import { SystemEventLogger } from '../observability/system-events/system-event.logger';
import { RetryPolicyService } from '../resilience/policies/retry.policy';
import { SupabaseRestClient } from './supabase-rest.client';

@Injectable()
export class SupabaseDiagnosticsService implements OnModuleInit {
  constructor(
    private readonly restClient: SupabaseRestClient,
    private readonly retryPolicy: RetryPolicyService,
    private readonly logger: SystemEventLogger
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.retryPolicy.runWithRetry(
        async (signal) => {
          await this.restClient.get('text_run_events?select=id&limit=1', signal);
        },
        {
          maxAttempts: 2,
          baseDelayMs: 100,
          timeoutMs: 2000,
          source: 'modules.supabase.diagnostics.onModuleInit',
          timeoutEventType: SYSTEM_EVENT_TYPE.SUPABASE_TIMEOUT,
          retryFailedEventType: SYSTEM_EVENT_TYPE.SUPABASE_WRITE_FAILED
        }
      );

      this.logger.info('Supabase diagnostics passed', {
        source: 'modules.supabase.diagnostics.onModuleInit',
        eventType: SYSTEM_EVENT_TYPE.CIRCUIT_CLOSED,
        payload: {
          check: 'text_run_events_select'
        }
      });
    } catch (error: unknown) {
      const axiosError = error instanceof AxiosError ? error : undefined;
      const body = (axiosError?.response?.data ?? {}) as Record<string, unknown>;

      this.logger.error('Supabase diagnostics failed', {
        source: 'modules.supabase.diagnostics.onModuleInit',
        eventType: SYSTEM_EVENT_TYPE.SUPABASE_WRITE_FAILED,
        payload: {
          status: axiosError?.response?.status,
          code: body.code,
          message: body.message,
          hint: body.hint,
          reason: error instanceof Error ? error.message : 'unknown'
        }
      });
    }
  }
}
