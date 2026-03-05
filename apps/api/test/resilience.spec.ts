import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { SequenceGuardService } from '../src/modules/resilience/idempotency/sequence-guard';
import { RetryPolicyService } from '../src/modules/resilience/policies/retry.policy';

class FakeLogger {
  info(): void {}
  warn(): void {}
  error(): void {}
}

test('SequenceGuardService handles duplicate and out-of-order safely', () => {
  const logger = new FakeLogger() as unknown as ConstructorParameters<typeof SequenceGuardService>[0];
  const guard = new SequenceGuardService(logger);

  const first = guard.accept('run-1', 1, 'test');
  const duplicate = guard.accept('run-1', 1, 'test');
  const outOfOrder = guard.accept('run-1', 4, 'test');

  assert.equal(first, 'accepted');
  assert.equal(duplicate, 'duplicate');
  assert.equal(outOfOrder, 'accepted');
});

test('RetryPolicyService retries and then succeeds', async () => {
  const logger = new FakeLogger() as unknown as ConstructorParameters<typeof RetryPolicyService>[0];
  const retry = new RetryPolicyService(logger);
  let called = 0;

  const result = await retry.runWithRetry(async () => {
    called += 1;
    if (called < 3) {
      throw new Error('transient');
    }
    return 'ok';
  }, {
    maxAttempts: 3,
    baseDelayMs: 1,
    timeoutMs: 100,
    source: 'test.retry',
    timeoutEventType: 'SUPABASE_TIMEOUT',
    retryFailedEventType: 'SUPABASE_WRITE_FAILED'
  });

  assert.equal(result, 'ok');
  assert.equal(called, 3);
});
