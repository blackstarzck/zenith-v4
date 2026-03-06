import { Global, Module } from '@nestjs/common';
import { ExecutionModule } from '../execution/execution.module';
import { OpsController } from './ops.controller';
import { RuntimeMetricsService } from './runtime-metrics.service';
import { SystemEventLogger } from './system-events/system-event.logger';

@Global()
@Module({
  imports: [ExecutionModule],
  controllers: [OpsController],
  providers: [SystemEventLogger, RuntimeMetricsService],
  exports: [SystemEventLogger, RuntimeMetricsService]
})
export class ObservabilityModule {}
