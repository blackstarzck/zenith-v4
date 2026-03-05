import { Card, Typography } from 'antd';
import { useParams } from 'react-router-dom';

const { Title, Text } = Typography;

export function ExperimentDetailPage() {
  const { experimentId } = useParams();

  return (
    <div style={{ padding: 16 }}>
      <Title level={3} style={{ marginTop: 0 }}>실험 상세</Title>
      <Card>
        <Text>실험 ID(experimentId): {experimentId}</Text>
      </Card>
    </div>
  );
}
