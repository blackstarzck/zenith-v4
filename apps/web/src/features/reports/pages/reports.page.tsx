import { Card, List, Typography } from 'antd';
import { Link } from 'react-router-dom';

const { Title } = Typography;

export function ReportsPage() {
  return (
    <div style={{ padding: 16 }}>
      <Title level={3} style={{ marginTop: 0 }}>리포트</Title>
      <Card>
        <List
          dataSource={[
            { to: '/reports/runs', label: '런 리포트' },
            { to: '/reports/compare', label: '전략 비교 리포트' }
          ]}
          renderItem={(item) => (
            <List.Item>
              <Link to={item.to}>{item.label}</Link>
            </List.Item>
          )}
        />
      </Card>
    </div>
  );
}
