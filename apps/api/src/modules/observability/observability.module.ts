import { Global, Module } from '@nestjs/common';
import { OpsController } from './ops.controller';
import { RuntimeMetricsService } from './runtime-metrics.service';
import { SystemEventLogger } from './system-events/system-event.logger';

@Global()
@Module({
  controllers: [OpsController],
  providers: [SystemEventLogger, RuntimeMetricsService],
  exports: [SystemEventLogger, RuntimeMetricsService]
})
export class ObservabilityModule {}
