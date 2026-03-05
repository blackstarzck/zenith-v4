import { Card, Descriptions, Typography } from 'antd';
import { Link, useParams } from 'react-router-dom';

const { Title } = Typography;

export function StrategyDetailPage() {
  const { strategyId } = useParams();

  return (
    <div style={{ padding: 16 }}>
      <Title level={3} style={{ marginTop: 0 }}>전략 상세</Title>
      <Card>
        <Descriptions column={1} size="small">
          <Descriptions.Item label="전략 ID(strategyId)">{strategyId}</Descriptions.Item>
          <Descriptions.Item label="버전">v1.0.0</Descriptions.Item>
          <Descriptions.Item label="타임프레임">15m</Descriptions.Item>
          <Descriptions.Item label="설정">
            <Link to={`/strategies/${strategyId}/parameters`}>파라미터 수정</Link>
          </Descriptions.Item>
        </Descriptions>
      </Card>
    </div>
  );
}
