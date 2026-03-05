import { useEffect, useState } from 'react';
import { Card, Descriptions, Typography } from 'antd';
import { useLocation } from 'react-router-dom';
import { httpGet } from '../../../shared/api/http';

const { Title } = Typography;

type OpsMetrics = Readonly<{
  wsConnections: number;
  wsDisconnections: number;
  eventsIngested: number;
  marketTicks: number;
  signals: number;
  fills: number;
  exits: number;
  lastEventAt?: string;
}>;

export function SettingsSubPage() {
  const location = useLocation();
  const section = location.pathname.split('/').at(-1) ?? 'system';
  const sectionLabel = section === 'exchange' ? '거래소' : section === 'risk' ? '리스크' : '시스템';
  const [metrics, setMetrics] = useState<OpsMetrics | undefined>(undefined);

  useEffect(() => {
    if (section !== 'system') {
      return;
    }
    void httpGet<OpsMetrics>('/ops/metrics').then(setMetrics).catch(() => setMetrics(undefined));
    const id = setInterval(() => {
      void httpGet<OpsMetrics>('/ops/metrics').then(setMetrics).catch(() => setMetrics(undefined));
    }, 3000);
    return () => clearInterval(id);
  }, [section]);

  return (
    <div style={{ padding: 16 }}>
      <Title level={3} style={{ marginTop: 0 }}>설정 / {sectionLabel}</Title>
      <Card>
        <Descriptions column={1} size="small">
          <Descriptions.Item label="섹션(section)">{section}</Descriptions.Item>
          <Descriptions.Item label="상태(status)">구성 완료</Descriptions.Item>
          <Descriptions.Item label="메모(note)">실서비스 안전 기본값(production-safe defaults) 적용</Descriptions.Item>
          {section === 'system' ? <Descriptions.Item label="WS 연결 수">{metrics?.wsConnections ?? 0}</Descriptions.Item> : null}
          {section === 'system' ? <Descriptions.Item label="WS 해제 수">{metrics?.wsDisconnections ?? 0}</Descriptions.Item> : null}
          {section === 'system' ? <Descriptions.Item label="이벤트 수신">{metrics?.eventsIngested ?? 0}</Descriptions.Item> : null}
          {section === 'system' ? <Descriptions.Item label="마켓 틱 수">{metrics?.marketTicks ?? 0}</Descriptions.Item> : null}
          {section === 'system' ? <Descriptions.Item label="시그널 수">{metrics?.signals ?? 0}</Descriptions.Item> : null}
          {section === 'system' ? <Descriptions.Item label="체결 수">{metrics?.fills ?? 0}</Descriptions.Item> : null}
          {section === 'system' ? <Descriptions.Item label="청산 수">{metrics?.exits ?? 0}</Descriptions.Item> : null}
          {section === 'system' ? <Descriptions.Item label="마지막 이벤트 시각">{metrics?.lastEventAt ?? '-'}</Descriptions.Item> : null}
        </Descriptions>
      </Card>
    </div>
  );
}
