import { SYSTEM_EVENT_TYPE } from '@zenith/contracts';
import { Injectable } from '@nestjs/common';
import { RetryPolicyService } from '../policies/retry.policy';

@Injectable()
export class NetworkGuardService {
  constructor(private readonly retryPolicy: RetryPolicyService) {}

  async guardedNetworkCall<T>(source: string, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    return this.retryPolicy.runWithRetry(fn, {
      maxAttempts: 3,
      baseDelayMs: 100,
      timeoutMs: 2000,
      source,
      timeoutEventType: SYSTEM_EVENT_TYPE.EXCHANGE_TIMEOUT,
      retryFailedEventType: SYSTEM_EVENT_TYPE.EXCHANGE_RETRY_EXHAUSTED
    });
  }
}
