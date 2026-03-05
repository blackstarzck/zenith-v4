import { Module } from '@nestjs/common';
import { UpbitRealtimeEngine } from './engine/upbit-realtime-engine';
import { UpbitMarketClient } from './upbit.market.client';
import { WsModule } from '../ws/ws.module';

@Module({
  imports: [WsModule],
  providers: [UpbitRealtimeEngine, UpbitMarketClient]
})
export class ExecutionModule {}
