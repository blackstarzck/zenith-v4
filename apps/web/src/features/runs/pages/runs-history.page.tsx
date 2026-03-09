import { useEffect, useMemo, useState } from 'react';
import { Card, Input, Select, Space, Table, Typography } from 'antd';
import { Link, useSearchParams } from 'react-router-dom';
import type { RunHistoryItemDto } from '@zenith/contracts';
import { httpGet } from '../../../shared/api/http';

const { Title, Text } = Typography;

type RunHistoryRow = RunHistoryItemDto;

export function RunsHistoryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [rows, setRows] = useState<RunHistoryRow[]>([]);

  const keyword = searchParams.get('q') ?? '';
  const mode = (searchParams.get('mode') ?? 'ALL') as 'ALL' | RunHistoryRow['mode'];

  useEffect(() => {
    void httpGet<RunHistoryRow[]>('/runs/history').then(setRows).catch(() => setRows([]));
  }, []);

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      const byKeyword = !keyword || row.runId.toLowerCase().includes(keyword.toLowerCase());
      const byMode = mode === 'ALL' || row.mode === mode;
      return byKeyword && byMode;
    });
  }, [keyword, mode, rows]);

  return (
    <div style={{ padding: 16 }}>
      <Title level={3} style={{ marginTop: 0 }}>실행 이력</Title>
      <Text type="secondary">
        런(run)은 전략 실행 1회 단위를 뜻합니다. 동일 전략이라도 파라미터/모드가 다르면 다른 runId로 기록됩니다.
      </Text>
      <Card style={{ marginTop: 10 }}>
        <Space style={{ marginBottom: 12 }} wrap>
          <Input.Search
            placeholder="runId 검색"
            allowClear
            value={keyword}
            onChange={(e) => {
              const next = new URLSearchParams(searchParams);
              if (e.target.value) next.set('q', e.target.value);
              else next.delete('q');
              setSearchParams(next);
            }}
            style={{ width: 220 }}
          />
          <Select
            value={mode}
            onChange={(value) => {
              const next = new URLSearchParams(searchParams);
              if (value === 'ALL') next.delete('mode');
              else next.set('mode', value);
              setSearchParams(next);
            }}
            style={{ width: 180 }}
            options={[
              { value: 'ALL', label: '전체 모드' },
              { value: 'PAPER', label: '페이퍼(가상매매)' },
              { value: 'SEMI_AUTO', label: '세미오토(승인 필요)' },
              { value: 'AUTO', label: '오토(자동집행)' },
              { value: 'LIVE', label: '라이브(실주문)' }
            ]}
          />
        </Space>

        <Table
          size="small"
          rowKey="runId"
          pagination={false}
          dataSource={filtered}
          columns={[
            {
              title: '런 ID',
              dataIndex: 'runId',
              key: 'runId',
              render: (value: string) => <Link to={`/runs/${value}`}>{value}</Link>
            },
            { title: '전략', dataIndex: 'strategyId', key: 'strategyId' },
            { title: '모드', dataIndex: 'mode', key: 'mode' },
            { title: '적용 체결모델', dataIndex: 'fillModelApplied', key: 'fillModelApplied' },
            { title: '진입 정책', dataIndex: 'entryPolicy', key: 'entryPolicy' },
            { title: '이벤트 수', dataIndex: 'eventCount', key: 'eventCount' },
            { title: '마지막 이벤트 시각', dataIndex: 'lastEventAt', key: 'lastEventAt' }
          ]}
        />
      </Card>
    </div>
  );
}
