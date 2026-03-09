import { Body, Controller, Get, Header, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import type { DatasetRefDto } from '@zenith/contracts';
import { RunsService } from './runs.service';

@Controller('runs')
export class RunsController {
  constructor(private readonly runsService: RunsService) {}

  @Get('strategies/:strategyId/fills')
  async getStrategyFills(
    @Param('strategyId') strategyId: string,
    @Query('page') pageText?: string,
    @Query('pageSize') pageSizeText?: string
  ) {
    if (strategyId !== 'STRAT_A' && strategyId !== 'STRAT_B' && strategyId !== 'STRAT_C') {
      throw new NotFoundException('strategy not found');
    }
    const page = Number(pageText ?? '1');
    const pageSize = Number(pageSizeText ?? '50');
    return this.runsService.listStrategyFills(
      strategyId,
      Number.isFinite(page) ? page : 1,
      Number.isFinite(pageSize) ? pageSize : 50
    );
  }

  @Get('strategies/:strategyId/account-summary')
  async getStrategyAccountSummary(@Param('strategyId') strategyId: string) {
    if (strategyId !== 'STRAT_A' && strategyId !== 'STRAT_B' && strategyId !== 'STRAT_C') {
      throw new NotFoundException('strategy not found');
    }
    return this.runsService.getStrategyAccountSummary(strategyId);
  }

  @Post('maintenance/purge-invalid-fills')
  purgeInvalidFills() {
    return this.runsService.purgeInvalidFillEvents();
  }

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

  @Get(':runId/run_report.json')
  async getRunReport(@Param('runId') runId: string) {
    const report = await this.runsService.getRunReport(runId);
    if (!report) {
      throw new NotFoundException('run not found');
    }
    return report;
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
      fillModelRequested?: 'AUTO' | 'NEXT_OPEN' | 'ON_CLOSE' | 'NEXT_MINUTE_OPEN' | 'INTRABAR_APPROX';
      fillModelApplied?: 'NEXT_OPEN' | 'ON_CLOSE' | 'NEXT_MINUTE_OPEN' | 'INTRABAR_APPROX';
      entryPolicy?: string;
      datasetRef?: DatasetRefDto;
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
