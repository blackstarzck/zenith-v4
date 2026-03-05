import { useEffect, useState } from 'react';
import { Card, Table, Typography } from 'antd';
import { Link } from 'react-router-dom';
import { httpGet } from '../../../shared/api/http';

const { Title } = Typography;

type RunHistoryRow = Readonly<{
  runId: string;
  strategyId: 'STRAT_A' | 'STRAT_B' | 'STRAT_C';
  mode: 'PAPER' | 'SEMI_AUTO' | 'AUTO' | 'LIVE';
  fillModelApplied: 'NEXT_OPEN' | 'ON_CLOSE';
  entryPolicy: string;
  eventCount: number;
  trades: number;
  exits: number;
  winRate: number;
  sumReturnPct: number;
  mddPct: number;
  lastEventAt?: string;
}>;

export function ReportsRunsPage() {
  const [rows, setRows] = useState<RunHistoryRow[]>([]);

  useEffect(() => {
    void httpGet<RunHistoryRow[]>('/runs/history').then(setRows).catch(() => setRows([]));
  }, []);

  return (
    <div style={{ padding: 16 }}>
      <Title level={3} style={{ marginTop: 0 }}>런 리포트</Title>
      <Card>
        누적 수익률(sumReturn), 승률(winRate), MDD(최대 낙폭)로 전략 실행 성능을 확인합니다.
        <Table
          size="small"
          pagination={false}
          rowKey="runId"
          columns={[
            {
              title: '런 ID(runId)',
              dataIndex: 'runId',
              key: 'runId',
              render: (value: string) => <Link to={`/reports/runs/${value}`}>{value}</Link>
            },
            { title: '전략 ID', dataIndex: 'strategyId', key: 'strategyId' },
            {
              title: '승률(winRate)',
              dataIndex: 'winRate',
              key: 'winRate',
              render: (value: number) => `${value.toFixed(2)}%`
            },
            {
              title: '누적 수익률(sumReturn)',
              dataIndex: 'sumReturnPct',
              key: 'sumReturnPct',
              render: (value: number) => `${value.toFixed(4)}%`
            },
            {
              title: '최대 낙폭(MDD)',
              dataIndex: 'mddPct',
              key: 'mddPct',
              render: (value: number) => `${value.toFixed(4)}%`
            }
          ]}
          dataSource={rows}
        />
      </Card>
    </div>
  );
}
