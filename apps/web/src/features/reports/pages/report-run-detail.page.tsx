import { useEffect, useState } from 'react';
import { Card, Descriptions, Typography } from 'antd';
import { useParams } from 'react-router-dom';
import type { RunDetailDto } from '@zenith/contracts';
import { httpGet } from '../../../shared/api/http';

const { Title } = Typography;

type RunDetailResponse = RunDetailDto;

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
          <Descriptions.Item label="전략 버전(strategyVersion)">{data?.strategyVersion ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="적용 체결 모델(fillModelApplied)">{data?.fillModelApplied ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="진입 정책(entryPolicy)">{data?.entryPolicy ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="거래 수(kpi.trades)">{data?.kpi.trades ?? 0}</Descriptions.Item>
          <Descriptions.Item label="청산 수(kpi.exits)">{data?.kpi.exits ?? 0}</Descriptions.Item>
          <Descriptions.Item label="승률(kpi.winRate)">{data ? `${data.kpi.winRate.toFixed(2)}%` : '0.00%'}</Descriptions.Item>
          <Descriptions.Item label="누적 수익률(kpi.sumReturnPct)">{data ? `${data.kpi.sumReturnPct.toFixed(4)}%` : '0.0000%'}</Descriptions.Item>
          <Descriptions.Item label="최대 낙폭(kpi.mddPct)">{data ? `${data.kpi.mddPct.toFixed(4)}%` : '0.0000%'}</Descriptions.Item>
          <Descriptions.Item label="손익비(kpi.profitFactor)">
            {data ? (data.kpi.profitFactor >= 9999 ? '무한대' : data.kpi.profitFactor.toFixed(4)) : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="평균 이익(kpi.avgWinPct)">{data ? `${data.kpi.avgWinPct.toFixed(4)}%` : '0.0000%'}</Descriptions.Item>
          <Descriptions.Item label="평균 손실(kpi.avgLossPct)">{data ? `${data.kpi.avgLossPct.toFixed(4)}%` : '0.0000%'}</Descriptions.Item>
          <Descriptions.Item label="시드(seedKrw)">
            {data?.runConfig.riskSnapshot.seedKrw?.toLocaleString('ko-KR') ?? '-'}
          </Descriptions.Item>
          <Descriptions.Item label="최대 비중(maxPositionRatio)">
            {data ? `${(data.runConfig.riskSnapshot.maxPositionRatio * 100).toFixed(2)}%` : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="리스크 한도(runConfig.riskSnapshot.dailyLossLimitPct)">
            {data ? `${data.runConfig.riskSnapshot.dailyLossLimitPct}%` : '-'}
          </Descriptions.Item>
          <Descriptions.Item label="연속 손실 제한(runConfig.riskSnapshot.maxConsecutiveLosses)">
            {data?.runConfig.riskSnapshot.maxConsecutiveLosses ?? '-'}
          </Descriptions.Item>
          <Descriptions.Item label="일일 주문 제한(runConfig.riskSnapshot.maxDailyOrders)">
            {data?.runConfig.riskSnapshot.maxDailyOrders ?? '-'}
          </Descriptions.Item>
          <Descriptions.Item label="킬스위치(runConfig.riskSnapshot.killSwitch)">
            {data?.runConfig.riskSnapshot.killSwitch ? '활성' : '비활성'}
          </Descriptions.Item>
        </Descriptions>
      </Card>
    </div>
  );
}
