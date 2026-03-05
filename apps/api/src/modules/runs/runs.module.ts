import { Global, Module } from '@nestjs/common';
import { RunsController } from './runs.controller';
import { RunsService } from './runs.service';

@Global()
@Module({
  providers: [RunsService],
  controllers: [RunsController],
  exports: [RunsService]
})
export class RunsModule {}
