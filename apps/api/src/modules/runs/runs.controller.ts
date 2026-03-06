import { Body, Controller, Get, Header, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { RunsService } from './runs.service';

@Controller('runs')
export class RunsController {
  constructor(private readonly runsService: RunsService) {}

  @Get('history')
  getHistory(
    @Query('strategyId') strategyId?: 'STRAT_A' | 'STRAT_B' | 'STRAT_C',
    @Query('strategyVersion') strategyVersion?: string,
    @Query('mode') mode?: 'PAPER' | 'SEMI_AUTO' | 'AUTO' | 'LIVE',
    @Query('market') market?: string,
    @Query('from') from?: string,
    @Query('to') to?: string
  ) {
    return this.runsService.listRuns({
      ...(strategyId ? { strategyId } : {}),
      ...(strategyVersion ? { strategyVersion } : {}),
      ...(mode ? { mode } : {}),
      ...(market ? { market } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {})
    });
  }

  @Get(':runId')
  async getRun(@Param('runId') runId: string) {
    const run = await this.runsService.getRun(runId);
    if (!run) {
      throw new NotFoundException('run not found');
    }
    return run;
  }

  @Get(':runId/events.jsonl')
  @Header('Content-Type', 'application/x-ndjson; charset=utf-8')
  async getEventsJsonl(@Param('runId') runId: string) {
    const content = await this.runsService.getEventsJsonl(runId);
    if (content === undefined) {
      throw new NotFoundException('run not found');
    }
    return content;
  }

  @Get(':runId/trades.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async getTradesCsv(@Param('runId') runId: string) {
    const content = await this.runsService.getTradesCsv(runId);
    if (content === undefined) {
      throw new NotFoundException('run not found');
    }
    return content;
  }

  @Get(':runId/candles')
  async getCandles(
    @Param('runId') runId: string,
    @Query('limit') limitText?: string
  ) {
    const limit = Number(limitText ?? '300');
    const candles = await this.runsService.getCandles(runId, Number.isFinite(limit) ? limit : 300);
    if (candles === undefined) {
      throw new NotFoundException('run not found');
    }
    return candles;
  }

  @Get(':runId/config')
  getRunConfig(@Param('runId') runId: string) {
    const config = this.runsService.getRunConfig(runId);
    if (!config) {
      throw new NotFoundException('run not found');
    }
    return config;
  }

  @Patch(':runId/control')
  async updateRunControl(
    @Param('runId') runId: string,
    @Body()
    body: Readonly<{
      strategyId?: 'STRAT_A' | 'STRAT_B' | 'STRAT_C';
      strategyVersion?: string;
      mode?: 'PAPER' | 'SEMI_AUTO' | 'AUTO' | 'LIVE';
      market?: string;
      fillModelRequested?: 'AUTO' | 'NEXT_OPEN' | 'ON_CLOSE';
      fillModelApplied?: 'NEXT_OPEN' | 'ON_CLOSE';
      entryPolicy?: string;
    }>
  ) {
    const updated = await this.runsService.updateRunControl(runId, body);
    if (!updated) {
      throw new NotFoundException('run not found');
    }
    return updated;
  }

  @Post(':runId/actions/approve')
  approvePendingEntry(@Param('runId') runId: string) {
    const ok = this.runsService.approvePendingEntry(runId);
    if (!ok) {
      throw new NotFoundException('run not found');
    }
    return { ok: true };
  }
}
