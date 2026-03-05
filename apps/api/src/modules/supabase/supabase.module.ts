import { Global, Module } from '@nestjs/common';
import { SupabaseClientService } from '../../infra/db/supabase/client/supabase.client';
import { SupabaseDiagnosticsService } from './supabase-diagnostics.service';
import { SupabaseRestClient } from './supabase-rest.client';

@Global()
@Module({
  providers: [SupabaseRestClient, SupabaseClientService, SupabaseDiagnosticsService],
  exports: [SupabaseRestClient, SupabaseClientService]
})
export class SupabaseModule {}
