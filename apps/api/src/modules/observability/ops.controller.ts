import { Controller, Get, Post } from '@nestjs/common';
import { UpbitRealtimeEngine } from '../execution/engine/upbit-realtime-engine';
import { RuntimeMetricsService } from './runtime-metrics.service';

@Controller('ops')
export class OpsController {
  constructor(
    private readonly metrics: RuntimeMetricsService,
    private readonly upbitEngine: UpbitRealtimeEngine
  ) {}

  @Get('metrics')
  getMetrics() {
    return this.metrics.snapshot();
  }

  @Post('actions/upbit-reconnect')
  forceUpbitReconnect() {
    return this.upbitEngine.forceReconnectForTest();
  }
}
