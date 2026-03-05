import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WsEventEnvelopeDto } from '@zenith/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Descriptions,
  Flex,
  Layout,
  Progress,
  Row,
  Segmented,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ChartPanel, type ChartCandle } from '../../../shared/chart/chart-panel';
import { httpGet, httpPatch } from '../../../shared/api/http';
import { RealtimeStatusBadge } from '../../../shared/realtime/components/realtime-status-badge';
import { useRealtimeStatus } from '../../../shared/realtime/hooks/use-realtime-status';
import { useRunEventsSocket } from '../../../shared/realtime/hooks/use-run-events-socket';

const { Title, Text } = Typography;

type RunMode = 'PAPER' | 'SEMI_AUTO' | 'AUTO' | 'LIVE';
type StrategyId = 'STRAT_A' | 'STRAT_B' | 'STRAT_C';

type TradeRow = Readonly<{
  key: string;
  tradeId: string;
  entryTime: string;
  exitReason: string;
  netReturnPct: string;
}>;

type CandlePayload = Readonly<{
  time?: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
}>;

type RunDetail = Readonly<{
  runId: string;
  strategyId: StrategyId;
  mode: RunMode;
  market: string;
  fillModelRequested: 'AUTO' | 'NEXT_OPEN' | 'ON_CLOSE';
  fillModelApplied: 'NEXT_OPEN' | 'ON_CLOSE';
  entryPolicy: string;
  kpi?: Readonly<{
    trades: number;
    exits: number;
    winRate: number;
    sumReturnPct: number;
    mddPct: number;
  }>;
}>;

function extractCandle(payload: CandlePayload | Readonly<Record<string, unknown>>): ChartCandle | undefined {
  const nested = (payload as { candle?: CandlePayload }).candle;
  const source = nested ?? payload;
  if (
    typeof source.time !== 'number' ||
    typeof source.open !== 'number' ||
    typeof source.high !== 'number' ||
    typeof source.low !== 'number' ||
    typeof source.close !== 'number'
  ) {
    return undefined;
  }

  return {
    time: source.time,
    open: source.open,
    high: source.high,
    low: source.low,
    close: source.close
  } as ChartCandle;
}

function upsertCandle(prev: readonly ChartCandle[], next: ChartCandle): readonly ChartCandle[] {
  const last = prev[prev.length - 1];
  if (!last) {
    return [next];
  }
  if (last.time === next.time) {
    return [...prev.slice(0, -1), next];
  }
  if (last.time > next.time) {
    return prev;
  }
  const withNew = [...prev, next];
  if (withNew.length > 300) {
    return withNew.slice(withNew.length - 300);
  }
  return withNew;
}

const tradeColumns: ColumnsType<TradeRow> = [
  { title: '체결 ID', dataIndex: 'tradeId', key: 'tradeId' },
  { title: '진입 시각', dataIndex: 'entryTime', key: 'entryTime' },
  { title: '청산 사유', dataIndex: 'exitReason', key: 'exitReason' },
  { title: '순수익률(%)', dataIndex: 'netReturnPct', key: 'netReturnPct' }
];

export function RunsLivePage() {
  const {
    status,
    markLive,
    markError,
    markPaused,
    markEventReceived,
    setReconnectState,
    setPending
  } = useRealtimeStatus({ staleThresholdMs: 5000 });

  const [lastEvent, setLastEvent] = useState<WsEventEnvelopeDto | undefined>(undefined);
  const [eventLog, setEventLog] = useState<readonly WsEventEnvelopeDto[]>([]);
  const [gapCount, setGapCount] = useState(0);
  const [strategyId, setStrategyId] = useState<StrategyId>('STRAT_B');
  const [market, setMarket] = useState('KRW-XRP');
  const [mode, setMode] = useState<RunMode>('PAPER');
  const [fillModelRequested, setFillModelRequested] = useState<'AUTO' | 'NEXT_OPEN' | 'ON_CLOSE'>('AUTO');
  const [fillModelApplied, setFillModelApplied] = useState<'NEXT_OPEN' | 'ON_CLOSE'>('NEXT_OPEN');
  const [isRunning, setIsRunning] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | undefined>(undefined);
  const [activeTab, setActiveTab] = useState('EVENTS');
  const [candles, setCandles] = useState<readonly ChartCandle[]>([]);
  const [runKpi, setRunKpi] = useState<RunDetail['kpi']>();

  const lastSeqRef = useRef<number | undefined>(undefined);
  const runId = 'run-dev-0001';
  const entryPolicy = mode === 'SEMI_AUTO' ? 'NEXT_OPEN_AFTER_APPROVAL' : 'AUTO';

  const syncRunControl = useCallback(async () => {
    try {
      await httpPatch<RunDetail, Record<string, unknown>>(`/runs/${runId}/control`, {
        strategyId,
        mode,
        market,
        fillModelRequested,
        fillModelApplied,
        entryPolicy
      });
    } catch {
      // 제어 동기화 실패 시 UI 동작은 유지하고 다음 동기화 주기에 재시도한다.
    }
  }, [entryPolicy, fillModelApplied, fillModelRequested, market, mode, runId, strategyId]);

  const refreshRunDetail = useCallback(async () => {
    try {
      const detail = await httpGet<RunDetail>(`/runs/${runId}`);
      setRunKpi(detail.kpi);
      setStrategyId(detail.strategyId);
      setMode(detail.mode);
      setMarket(detail.market);
      setFillModelRequested(detail.fillModelRequested);
      setFillModelApplied(detail.fillModelApplied);
    } catch {
      // 소켓 스트림이 동작하면 화면은 유지되므로 실패는 무시한다.
    }
  }, [runId]);

  const loadCandleSnapshot = useCallback(async () => {
    try {
      const snapshot = await httpGet<ChartCandle[]>(`/runs/${runId}/candles?limit=300`);
      if (snapshot.length === 0) {
        return;
      }
      setCandles((prev) => {
        if (prev.length === 0) {
          return snapshot;
        }
        const merged = [...prev];
        snapshot.forEach((candle) => {
          const next = candle as ChartCandle;
          const current = merged[merged.length - 1];
          if (!current) {
            merged.push(next);
            return;
          }
          if (current.time === next.time) {
            merged[merged.length - 1] = next;
            return;
          }
          if (current.time < next.time) {
            merged.push(next);
          }
        });
        return merged.slice(-300);
      });
    } catch {
      // 실시간 델타로 복구 가능하므로 스냅샷 실패는 무시한다.
    }
  }, [runId]);

  useEffect(() => {
    void loadCandleSnapshot();
  }, [loadCandleSnapshot]);

  useEffect(() => {
    void refreshRunDetail();
    const id = setInterval(() => {
      void refreshRunDetail();
    }, 4000);
    return () => clearInterval(id);
  }, [refreshRunDetail]);

  useEffect(() => {
    void syncRunControl();
  }, [syncRunControl]);

  const handlers = useMemo(
    () => ({
      onConnect: () => {
        void loadCandleSnapshot();
        markLive();
      },
      onDisconnect: () => {
        markPaused();
      },
      onReconnectAttempt: (attempt: number) => {
        setReconnectState({ retryCount: attempt, nextRetryInMs: 1000 });
      },
      onConnectError: () => {
        markError();
      },
      onEvent: (event: WsEventEnvelopeDto) => {
        const prevSeq = lastSeqRef.current;
        if (typeof prevSeq === 'number' && event.seq > prevSeq + 1) {
          setGapCount((count) => count + 1);
          setReconnectState({ retryCount: status.retryCount + 1, nextRetryInMs: 1000 });
        }
        if (typeof prevSeq === 'number' && event.seq <= prevSeq) {
          return;
        }

        lastSeqRef.current = event.seq;
        setLastEvent(event);
        setEventLog((prev) => [...prev, event].slice(-300));
        markEventReceived(event.eventTs);
        const nextCandle = extractCandle(event.payload as CandlePayload | Readonly<Record<string, unknown>>);
        if (nextCandle) {
          setCandles((prev) => upsertCandle(prev, nextCandle));
        }
      }
    }),
    [loadCandleSnapshot, markError, markEventReceived, markLive, markPaused, setReconnectState, status.retryCount]
  );

  useRunEventsSocket(handlers);

  function triggerAction(action: string, nextState?: () => void): void {
    if (pendingAction) {
      return;
    }

    setPendingAction(action);
    setPending(true);
    setTimeout(() => {
      nextState?.();
      setPending(false);
      setPendingAction(undefined);
    }, 900);
  }

  const tradeRows: TradeRow[] = useMemo(() => (
    eventLog
      .filter((event) => event.eventType === 'FILL')
      .slice(-50)
      .map((event, index) => {
        const payload = event.payload as Readonly<Record<string, unknown>>;
        const fillPrice = typeof payload.fillPrice === 'number' ? payload.fillPrice : undefined;
        const side = typeof payload.side === 'string' ? payload.side : 'UNKNOWN';
        return {
          key: `${event.traceId}-${event.seq}`,
          tradeId: `T-${String(index + 1).padStart(4, '0')}`,
          entryTime: event.eventTs,
          exitReason: side === 'SELL' ? String(payload.reason ?? 'EXIT') : 'ENTRY',
          netReturnPct: fillPrice ? `${fillPrice.toFixed(2)} KRW` : '-'
        };
      })
  ), [eventLog]);

  const approvalEvents = useMemo(() => (
    eventLog.filter((event) => event.eventType === 'APPROVE_ENTER').slice(-20)
  ), [eventLog]);

  const riskBlockEvents = useMemo(() => (
    eventLog
      .filter((event) => event.eventType === 'RISK_BLOCK' || event.eventType === 'LIVE_GUARD_BLOCKED')
      .slice(-10)
  ), [eventLog]);

  const pauseEvents = useMemo(() => (
    eventLog.filter((event) => event.eventType === 'PAUSE').slice(-10)
  ), [eventLog]);

  return (
    <Layout style={{ minHeight: '100vh', background: '#f3f6fa', padding: 16 }}>
      <Title level={3} style={{ marginTop: 0 }}>실시간 실행 콘솔</Title>
      <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
        웹소켓 기반으로 시세/이벤트를 갱신합니다. `PENDING`은 요청 처리 중 상태, `DELAYED`는 실시간이 아닌 스냅샷 지연 상태를 의미합니다.
      </Text>

      <Card
        style={{ marginBottom: 14 }}
        styles={{ body: { padding: 14 } }}
        title={<Text strong>실행 컨텍스트 바</Text>}
        extra={(
          <Space>
            <Button
              size="small"
              onClick={() => {
                const context = JSON.stringify({
                  strategyId,
                  runId,
                  mode,
                  fillModelRequested,
                  fillModelApplied,
                  entryPolicy,
                  connectionState: status.connectionState,
                  lastEventAt: status.lastEventAt
                });
                void navigator.clipboard?.writeText(context);
              }}
            >
              컨텍스트 복사
            </Button>
            <RealtimeStatusBadge status={status} />
          </Space>
        )}
      >
        <Descriptions column={{ xs: 1, sm: 2, md: 4 }} size="small">
          <Descriptions.Item label="전략 ID(strategyId)">{strategyId}</Descriptions.Item>
          <Descriptions.Item label="실행 ID(runId)">{runId}</Descriptions.Item>
          <Descriptions.Item label="실행 모드(mode)"><Tag color="blue">{mode}</Tag></Descriptions.Item>
          <Descriptions.Item label="진입 정책(entryPolicy)">{entryPolicy}</Descriptions.Item>
          <Descriptions.Item label="요청 체결 모델(fillModelRequested)">{fillModelRequested}</Descriptions.Item>
          <Descriptions.Item label="적용 체결 모델(fillModelApplied)">{fillModelApplied}</Descriptions.Item>
          <Descriptions.Item label="연결 상태(connectionState)">
            <Badge status={status.connectionState === 'ERROR' ? 'error' : 'processing'} text={status.connectionState} />
          </Descriptions.Item>
          <Descriptions.Item label="마지막 이벤트 시각(lastEventAt)">{status.lastEventAt ?? '-'}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Row gutter={[14, 14]}>
        <Col xs={24} xl={15}>
          <Card title="실시간 차트" style={{ minHeight: 340 }}>
            <Alert
              type={status.connectionState === 'DELAYED' ? 'warning' : 'info'}
              showIcon
              title={
                candles.length === 0
                  ? '실시간 데이터 수신 대기 중'
                  : status.connectionState === 'DELAYED'
                    ? '지연 상태: 스냅샷만 표시'
                    : '실시간 차트 스트림'
              }
              style={{ marginBottom: 10 }}
            />
            <ChartPanel delayed={status.connectionState === 'DELAYED'} candles={candles} />
          </Card>
        </Col>

        <Col xs={24} xl={9}>
          <Space orientation="vertical" size={14} style={{ width: '100%' }}>
            <Card title="실행 제어">
              <Space orientation="vertical" size={10} style={{ width: '100%' }}>
                <Flex justify="space-between" align="center" gap={8}>
                  <Text type="secondary">전략</Text>
                  <Select
                    value={strategyId}
                    onChange={(value) => setStrategyId(value as StrategyId)}
                    options={[
                      { value: 'STRAT_A', label: 'STRAT_A' },
                      { value: 'STRAT_B', label: 'STRAT_B' },
                      { value: 'STRAT_C', label: 'STRAT_C' }
                    ]}
                    style={{ width: 170 }}
                  />
                </Flex>

                <Flex justify="space-between" align="center" gap={8}>
                  <Text type="secondary">마켓</Text>
                  <Select
                    value={market}
                    onChange={setMarket}
                    options={[
                      { value: 'KRW-XRP', label: 'KRW-XRP' },
                      { value: 'KRW-BTC', label: 'KRW-BTC' },
                      { value: 'KRW-ETH', label: 'KRW-ETH' }
                    ]}
                    style={{ width: 170 }}
                  />
                </Flex>

                <Flex justify="space-between" align="center" gap={8}>
                  <Text type="secondary">모드</Text>
                  <Select
                    value={mode}
                    onChange={(value) => setMode(value as RunMode)}
                    options={[
                      { value: 'PAPER', label: 'PAPER (모의)' },
                      { value: 'SEMI_AUTO', label: 'SEMI_AUTO (반자동)' },
                      { value: 'AUTO', label: 'AUTO (자동)' },
                      { value: 'LIVE', label: 'LIVE (실거래)' }
                    ]}
                    style={{ width: 170 }}
                  />
                </Flex>

                <Flex justify="space-between" align="center" gap={8}>
                  <Text type="secondary">요청 체결 모델</Text>
                  <Select
                    value={fillModelRequested}
                    onChange={(value) => setFillModelRequested(value as 'AUTO' | 'NEXT_OPEN' | 'ON_CLOSE')}
                    options={[
                      { value: 'AUTO', label: 'AUTO' },
                      { value: 'NEXT_OPEN', label: 'NEXT_OPEN' },
                      { value: 'ON_CLOSE', label: 'ON_CLOSE' }
                    ]}
                    style={{ width: 170 }}
                  />
                </Flex>

                <Flex justify="space-between" align="center" gap={8}>
                  <Text type="secondary">적용 체결 모델</Text>
                  <Segmented
                    value={fillModelApplied}
                    options={['NEXT_OPEN', 'ON_CLOSE']}
                    onChange={(value) => setFillModelApplied(value as 'NEXT_OPEN' | 'ON_CLOSE')}
                  />
                </Flex>

                <Flex wrap gap={8}>
                  <Button
                    type="primary"
                    loading={pendingAction === 'Start'}
                    disabled={Boolean(pendingAction) || isRunning}
                    onClick={() => triggerAction('Start', () => setIsRunning(true))}
                  >
                    실행 시작
                  </Button>
                  <Button
                    loading={pendingAction === 'Pause'}
                    disabled={Boolean(pendingAction) || !isRunning}
                    onClick={() => triggerAction('Pause', markPaused)}
                  >
                    일시정지
                  </Button>
                  <Button
                    loading={pendingAction === 'Resume'}
                    disabled={Boolean(pendingAction) || !isRunning}
                    onClick={() => triggerAction('Resume', markLive)}
                  >
                    재개
                  </Button>
                  <Button
                    loading={pendingAction === 'Stop'}
                    disabled={Boolean(pendingAction) || !isRunning}
                    onClick={() => triggerAction('Stop', () => setIsRunning(false))}
                  >
                    종료
                  </Button>
                  <Button
                    danger
                    loading={pendingAction === 'KillSwitch'}
                    disabled={Boolean(pendingAction)}
                    onClick={() => triggerAction('KillSwitch', markError)}
                  >
                    긴급중지
                  </Button>
                </Flex>

                <Text type="secondary">
                  {pendingAction ? `처리 중: ${pendingAction}` : `엔진 상태: ${isRunning ? '실행 중' : '대기'}`}
                </Text>
              </Space>
            </Card>

            <Card title="포지션 / 주문 / 체결">
              <Space orientation="vertical" size={6}>
                <Text>포지션: 매수(LONG) 120 XRP @ 692.1</Text>
                <Text>미실현 손익(PnL): <Tag color="green">+0.84%</Tag></Text>
                <Text>활성 주문: 1</Text>
                <Text>최근 체결 이벤트: {lastEvent?.eventType ?? '-'}</Text>
              </Space>
            </Card>

            <Card title="리스크 모니터">
              <Space orientation="vertical" size={8} style={{ width: '100%' }}>
                <Text>일일 손실 한도: 12%</Text>
                <Progress percent={12} size="small" />
                <Text>일일 최대 주문 수: 4 / 20</Text>
                <Text>시퀀스 누락 감지 횟수: {gapCount}</Text>
                <Text>승률: {runKpi ? runKpi.winRate.toFixed(2) : '0.00'}%</Text>
                <Text>누적 수익률: {runKpi?.sumReturnPct ?? 0}%</Text>
                <Text>MDD: {runKpi?.mddPct ?? 0}%</Text>
                <Text>리스크 차단 이벤트: {riskBlockEvents.length}</Text>
                <Text>일시정지 이벤트: {pauseEvents.length}</Text>
              </Space>
            </Card>
          </Space>
        </Col>
      </Row>

      <Card style={{ marginTop: 14 }} styles={{ body: { paddingTop: 8 } }}>
        <Tabs activeKey={activeTab} onChange={setActiveTab} items={[
          {
            key: 'TRADES',
            label: '체결 내역',
            children: <Table columns={tradeColumns} dataSource={tradeRows} pagination={false} size="small" />
          },
          {
            key: 'EVENTS',
            label: '이벤트',
            children: (
              <pre style={{ margin: 0, background: '#f8fafc', padding: 12, borderRadius: 8, overflow: 'auto' }}>
                {JSON.stringify(eventLog.length > 0 ? eventLog.slice(-20) : { message: '아직 이벤트가 없습니다' }, null, 2)}
              </pre>
            )
          },
          {
            key: 'PARAMETERS',
            label: '파라미터',
            children: (
              <pre style={{ margin: 0, background: '#f8fafc', padding: 12, borderRadius: 8, overflow: 'auto' }}>
                {JSON.stringify({
                  strategyId,
                  mode,
                  fillModelRequested,
                  fillModelApplied,
                  entryPolicy,
                  riskSnapshot: {
                    dailyLossLimitPct: 3.0,
                    maxDailyOrders: 20,
                    maxConsecutiveLosses: 5
                  }
                }, null, 2)}
              </pre>
            )
          },
          {
            key: 'EXIT_REASONS',
            label: '청산 사유 분포',
            children: (
              <Space orientation="vertical" size={8}>
                <Text>TP1: 42%</Text>
                <Text>TP2: 18%</Text>
                <Text>SL: 24%</Text>
                <Text>시간 만료(TIME): 16%</Text>
              </Space>
            )
          },
          {
            key: 'APPROVALS',
            label: '승인',
            children: (
              <Space orientation="vertical" size={8}>
                {approvalEvents.length === 0 ? <Text>현재 승인 대기 이벤트가 없습니다.</Text> : null}
                {approvalEvents.map((event) => {
                  const payload = event.payload as Readonly<Record<string, unknown>>;
                  return (
                    <Text key={`${event.traceId}-${event.seq}`}>
                      signalTime: {event.eventTs} / suggestedPrice: {String(payload.suggestedPrice ?? '-')}
                    </Text>
                  );
                })}
                <Button
                  type="primary"
                  loading={pendingAction === 'Approve'}
                  disabled={Boolean(pendingAction)}
                  onClick={() => triggerAction('Approve')}
                >
                  승인
                </Button>
              </Space>
            )
          }
        ]}
        />
      </Card>

      <Card title="용어 설명" style={{ marginTop: 14 }}>
        <Descriptions column={1} size="small">
          <Descriptions.Item label="PnL(Profit and Loss)">손익을 의미합니다. `미실현`은 보유 중 평가손익, `실현`은 청산 완료 손익입니다.</Descriptions.Item>
          <Descriptions.Item label="MDD(Max Drawdown)">고점 대비 최대 손실폭입니다. 전략 하방 리스크 평가의 핵심 지표입니다.</Descriptions.Item>
          <Descriptions.Item label="POI(Point of Interest)">수급/반전 가능성이 높은 가격 구간입니다. 예: 공급/수요 존, 유동성 구간.</Descriptions.Item>
          <Descriptions.Item label="Slippage(슬리피지)">주문 의도 가격과 실제 체결 가격의 차이입니다. 백테스트/실거래 괴리의 주요 원인입니다.</Descriptions.Item>
          <Descriptions.Item label="Fill Model">체결 가정 모델입니다. `NEXT_OPEN`은 다음 봉 시가, `ON_CLOSE`는 현재 봉 종가 기준 체결을 뜻합니다.</Descriptions.Item>
        </Descriptions>
      </Card>

      <Flex gap={8} style={{ marginTop: 12 }}>
        <Button onClick={() => setReconnectState({ retryCount: (status.retryCount ?? 0) + 1, nextRetryInMs: 1500 })}>
          재연결 강제
        </Button>
        <Button onClick={markError}>오류 상태 강제</Button>
        <Button onClick={markLive}>실시간 상태 강제</Button>
      </Flex>
    </Layout>
  );
}
