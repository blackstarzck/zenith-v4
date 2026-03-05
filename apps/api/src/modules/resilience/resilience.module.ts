import { Global, Module } from '@nestjs/common';
import { NetworkGuardService } from './guards/network-guard';
import { RetryPolicyService } from './policies/retry.policy';
import { SequenceGuardService } from './idempotency/sequence-guard';

@Global()
@Module({
  providers: [RetryPolicyService, SequenceGuardService, NetworkGuardService],
  exports: [RetryPolicyService, SequenceGuardService, NetworkGuardService]
})
export class ResilienceModule {}
