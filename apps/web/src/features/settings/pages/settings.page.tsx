import { Card, List, Typography } from 'antd';
import { Link } from 'react-router-dom';

const { Title } = Typography;

export function SettingsPage() {
  return (
    <div style={{ padding: 16 }}>
      <Title level={3} style={{ marginTop: 0 }}>설정</Title>
      <Card>
        <List
          dataSource={[
            { to: '/settings/exchange', label: '거래소' },
            { to: '/settings/risk', label: '리스크' },
            { to: '/settings/system', label: '시스템' }
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
