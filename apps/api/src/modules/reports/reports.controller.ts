import { Controller, Get, Query } from '@nestjs/common';
import { RunsService } from '../runs/runs.service';

type StrategyId = 'STRAT_A' | 'STRAT_B' | 'STRAT_C';
type RunMode = 'PAPER' | 'SEMI_AUTO' | 'AUTO' | 'LIVE';

type CompareSummaryRow = Readonly<{
  strategyId: StrategyId;
  runs: number;
  trades: number;
  winRate: number;
  sumReturnPct: number;
  mddPct: number;
  profitFactor: number;
  avgWinPct: number;
  avgLossPct: number;
}>;

type CompareTrendPoint = Readonly<{
  strategyVersion: string;
  strategyId: StrategyId;
  runs: number;
  winRate: number;
  sumReturnPct: number;
  mddPct: number;
  profitFactor: number;
}>;

@Controller('reports')
export class ReportsController {
  constructor(private readonly runsService: RunsService) {}

  @Get('compare')
  async getCompare(
    @Query('strategyVersion') strategyVersion?: string,
    @Query('mode') mode?: RunMode,
    @Query('market') market?: string,
    @Query('from') from?: string,
    @Query('to') to?: string
  ) {
    const rows = await this.runsService.listRuns({
      ...(strategyVersion ? { strategyVersion } : {}),
      ...(mode ? { mode } : {}),
      ...(market ? { market } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {})
    });

    const strategyIds: readonly StrategyId[] = ['STRAT_A', 'STRAT_B', 'STRAT_C'];
    const out: CompareSummaryRow[] = strategyIds.map((strategyId) => {
      const group = rows.filter((row) => row.strategyId === strategyId);
      if (group.length === 0) {
        return {
          strategyId,
          runs: 0,
          trades: 0,
          winRate: 0,
          sumReturnPct: 0,
          mddPct: 0,
          profitFactor: 0,
          avgWinPct: 0,
          avgLossPct: 0
        };
      }

      const average = (fn: (row: (typeof group)[number]) => number): number => (
        group.reduce((acc, row) => acc + fn(row), 0) / group.length
      );

      return {
        strategyId,
        runs: group.length,
        trades: Number(average((row) => row.trades).toFixed(1)),
        winRate: Number(average((row) => row.winRate).toFixed(2)),
        sumReturnPct: Number(average((row) => row.sumReturnPct).toFixed(4)),
        mddPct: Number(average((row) => row.mddPct).toFixed(4)),
        profitFactor: Number(average((row) => row.profitFactor).toFixed(4)),
        avgWinPct: Number(average((row) => row.avgWinPct).toFixed(4)),
        avgLossPct: Number(average((row) => row.avgLossPct).toFixed(4))
      };
    });

    const trend: CompareTrendPoint[] = [];
    const byVersion = new Map<string, Array<(typeof rows)[number]>>();
    rows.forEach((row) => {
      const arr = byVersion.get(row.strategyVersion) ?? [];
      arr.push(row);
      byVersion.set(row.strategyVersion, arr);
    });

    const versions = [...byVersion.keys()].sort(compareVersion);
    versions.forEach((strategyVersion) => {
      const versionRows = byVersion.get(strategyVersion) ?? [];
      strategyIds.forEach((strategyId) => {
        const group = versionRows.filter((row) => row.strategyId === strategyId);
        if (group.length === 0) {
          return;
        }
        const average = (fn: (row: (typeof group)[number]) => number): number => (
          group.reduce((acc, row) => acc + fn(row), 0) / group.length
        );
        trend.push({
          strategyVersion,
          strategyId,
          runs: group.length,
          winRate: Number(average((row) => row.winRate).toFixed(2)),
          sumReturnPct: Number(average((row) => row.sumReturnPct).toFixed(4)),
          mddPct: Number(average((row) => row.mddPct).toFixed(4)),
          profitFactor: Number(average((row) => row.profitFactor).toFixed(4))
        });
      });
    });

    return {
      filters: {
        ...(strategyVersion ? { strategyVersion } : {}),
        ...(mode ? { mode } : {}),
        ...(market ? { market } : {}),
        ...(from ? { from } : {}),
        ...(to ? { to } : {})
      },
      summary: out,
      trend
    };
  }
}

function compareVersion(a: string, b: string): number {
  const normalize = (value: string): readonly number[] => {
    const matched = value.match(/\d+/g);
    if (!matched) {
      return [0];
    }
    return matched.map((part) => Number(part));
  };
  const left = normalize(a);
  const right = normalize(b);
  const len = Math.max(left.length, right.length);
  for (let i = 0; i < len; i += 1) {
    const l = left[i] ?? 0;
    const r = right[i] ?? 0;
    if (l !== r) {
      return l - r;
    }
  }
  return a.localeCompare(b);
}
