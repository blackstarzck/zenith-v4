import { Module } from '@nestjs/common';
import { ExecutionModule } from './modules/execution/execution.module';
import { ObservabilityModule } from './modules/observability/observability.module';
import { ResilienceModule } from './modules/resilience/resilience.module';
import { RunsModule } from './modules/runs/runs.module';
import { SupabaseModule } from './modules/supabase/supabase.module';
import { WsModule } from './modules/ws/ws.module';

@Module({
  imports: [ObservabilityModule, ResilienceModule, RunsModule, SupabaseModule, WsModule, ExecutionModule]
})
export class AppModule {}
