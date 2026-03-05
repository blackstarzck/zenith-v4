import { Button, Card, Form, Input, InputNumber, Select, Typography } from 'antd';

const { Title, Text } = Typography;

export function NewExperimentPage() {
  return (
    <div style={{ padding: 16 }}>
      <Title level={3} style={{ marginTop: 0 }}>새 실험 생성</Title>
      <Card>
        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          슬리피지(slippage)는 주문 의도 가격과 실제 체결 가격의 차이입니다. 실거래와 유사한 백테스트를 위해 반드시 가정치를 설정하세요.
        </Text>
        <Form layout="vertical" initialValues={{ market: 'KRW-XRP', slippage: 0.1 }}>
          <Form.Item label="실험명(experimentName)" name="name">
            <Input style={{ width: 300 }} />
          </Form.Item>
          <Form.Item label="마켓(market)" name="market">
            <Select style={{ width: 220 }} options={[{ value: 'KRW-XRP', label: 'KRW-XRP' }]} />
          </Form.Item>
          <Form.Item label="가정 슬리피지(%)(slippageAssumedPct)" name="slippage">
            <InputNumber min={0} max={5} step={0.01} style={{ width: 220 }} />
          </Form.Item>
          <Button type="primary">실험 생성</Button>
        </Form>
      </Card>
    </div>
  );
}
