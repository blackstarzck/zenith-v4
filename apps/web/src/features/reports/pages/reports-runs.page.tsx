import { useEffect, useState } from 'react';
import { Card, Table, Typography } from 'antd';
import { Link } from 'react-router-dom';
import type { RunHistoryItemDto } from '@zenith/contracts';
import { httpGet } from '../../../shared/api/http';

const { Title } = Typography;

type RunHistoryRow = RunHistoryItemDto;

export function ReportsRunsPage() {
  const [rows, setRows] = useState<RunHistoryRow[]>([]);

  useEffect(() => {
    void httpGet<RunHistoryRow[]>('/runs/history').then(setRows).catch(() => setRows([]));
  }, []);

  return (
    <div style={{ padding: 16 }}>
      <Title level={3} style={{ marginTop: 0 }}>런 리포트</Title>
      <Card>
        누적 수익률, 승률, MDD, PF(손익비), 평균 이익/손실로 전략 실행 성능을 확인합니다.
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
            { title: '전략 버전', dataIndex: 'strategyVersion', key: 'strategyVersion' },
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
            },
            {
              title: 'PF',
              dataIndex: 'profitFactor',
              key: 'profitFactor',
              render: (value: number) => (value >= 9999 ? '무한대' : value.toFixed(4))
            },
            {
              title: '평균 이익',
              dataIndex: 'avgWinPct',
              key: 'avgWinPct',
              render: (value: number) => `${value.toFixed(4)}%`
            },
            {
              title: '평균 손실',
              dataIndex: 'avgLossPct',
              key: 'avgLossPct',
              render: (value: number) => `${value.toFixed(4)}%`
            }
          ]}
          dataSource={rows}
        />
      </Card>
    </div>
  );
}
