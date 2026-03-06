import { SYSTEM_EVENT_TYPE } from '@zenith/contracts';
import { Injectable } from '@nestjs/common';
import { SystemEventLogger } from '../../observability/system-events/system-event.logger';

@Injectable()
export class SequenceGuardService {
  private readonly lastSeqMap = new Map<string, number>();

  accept(runId: string, seq: number, source: string): 'accepted' | 'duplicate' {
    const prev = this.lastSeqMap.get(runId) ?? 0;

    if (seq === prev) {
      return 'duplicate';
    }

    if (seq > prev + 1) {
      this.logger.warn('Out-of-order event detected', {
        source,
        eventType: SYSTEM_EVENT_TYPE.EVENT_OUT_OF_ORDER,
        runId,
        payload: { prev, seq }
      });
    }

    this.lastSeqMap.set(runId, seq);
    return 'accepted';
  }

  constructor(private readonly logger: SystemEventLogger) {}
}
