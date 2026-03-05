import { Card, List, Typography } from 'antd';
import { Link } from 'react-router-dom';

const { Title } = Typography;

export function StrategiesPage() {
  return (
    <div style={{ padding: 16 }}>
      <Title level={3} style={{ marginTop: 0 }}>전략 목록</Title>
      <Card>
        전략은 진입/청산/리스크 규칙의 묶음입니다. 같은 전략이라도 파라미터가 달라지면 다른 결과가 나옵니다.
        <List
          dataSource={[
            { id: 'STRAT_A', name: '추세 눌림목' },
            { id: 'STRAT_B', name: 'POI 확인 진입' },
            { id: 'STRAT_C', name: '돌파 모멘텀' }
          ]}
          renderItem={(item) => (
            <List.Item>
              <Link to={`/strategies/${item.id}`}>{item.id}</Link> - {item.name}
            </List.Item>
          )}
        />
      </Card>
    </div>
  );
}
