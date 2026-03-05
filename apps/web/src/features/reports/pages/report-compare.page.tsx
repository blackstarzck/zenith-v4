import { useEffect, useMemo, useState } from 'react';
import { Card, Table, Typography } from 'antd';
import { httpGet } from '../../../shared/api/http';

const { Title } = Typography;

type RunHistoryRow = Readonly<{
  runId: string;
  strategyId: 'STRAT_A' | 'STRAT_B' | 'STRAT_C';
  winRate: number;
  sumReturnPct: number;
  mddPct: number;
  trades: number;
}>;

export function ReportComparePage() {
  const [rows, setRows] = useState<RunHistoryRow[]>([]);

  useEffect(() => {
    void httpGet<RunHistoryRow[]>('/runs/history').then(setRows).catch(() => setRows([]));
  }, []);

  const summary = useMemo(() => {
    const ids: Array<'STRAT_A' | 'STRAT_B' | 'STRAT_C'> = ['STRAT_A', 'STRAT_B', 'STRAT_C'];
    const out: Record<string, { winRate: string; sumReturn: string; mdd: string; trades: string }> = {};
    ids.forEach((id) => {
      const group = rows.filter((row) => row.strategyId === id);
      if (group.length === 0) {
        out[id] = { winRate: '-', sumReturn: '-', mdd: '-', trades: '-' };
        return;
      }
      const avgWinRate = group.reduce((acc, row) => acc + row.winRate, 0) / group.length;
      const avgSumReturn = group.reduce((acc, row) => acc + row.sumReturnPct, 0) / group.length;
      const avgMdd = group.reduce((acc, row) => acc + row.mddPct, 0) / group.length;
      const avgTrades = group.reduce((acc, row) => acc + row.trades, 0) / group.length;
      out[id] = {
        winRate: `${avgWinRate.toFixed(2)}%`,
        sumReturn: `${avgSumReturn.toFixed(4)}%`,
        mdd: `${avgMdd.toFixed(4)}%`,
        trades: avgTrades.toFixed(1)
      };
    });
    return out;
  }, [rows]);

  return (
    <div style={{ padding: 16 }}>
      <Title level={3} style={{ marginTop: 0 }}>전략 비교 리포트</Title>
      <Card>
        <Table
          size="small"
          pagination={false}
          rowKey="key"
          columns={[
            { title: '지표(metric)', dataIndex: 'metric', key: 'metric' },
            { title: 'STRAT_A', dataIndex: 'a', key: 'a' },
            { title: 'STRAT_B', dataIndex: 'b', key: 'b' },
            { title: 'STRAT_C', dataIndex: 'c', key: 'c' }
          ]}
          dataSource={[
            { key: '1', metric: '평균 승률(winRate)', a: summary.STRAT_A?.winRate ?? '-', b: summary.STRAT_B?.winRate ?? '-', c: summary.STRAT_C?.winRate ?? '-' },
            { key: '2', metric: '평균 누적 수익률(sumReturn)', a: summary.STRAT_A?.sumReturn ?? '-', b: summary.STRAT_B?.sumReturn ?? '-', c: summary.STRAT_C?.sumReturn ?? '-' },
            { key: '3', metric: '평균 최대 낙폭(MDD)', a: summary.STRAT_A?.mdd ?? '-', b: summary.STRAT_B?.mdd ?? '-', c: summary.STRAT_C?.mdd ?? '-' },
            { key: '4', metric: '평균 거래 수(trades)', a: summary.STRAT_A?.trades ?? '-', b: summary.STRAT_B?.trades ?? '-', c: summary.STRAT_C?.trades ?? '-' }
          ]}
        />
      </Card>
    </div>
  );
}
