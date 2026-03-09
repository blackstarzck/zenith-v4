import { useEffect, useState } from 'react';
import { Alert, Button, Card, Descriptions, Space, Table, Tabs, Typography } from 'antd';
import { useParams } from 'react-router-dom';
import type { RunDetailDto, RunReportDto } from '@zenith/contracts';
import { downloadTextFile, httpGet, httpGetText } from '../../../shared/api/http';

const { Title, Paragraph } = Typography;

type RunDetailResponse = RunDetailDto;

export function RunDetailPage() {
  const { runId } = useParams();
  const [data, setData] = useState<RunDetailResponse | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!runId) {
      return;
    }

    void httpGet<RunDetailResponse>(`/runs/${runId}`)
      .then((res) => {
        setData(res);
        setError(undefined);
      })
      .catch(() => {
        setError('run 조회에 실패했습니다.');
      });
  }, [runId]);

  async function downloadEvents(): Promise<void> {
    if (!runId) return;
    const content = await httpGetText(`/runs/${runId}/events.jsonl`);
    downloadTextFile(`${runId}-events.jsonl`, content, 'application/x-ndjson;charset=utf-8');
  }

  async function downloadTrades(): Promise<void> {
    if (!runId) return;
    const content = await httpGetText(`/runs/${runId}/trades.csv`);
    downloadTextFile(`${runId}-trades.csv`, content, 'text/csv;charset=utf-8');
  }

  async function downloadRunReport(): Promise<void> {
    if (!runId) return;
    const report = await httpGet<RunReportDto>(`/runs/${runId}/run_report.json`);
    downloadTextFile(`${runId}-run_report.json`, JSON.stringify(report, null, 2), 'application/json;charset=utf-8');
  }

  return (
    <div style={{ padding: 16 }}>
      <Title level={3} style={{ marginTop: 0 }}>실행 상세</Title>
      <Paragraph type="secondary">
        이벤트 타임라인, 체결 로그, 아티팩트 파일을 통해 전략 동작을 사후 검증하는 화면입니다.
      </Paragraph>

      {error ? <Alert type="error" showIcon title={error} style={{ marginBottom: 12 }} /> : null}

      <Card
        extra={(
          <Space>
            <Button onClick={() => void downloadRunReport()}>run_report.json 다운로드</Button>
            <Button onClick={() => void downloadEvents()}>events.jsonl 다운로드</Button>
            <Button onClick={() => void downloadTrades()}>trades.csv 다운로드</Button>
          </Space>
        )}
      >
        <Descriptions column={2} size="small">
          <Descriptions.Item label="런 ID">{data?.runId ?? runId}</Descriptions.Item>
          <Descriptions.Item label="전략">{data?.strategyId ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="모드">{data?.mode ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="마켓">{data?.market ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="요청 체결모델">{data?.fillModelRequested ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="적용 체결모델">{data?.fillModelApplied ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="진입 정책">{data?.entryPolicy ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="마지막 시퀀스">{data?.lastSeq ?? '-'}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Card style={{ marginTop: 12 }}>
        <Tabs
          items={[
            {
              key: 'events',
              label: '이벤트 타임라인',
              children: (
                <Table
                  size="small"
                  rowKey={(row) => `${row.traceId}-${row.seq}`}
                  dataSource={data?.events ?? []}
                  pagination={false}
                  columns={[
                    { title: '시퀀스', dataIndex: 'seq', key: 'seq' },
                    { title: '이벤트 유형', dataIndex: 'eventType', key: 'eventType' },
                    { title: '이벤트 시각', dataIndex: 'eventTs', key: 'eventTs' }
                  ]}
                />
              )
            },
            {
              key: 'notes',
              label: '운영 메모',
              children: '메모 저장 연동은 다음 단계에서 추가됩니다.'
            }
          ]}
        />
      </Card>
    </div>
  );
}
