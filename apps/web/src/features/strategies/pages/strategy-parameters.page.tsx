import { Button, Card, Form, InputNumber, Typography } from 'antd';
import { useParams } from 'react-router-dom';

const { Title } = Typography;

export function StrategyParametersPage() {
  const { strategyId } = useParams();

  return (
    <div style={{ padding: 16 }}>
      <Title level={3} style={{ marginTop: 0 }}>전략 파라미터</Title>
      <Card>
        <Form layout="vertical" initialValues={{ risk: 1.2, threshold: 0.65 }}>
          <Form.Item label={`${strategyId} 리스크 계수(risk)`} name="risk">
            <InputNumber min={0} max={10} step={0.1} style={{ width: 220 }} />
          </Form.Item>
          <Form.Item label={`${strategyId} 임계값(threshold)`} name="threshold">
            <InputNumber min={0} max={1} step={0.01} style={{ width: 220 }} />
          </Form.Item>
          <Button type="primary">새 파라미터셋으로 배포</Button>
        </Form>
      </Card>
    </div>
  );
}
