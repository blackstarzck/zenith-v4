import { Body, Controller, Get, Header, NotFoundException, Param, Patch, Query } from '@nestjs/common';
import { RunsService } from './runs.service';

@Controller('runs')
export class RunsController {
  constructor(private readonly runsService: RunsService) {}

  @Get('history')
  getHistory() {
    return this.runsService.listRuns();
  }

  @Get(':runId')
  getRun(@Param('runId') runId: string) {
    const run = this.runsService.getRun(runId);
    if (!run) {
      throw new NotFoundException('run not found');
    }
    return run;
  }

  @Get(':runId/events.jsonl')
  @Header('Content-Type', 'application/x-ndjson; charset=utf-8')
  getEventsJsonl(@Param('runId') runId: string) {
    const content = this.runsService.getEventsJsonl(runId);
    if (content === undefined) {
      throw new NotFoundException('run not found');
    }
    return content;
  }

  @Get(':runId/trades.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  getTradesCsv(@Param('runId') runId: string) {
    const content = this.runsService.getTradesCsv(runId);
    if (content === undefined) {
      throw new NotFoundException('run not found');
    }
    return content;
  }

  @Get(':runId/candles')
  getCandles(
    @Param('runId') runId: string,
    @Query('limit') limitText?: string
  ) {
    const limit = Number(limitText ?? '300');
    const candles = this.runsService.getCandles(runId, Number.isFinite(limit) ? limit : 300);
    if (candles === undefined) {
      throw new NotFoundException('run not found');
    }
    return candles;
  }

  @Patch(':runId/control')
  updateRunControl(
    @Param('runId') runId: string,
    @Body()
    body: Readonly<{
      strategyId?: 'STRAT_A' | 'STRAT_B' | 'STRAT_C';
      mode?: 'PAPER' | 'SEMI_AUTO' | 'AUTO' | 'LIVE';
      market?: string;
      fillModelRequested?: 'AUTO' | 'NEXT_OPEN' | 'ON_CLOSE';
      fillModelApplied?: 'NEXT_OPEN' | 'ON_CLOSE';
      entryPolicy?: string;
    }>
  ) {
    const updated = this.runsService.updateRunControl(runId, body);
    if (!updated) {
      throw new NotFoundException('run not found');
    }
    return updated;
  }
}
