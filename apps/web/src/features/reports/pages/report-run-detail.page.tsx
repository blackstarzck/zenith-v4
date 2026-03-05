import { useEffect, useState } from 'react';
import { Card, Descriptions, Typography } from 'antd';
import { useParams } from 'react-router-dom';
import { httpGet } from '../../../shared/api/http';

const { Title } = Typography;

type RunDetailResponse = Readonly<{
  runId: string;
  strategyId: 'STRAT_A' | 'STRAT_B' | 'STRAT_C';
  mode: 'PAPER' | 'SEMI_AUTO' | 'AUTO' | 'LIVE';
  fillModelRequested: 'AUTO' | 'NEXT_OPEN' | 'ON_CLOSE';
  fillModelApplied: 'NEXT_OPEN' | 'ON_CLOSE';
  entryPolicy: string;
  market: string;
  eventCount: number;
  lastSeq: number;
  lastEventAt?: string;
  kpi: Readonly<{
    trades: number;
    exits: number;
    winRate: number;
    sumReturnPct: number;
    mddPct: number;
  }>;
}>;

export function ReportRunDetailPage() {
  const { runId } = useParams();
  const [data, setData] = useState<RunDetailResponse | undefined>(undefined);

  useEffect(() => {
    if (!runId) return;
    void httpGet<RunDetailResponse>(`/runs/${runId}`).then(setData).catch(() => setData(undefined));
  }, [runId]);

  return (
    <div style={{ padding: 16 }}>
      <Title level={3} style={{ marginTop: 0 }}>런 리포트 상세</Title>
      <Card>
        <Descriptions column={1} size="small">
          <Descriptions.Item label="런 ID(runId)">{data?.runId ?? runId}</Descriptions.Item>
          <Descriptions.Item label="전략 ID(strategyId)">{data?.strategyId ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="적용 체결 모델(fillModelApplied)">{data?.fillModelApplied ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="진입 정책(entryPolicy)">{data?.entryPolicy ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="거래 수(kpi.trades)">{data?.kpi.trades ?? 0}</Descriptions.Item>
          <Descriptions.Item label="청산 수(kpi.exits)">{data?.kpi.exits ?? 0}</Descriptions.Item>
          <Descriptions.Item label="승률(kpi.winRate)">{data ? `${data.kpi.winRate.toFixed(2)}%` : '0.00%'}</Descriptions.Item>
          <Descriptions.Item label="누적 수익률(kpi.sumReturnPct)">{data ? `${data.kpi.sumReturnPct.toFixed(4)}%` : '0.0000%'}</Descriptions.Item>
          <Descriptions.Item label="최대 낙폭(kpi.mddPct)">{data ? `${data.kpi.mddPct.toFixed(4)}%` : '0.0000%'}</Descriptions.Item>
        </Descriptions>
      </Card>
    </div>
  );
}
