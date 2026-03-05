import { Button, Card, Space, Table, Typography } from 'antd';
import { Link } from 'react-router-dom';

const { Title } = Typography;

export function ExperimentsPage() {
  return (
    <div style={{ padding: 16 }}>
      <Title level={3} style={{ marginTop: 0 }}>실험 목록</Title>
      <Card>
        <Space style={{ marginBottom: 12 }}>
          <Button type="primary">
            <Link to="/experiments/new">새 실험 생성</Link>
          </Button>
        </Space>
        백테스트/시뮬레이션 조건을 고정해 전략 간 성능을 비교합니다.
        <Table
          size="small"
          pagination={false}
          rowKey="experimentId"
          columns={[
            { title: '실험 ID', dataIndex: 'experimentId', key: 'experimentId' },
            { title: '실험명', dataIndex: 'name', key: 'name' },
            { title: '마켓', dataIndex: 'market', key: 'market' }
          ]}
          dataSource={[
            { experimentId: 'exp-001', name: 'B vs C baseline', market: 'KRW-XRP' }
          ]}
        />
      </Card>
    </div>
  );
}
