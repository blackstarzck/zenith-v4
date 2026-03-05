import { AppstoreOutlined, BarChartOutlined, ControlOutlined, ExperimentOutlined, SettingOutlined } from '@ant-design/icons';
import { Layout, Menu } from 'antd';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ExperimentDetailPage } from '../../features/experiments/pages/experiment-detail.page';
import { ExperimentsPage } from '../../features/experiments/pages/experiments.page';
import { NewExperimentPage } from '../../features/experiments/pages/new-experiment.page';
import { ReportComparePage } from '../../features/reports/pages/report-compare.page';
import { ReportRunDetailPage } from '../../features/reports/pages/report-run-detail.page';
import { ReportsPage } from '../../features/reports/pages/reports.page';
import { ReportsRunsPage } from '../../features/reports/pages/reports-runs.page';
import { RunDetailPage } from '../../features/runs/pages/run-detail.page';
import { RunsHistoryPage } from '../../features/runs/pages/runs-history.page';
import { RunsLivePage } from '../../features/runs/pages/runs-live.page';
import { SettingsPage } from '../../features/settings/pages/settings.page';
import { SettingsSubPage } from '../../features/settings/pages/settings-sub.page';
import { StrategyDetailPage } from '../../features/strategies/pages/strategy-detail.page';
import { StrategyParametersPage } from '../../features/strategies/pages/strategy-parameters.page';
import { StrategiesPage } from '../../features/strategies/pages/strategies.page';

const { Header, Content } = Layout;

function selectedMenuKey(pathname: string): string {
  if (pathname.startsWith('/runs')) return '/runs/live';
  if (pathname.startsWith('/strategies')) return '/strategies';
  if (pathname.startsWith('/experiments')) return '/experiments';
  if (pathname.startsWith('/reports')) return '/reports';
  if (pathname.startsWith('/settings')) return '/settings';
  return '/runs/live';
}

export function AppRouter() {
  const location = useLocation();

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ display: 'flex', alignItems: 'center', paddingInline: 16 }}>
        <div style={{ color: '#fff', fontWeight: 700, marginRight: 18 }}>ZENITH</div>
        <Menu
          theme="dark"
          mode="horizontal"
          selectedKeys={[selectedMenuKey(location.pathname)]}
          items={[
            {
              key: '/runs/live',
              icon: <ControlOutlined />,
              label: <Link to="/runs/live">운영</Link>
            },
            {
              key: '/strategies',
              icon: <AppstoreOutlined />,
              label: <Link to="/strategies">전략</Link>
            },
            {
              key: '/experiments',
              icon: <ExperimentOutlined />,
              label: <Link to="/experiments">실험</Link>
            },
            {
              key: '/reports',
              icon: <BarChartOutlined />,
              label: <Link to="/reports">리포트</Link>
            },
            {
              key: '/settings',
              icon: <SettingOutlined />,
              label: <Link to="/settings">설정</Link>
            }
          ]}
          style={{ flex: 1, minWidth: 0 }}
        />
      </Header>

      <Content>
        <Routes>
          <Route path="/" element={<Navigate to="/runs/live" replace />} />

          <Route path="/runs/live" element={<RunsLivePage />} />
          <Route path="/runs/history" element={<RunsHistoryPage />} />
          <Route path="/runs/:runId" element={<RunDetailPage />} />

          <Route path="/strategies" element={<StrategiesPage />} />
          <Route path="/strategies/:strategyId" element={<StrategyDetailPage />} />
          <Route path="/strategies/:strategyId/parameters" element={<StrategyParametersPage />} />

          <Route path="/experiments" element={<ExperimentsPage />} />
          <Route path="/experiments/new" element={<NewExperimentPage />} />
          <Route path="/experiments/:experimentId" element={<ExperimentDetailPage />} />

          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/reports/runs" element={<ReportsRunsPage />} />
          <Route path="/reports/runs/:runId" element={<ReportRunDetailPage />} />
          <Route path="/reports/compare" element={<ReportComparePage />} />

          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/settings/exchange" element={<SettingsSubPage />} />
          <Route path="/settings/risk" element={<SettingsSubPage />} />
          <Route path="/settings/system" element={<SettingsSubPage />} />
        </Routes>
      </Content>
    </Layout>
  );
}
