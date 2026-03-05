import { SYSTEM_EVENT_TYPE } from '@zenith/contracts';
import { Injectable } from '@nestjs/common';
import { AxiosError } from 'axios';
import { SystemEventLogger } from '../../observability/system-events/system-event.logger';

type RetryOptions = Readonly<{
  maxAttempts: number;
  baseDelayMs: number;
  timeoutMs: number;
  source: string;
  timeoutEventType: typeof SYSTEM_EVENT_TYPE.SUPABASE_TIMEOUT | typeof SYSTEM_EVENT_TYPE.EXCHANGE_TIMEOUT;
  retryFailedEventType: typeof SYSTEM_EVENT_TYPE.SUPABASE_WRITE_FAILED | typeof SYSTEM_EVENT_TYPE.EXCHANGE_RETRY_EXHAUSTED;
  isNonRetriable?: (error: unknown) => boolean;
}>; 

@Injectable()
export class RetryPolicyService {
  constructor(private readonly logger: SystemEventLogger) {}

  async runWithRetry<T>(fn: (signal: AbortSignal) => Promise<T>, options: RetryOptions): Promise<T> {
    let attempt = 0;

    while (attempt < options.maxAttempts) {
      attempt += 1;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), options.timeoutMs);

      try {
        const result = await fn(ctrl.signal);
        clearTimeout(timer);
        return result;
      } catch (error: unknown) {
        clearTimeout(timer);
        if (options.isNonRetriable?.(error) === true) {
          throw error;
        }

        const isAbort = error instanceof Error && error.name === 'AbortError';
        const axiosError = toAxiosError(error);
        const status = axiosError?.response?.status;
        const body = (axiosError?.response?.data ?? {}) as Record<string, unknown>;
        const reason = error instanceof Error ? error.message : 'unknown';
        const nonRetriableClientError = typeof status === 'number' && status >= 400 && status < 500 && status !== 429;

        this.logger.warn(isAbort ? 'Request timeout' : 'Request failed', {
          source: options.source,
          eventType: isAbort ? options.timeoutEventType : SYSTEM_EVENT_TYPE.SUPABASE_WRITE_RETRY,
          payload: {
            attempt,
            maxAttempts: options.maxAttempts,
            reason,
            ...(typeof status === 'number' ? { status } : {}),
            ...(typeof body.code === 'string' ? { code: body.code } : {}),
            ...(typeof body.message === 'string' ? { responseMessage: body.message } : {}),
            ...(typeof body.hint === 'string' ? { hint: body.hint } : {})
          }
        });

        if (nonRetriableClientError || attempt >= options.maxAttempts) {
          this.logger.error('Retry exhausted', {
            source: options.source,
            eventType: options.retryFailedEventType,
            payload: {
              attempt,
              maxAttempts: options.maxAttempts,
              ...(nonRetriableClientError ? { nonRetriableClientError: true } : {})
            }
          });
          throw error;
        }

        const backoff = options.baseDelayMs * 2 ** (attempt - 1);
        const jitter = Math.floor(Math.random() * 100);
        await sleep(backoff + jitter);
      }
    }

    throw new Error('Retry failed unexpectedly');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toAxiosError(error: unknown): AxiosError | undefined {
  return error instanceof AxiosError ? error : undefined;
}
