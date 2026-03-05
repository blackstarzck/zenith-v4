import { Controller, Get } from '@nestjs/common';
import { RuntimeMetricsService } from './runtime-metrics.service';

@Controller('ops')
export class OpsController {
  constructor(private readonly metrics: RuntimeMetricsService) {}

  @Get('metrics')
  getMetrics() {
    return this.metrics.snapshot();
  }
}
