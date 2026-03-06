import { useEffect, useMemo, useState } from 'react';
import { Card, Segmented, Select, Space, Table, Typography } from 'antd';
import { httpGet } from '../../../shared/api/http';

const { Title } = Typography;

type RunHistoryRow = Readonly<{
  strategyVersion: string;
  mode: 'PAPER' | 'SEMI_AUTO' | 'AUTO' | 'LIVE';
  market: string;
}>;

type CompareSummaryRow = Readonly<{
  strategyId: 'STRAT_A' | 'STRAT_B' | 'STRAT_C';
  runs: number;
  trades: number;
  winRate: number;
  sumReturnPct: number;
  mddPct: number;
  profitFactor: number;
  avgWinPct: number;
  avgLossPct: number;
}>;

type CompareResponse = Readonly<{
  summary: readonly CompareSummaryRow[];
  trend: readonly Readonly<{
    strategyVersion: string;
    strategyId: 'STRAT_A' | 'STRAT_B' | 'STRAT_C';
    runs: number;
    winRate: number;
    sumReturnPct: number;
    mddPct: number;
    profitFactor: number;
  }>[];
}>;

export function ReportComparePage() {
  const [rows, setRows] = useState<RunHistoryRow[]>([]);
  const [summaryRows, setSummaryRows] = useState<readonly CompareSummaryRow[]>([]);
  const [modeFilter, setModeFilter] = useState<'ALL' | RunHistoryRow['mode']>('ALL');
  const [strategyVersionFilter, setStrategyVersionFilter] = useState<'ALL' | string>('ALL');
  const [marketFilter, setMarketFilter] = useState<'ALL' | string>('ALL');
  const [lookbackDays, setLookbackDays] = useState<'7' | '30' | '90'>('30');
  const [trendRows, setTrendRows] = useState<CompareResponse['trend']>([]);
  const [trendMetric, setTrendMetric] = useState<'sumReturnPct' | 'winRate' | 'profitFactor'>('sumReturnPct');

  useEffect(() => {
    const from = new Date(Date.now() - Number(lookbackDays) * 24 * 60 * 60 * 1000).toISOString();
    const params = new URLSearchParams({ from });
    if (strategyVersionFilter !== 'ALL') {
      params.set('strategyVersion', strategyVersionFilter);
    }
    if (modeFilter !== 'ALL') {
      params.set('mode', modeFilter);
    }
    if (marketFilter !== 'ALL') {
      params.set('market', marketFilter);
    }
    void httpGet<CompareResponse>(`/reports/compare?${params.toString()}`)
      .then((res) => {
        setSummaryRows(res.summary);
        setTrendRows(res.trend);
      })
      .catch(() => {
        setSummaryRows([]);
        setTrendRows([]);
      });
  }, [lookbackDays, marketFilter, modeFilter, strategyVersionFilter]);

  useEffect(() => {
    void httpGet<RunHistoryRow[]>('/runs/history').then(setRows).catch(() => setRows([]));
  }, []);

  const summary = useMemo(() => {
    const ids: readonly CompareSummaryRow['strategyId'][] = ['STRAT_A', 'STRAT_B', 'STRAT_C'];
    const out: Record<string, { winRate: string; sumReturn: string; mdd: string; trades: string; pf: string; avgWin: string; avgLoss: string }> = {};
    ids.forEach((id) => {
      const row = summaryRows.find((item) => item.strategyId === id);
      if (!row || row.runs === 0) {
        out[id] = { winRate: '-', sumReturn: '-', mdd: '-', trades: '-', pf: '-', avgWin: '-', avgLoss: '-' };
        return;
      }
      out[id] = {
        winRate: `${row.winRate.toFixed(2)}%`,
        sumReturn: `${row.sumReturnPct.toFixed(4)}%`,
        mdd: `${row.mddPct.toFixed(4)}%`,
        trades: row.trades.toFixed(1),
        pf: row.profitFactor >= 9999 ? '무한대' : row.profitFactor.toFixed(4),
        avgWin: `${row.avgWinPct.toFixed(4)}%`,
        avgLoss: `${row.avgLossPct.toFixed(4)}%`
      };
    });
    return out;
  }, [summaryRows]);

  const trendData = useMemo(() => {
    const versions = Array.from(new Set(trendRows.map((row) => row.strategyVersion)));
    const byStrategy: Record<'STRAT_A' | 'STRAT_B' | 'STRAT_C', Array<{ x: number; y: number }>> = {
      STRAT_A: [],
      STRAT_B: [],
      STRAT_C: []
    };
    versions.forEach((version, idx) => {
      const x = versions.length === 1 ? 40 : 40 + (idx * 520) / Math.max(1, versions.length - 1);
      (['STRAT_A', 'STRAT_B', 'STRAT_C'] as const).forEach((strategyId) => {
        const row = trendRows.find((item) => item.strategyVersion === version && item.strategyId === strategyId);
        if (!row) {
          return;
        }
        byStrategy[strategyId].push({ x, y: row[trendMetric] });
      });
    });
    const values = trendRows.map((row) => row[trendMetric]);
    const min = values.length > 0 ? Math.min(...values) : 0;
    const max = values.length > 0 ? Math.max(...values) : 1;
    const range = max - min;
    const yPos = (value: number): number => {
      if (range <= 0) {
        return 140;
      }
      return 20 + ((max - value) / range) * 240;
    };
    const normalize = (points: Array<{ x: number; y: number }>) => points.map((p) => ({ x: p.x, y: yPos(p.y) }));
    return {
      versions,
      points: {
        STRAT_A: normalize(byStrategy.STRAT_A),
        STRAT_B: normalize(byStrategy.STRAT_B),
        STRAT_C: normalize(byStrategy.STRAT_C)
      }
    };
  }, [trendMetric, trendRows]);

  const trendTitle = trendMetric === 'sumReturnPct'
    ? '전략 버전별 평균 누적 수익률 추이'
    : trendMetric === 'winRate'
      ? '전략 버전별 평균 승률 추이'
      : '전략 버전별 평균 PF 추이';

  return (
    <div style={{ padding: 16 }}>
      <Title level={3} style={{ marginTop: 0 }}>전략 비교 리포트</Title>
      <Card>
        <Space style={{ marginBottom: 12 }} wrap>
          <Select
            value={lookbackDays}
            onChange={(value) => setLookbackDays(value)}
            options={[
              { label: '최근 7일', value: '7' },
              { label: '최근 30일', value: '30' },
              { label: '최근 90일', value: '90' }
            ]}
            style={{ width: 140 }}
          />
          <Select
            value={strategyVersionFilter}
            onChange={(value) => setStrategyVersionFilter(value)}
            options={[
              { label: '전체 전략 버전', value: 'ALL' },
              ...Array.from(new Set(rows.map((row) => row.strategyVersion))).map((strategyVersion) => ({
                label: strategyVersion,
                value: strategyVersion
              }))
            ]}
            style={{ width: 170 }}
          />
          <Select
            value={modeFilter}
            onChange={(value) => setModeFilter(value)}
            options={[
              { label: '전체 모드', value: 'ALL' },
              { label: 'PAPER', value: 'PAPER' },
              { label: 'SEMI_AUTO', value: 'SEMI_AUTO' },
              { label: 'AUTO', value: 'AUTO' },
              { label: 'LIVE', value: 'LIVE' }
            ]}
            style={{ width: 150 }}
          />
          <Select
            value={marketFilter}
            onChange={(value) => setMarketFilter(value)}
            options={[
              { label: '전체 마켓', value: 'ALL' },
              ...Array.from(new Set(rows.map((row) => row.market))).map((market) => ({
                label: market,
                value: market
              }))
            ]}
            style={{ width: 160 }}
          />
        </Space>
        <Table
          size="small"
          pagination={false}
          rowKey="key"
          columns={[
            { title: '지표(metric)', dataIndex: 'metric', key: 'metric' },
            { title: 'STRAT_A', dataIndex: 'a', key: 'a' },
            { title: 'STRAT_B', dataIndex: 'b', key: 'b' },
            { title: 'STRAT_C', dataIndex: 'c', key: 'c' }
          ]}
          dataSource={[
            { key: '1', metric: '평균 승률(winRate)', a: summary.STRAT_A?.winRate ?? '-', b: summary.STRAT_B?.winRate ?? '-', c: summary.STRAT_C?.winRate ?? '-' },
            { key: '2', metric: '평균 누적 수익률(sumReturn)', a: summary.STRAT_A?.sumReturn ?? '-', b: summary.STRAT_B?.sumReturn ?? '-', c: summary.STRAT_C?.sumReturn ?? '-' },
            { key: '3', metric: '평균 최대 낙폭(MDD)', a: summary.STRAT_A?.mdd ?? '-', b: summary.STRAT_B?.mdd ?? '-', c: summary.STRAT_C?.mdd ?? '-' },
            { key: '4', metric: '평균 거래 수(trades)', a: summary.STRAT_A?.trades ?? '-', b: summary.STRAT_B?.trades ?? '-', c: summary.STRAT_C?.trades ?? '-' },
            { key: '5', metric: '평균 PF(profit factor)', a: summary.STRAT_A?.pf ?? '-', b: summary.STRAT_B?.pf ?? '-', c: summary.STRAT_C?.pf ?? '-' },
            { key: '6', metric: '평균 이익(avg win)', a: summary.STRAT_A?.avgWin ?? '-', b: summary.STRAT_B?.avgWin ?? '-', c: summary.STRAT_C?.avgWin ?? '-' },
            { key: '7', metric: '평균 손실(avg loss)', a: summary.STRAT_A?.avgLoss ?? '-', b: summary.STRAT_B?.avgLoss ?? '-', c: summary.STRAT_C?.avgLoss ?? '-' }
          ]}
        />
      </Card>
      <Card style={{ marginTop: 14 }} title={trendTitle}>
        <Space style={{ marginBottom: 10 }}>
          <Segmented
            value={trendMetric}
            onChange={(value) => setTrendMetric(value as 'sumReturnPct' | 'winRate' | 'profitFactor')}
            options={[
              { label: '누적 수익률', value: 'sumReturnPct' },
              { label: '승률', value: 'winRate' },
              { label: 'PF', value: 'profitFactor' }
            ]}
          />
        </Space>
        <svg viewBox="0 0 620 300" style={{ width: '100%', maxWidth: 760, background: '#fbfdff', border: '1px solid #e9eff7', borderRadius: 8 }}>
          <line x1="40" y1="260" x2="560" y2="260" stroke="#d7e0ed" />
          <line x1="40" y1="20" x2="40" y2="260" stroke="#d7e0ed" />
          {trendData.versions.map((version, idx) => {
            const x = trendData.versions.length === 1 ? 40 : 40 + (idx * 520) / Math.max(1, trendData.versions.length - 1);
            return (
              <text key={version} x={x} y={280} textAnchor="middle" fontSize="11" fill="#4b5563">
                {version}
              </text>
            );
          })}
          <polyline
            fill="none"
            stroke="#2563eb"
            strokeWidth="2"
            points={trendData.points.STRAT_A.map((p) => `${p.x},${p.y}`).join(' ')}
          />
          <polyline
            fill="none"
            stroke="#16a34a"
            strokeWidth="2"
            points={trendData.points.STRAT_B.map((p) => `${p.x},${p.y}`).join(' ')}
          />
          <polyline
            fill="none"
            stroke="#dc2626"
            strokeWidth="2"
            points={trendData.points.STRAT_C.map((p) => `${p.x},${p.y}`).join(' ')}
          />
        </svg>
        <Space size={18} style={{ marginTop: 8 }}>
          <span style={{ color: '#2563eb' }}>STRAT_A</span>
          <span style={{ color: '#16a34a' }}>STRAT_B</span>
          <span style={{ color: '#dc2626' }}>STRAT_C</span>
        </Space>
      </Card>
    </div>
  );
}
