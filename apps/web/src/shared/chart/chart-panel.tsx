import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Flex, Segmented, Space, Typography } from 'antd';
import {
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type LineWidth,
  type MouseEventParams,
  type SeriesMarker,
  type UTCTimestamp
} from 'lightweight-charts';

const { Text } = Typography;

type ChartPanelProps = Readonly<{
  candles: readonly ChartCandle[];
  overlays?: readonly ChartOverlayLine[];
  markers?: readonly ChartOverlayMarker[];
}>;

export type ChartCandle = Readonly<{
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}>;

export type ChartLinePoint = Readonly<{
  time: UTCTimestamp;
  value: number;
}>;

export type ChartOverlayLine = Readonly<{
  id: string;
  label: string;
  color: string;
  data: readonly ChartLinePoint[];
  lineWidth?: LineWidth;
  lineStyle?: LineStyle;
}>;

export type ChartOverlayMarker = SeriesMarker<UTCTimestamp>;

type TimeframeKey = '1m' | '5m' | '30m' | '1h' | '4h' | '1d';
type ChartMode = 'CANDLE' | 'LINE';
type IndicatorMode = 'NONE' | 'MA' | 'BB';
type DrawingTool = 'NONE' | 'TREND_LINE' | 'HORIZONTAL_LINE';

type ChartDrawing = Readonly<
  | {
      id: string;
      kind: 'TREND_LINE';
      start: ChartLinePoint;
      end: ChartLinePoint;
    }
  | {
      id: string;
      kind: 'HORIZONTAL_LINE';
      price: number;
    }
>;

const TIMEFRAME_LABELS: Readonly<Record<TimeframeKey, string>> = {
  '1m': '1분',
  '5m': '5분',
  '30m': '30분',
  '1h': '1시간',
  '4h': '4시간',
  '1d': '1일'
};

const TOOL_LABELS: Readonly<Record<DrawingTool, string>> = {
  NONE: '커서',
  TREND_LINE: '추세선',
  HORIZONTAL_LINE: '수평선'
};

const TIMEFRAME_OPTIONS: ReadonlyArray<Readonly<{ key: TimeframeKey; label: string; minutes: number }>> = [
  { key: '1m', label: '1분', minutes: 1 },
  { key: '5m', label: '5분', minutes: 5 },
  { key: '30m', label: '30분', minutes: 30 },
  { key: '1h', label: '1시간', minutes: 60 },
  { key: '4h', label: '4시간', minutes: 240 },
  { key: '1d', label: '1일', minutes: 1440 }
];

function timeframeMinutes(key: TimeframeKey): number {
  const found = TIMEFRAME_OPTIONS.find((item) => item.key === key);
  return found?.minutes ?? 1;
}

function toBucketTime(time: UTCTimestamp, unitMinutes: number): UTCTimestamp {
  const step = unitMinutes * 60;
  const bucket = Math.floor(time / step) * step;
  return bucket as UTCTimestamp;
}

function aggregateCandles(candles: readonly ChartCandle[], unitMinutes: number): ChartCandle[] {
  if (unitMinutes <= 0) {
    return [...candles].sort((a, b) => a.time - b.time);
  }

  const sorted = [...candles].sort((a, b) => a.time - b.time);
  const byBucket = new Map<UTCTimestamp, ChartCandle>();

  sorted.forEach((candle) => {
    const bucket = toBucketTime(candle.time, unitMinutes);
    const current = byBucket.get(bucket);
    if (!current) {
      byBucket.set(bucket, {
        time: bucket,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        ...(typeof candle.volume === 'number' ? { volume: candle.volume } : {})
      });
      return;
    }

    const nextVolume = (current.volume ?? 0) + (candle.volume ?? 0);
    byBucket.set(bucket, {
      time: bucket,
      open: current.open,
      high: Math.max(current.high, candle.high),
      low: Math.min(current.low, candle.low),
      close: candle.close,
      ...(nextVolume > 0 ? { volume: nextVolume } : {})
    });
  });

  return [...byBucket.values()].sort((a, b) => a.time - b.time);
}

function aggregateLinePoints(points: readonly ChartLinePoint[], unitMinutes: number): ChartLinePoint[] {
  if (unitMinutes <= 0) {
    return [...points].sort((a, b) => a.time - b.time);
  }

  const byBucket = new Map<UTCTimestamp, ChartLinePoint>();
  points.forEach((point) => {
    const bucket = toBucketTime(point.time, unitMinutes);
    byBucket.set(bucket, { time: bucket, value: point.value });
  });

  return [...byBucket.values()].sort((a, b) => a.time - b.time);
}

function aggregateMarkers(input: readonly ChartOverlayMarker[], unitMinutes: number): ChartOverlayMarker[] {
  if (unitMinutes <= 0) {
    return [...input].sort((a, b) => a.time - b.time);
  }

  const byBucket = new Map<UTCTimestamp, ChartOverlayMarker>();
  input.forEach((marker) => {
    const bucket = toBucketTime(marker.time, unitMinutes);
    byBucket.set(bucket, {
      ...marker,
      time: bucket
    });
  });

  return [...byBucket.values()].sort((a, b) => a.time - b.time);
}

function smaSeries(candles: readonly ChartCandle[], period: number): ChartLinePoint[] {
  if (period <= 0 || candles.length < period) {
    return [];
  }

  const points: ChartLinePoint[] = [];
  let sum = 0;
  const buffer: number[] = [];

  candles.forEach((candle) => {
    sum += candle.close;
    buffer.push(candle.close);
    if (buffer.length > period) {
      sum -= buffer.shift() ?? 0;
    }
    if (buffer.length === period) {
      points.push({
        time: candle.time,
        value: sum / period
      });
    }
  });

  return points;
}

function std(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const mean = values.reduce((acc, value) => acc + value, 0) / values.length;
  const variance = values.reduce((acc, value) => acc + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function bollingerSeries(
  candles: readonly ChartCandle[],
  period: number,
  multiplier: number
): Readonly<{ upper: ChartLinePoint[]; mid: ChartLinePoint[]; lower: ChartLinePoint[] }> {
  if (period <= 0 || candles.length < period) {
    return { upper: [], mid: [], lower: [] };
  }

  const closes = candles.map((candle) => candle.close);
  const upper: ChartLinePoint[] = [];
  const mid: ChartLinePoint[] = [];
  const lower: ChartLinePoint[] = [];

  candles.forEach((candle, index) => {
    if (index + 1 < period) {
      return;
    }
    const segment = closes.slice(index + 1 - period, index + 1);
    const mean = segment.reduce((acc, value) => acc + value, 0) / period;
    const deviation = std(segment);
    upper.push({ time: candle.time, value: mean + deviation * multiplier });
    mid.push({ time: candle.time, value: mean });
    lower.push({ time: candle.time, value: mean - deviation * multiplier });
  });

  return { upper, mid, lower };
}

function buildIndicatorOverlays(candles: readonly ChartCandle[], mode: IndicatorMode): ChartOverlayLine[] {
  if (mode === 'NONE') {
    return [];
  }

  if (mode === 'MA') {
    return [
      { id: 'IND-MA5', label: 'MA5', color: '#f59e0b', lineWidth: 1, data: smaSeries(candles, 5) },
      { id: 'IND-MA20', label: 'MA20', color: '#8b5cf6', lineWidth: 1, data: smaSeries(candles, 20) },
      { id: 'IND-MA60', label: 'MA60', color: '#14b8a6', lineWidth: 1, data: smaSeries(candles, 60) }
    ];
  }

  const bb = bollingerSeries(candles, 20, 2);
  return [
    { id: 'IND-BB-UPPER', label: 'BB Upper', color: '#ef4444', data: bb.upper, lineStyle: LineStyle.Dashed },
    { id: 'IND-BB-MID', label: 'BB Mid', color: '#f59e0b', data: bb.mid },
    { id: 'IND-BB-LOWER', label: 'BB Lower', color: '#3b82f6', data: bb.lower, lineStyle: LineStyle.Dashed }
  ];
}

function createDrawingId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function toVolumeValue(candle: ChartCandle): number {
  if (typeof candle.volume === 'number' && candle.volume > 0) {
    return candle.volume;
  }
  return Math.max(0.000001, candle.high - candle.low);
}

function toVolumeColor(candle: ChartCandle): string {
  return candle.close >= candle.open ? 'rgba(225, 82, 65, 0.45)' : 'rgba(58, 125, 246, 0.45)';
}

export function ChartPanel({ candles, overlays = [], markers = [] }: ChartPanelProps) {
  const chartHostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const lineSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const overlaySeriesRef = useRef<ISeriesApi<'Line'>[]>([]);
  const drawingSeriesRef = useRef<ISeriesApi<'Line'>[]>([]);
  const candleMarkersRef = useRef<ISeriesMarkersPluginApi<UTCTimestamp> | null>(null);
  const lineMarkersRef = useRef<ISeriesMarkersPluginApi<UTCTimestamp> | null>(null);
  const modeRef = useRef<ChartMode>('CANDLE');
  const toolRef = useRef<DrawingTool>('NONE');
  const displayedCandlesRef = useRef<readonly ChartCandle[]>([]);
  const pendingTrendStartRef = useRef<ChartLinePoint | undefined>(undefined);
  const fitOnNextDataRef = useRef(true);

  const [timeframe, setTimeframe] = useState<TimeframeKey>('1m');
  const [chartMode, setChartMode] = useState<ChartMode>('CANDLE');
  const [indicatorMode, setIndicatorMode] = useState<IndicatorMode>('MA');
  const [toolMode, setToolMode] = useState<DrawingTool>('NONE');
  const [drawings, setDrawings] = useState<readonly ChartDrawing[]>([]);
  const [pendingTrendStart, setPendingTrendStart] = useState<ChartLinePoint | undefined>(undefined);

  const unitMinutes = useMemo(() => timeframeMinutes(timeframe), [timeframe]);
  const displayedCandles = useMemo(
    () => aggregateCandles(candles, unitMinutes),
    [candles, unitMinutes]
  );
  const overlayLines = useMemo(
    () => overlays
      .map((overlay) => ({
        ...overlay,
        data: aggregateLinePoints(overlay.data, unitMinutes)
      }))
      .filter((overlay) => overlay.data.length > 0),
    [overlays, unitMinutes]
  );
  const indicatorLines = useMemo(
    () => buildIndicatorOverlays(displayedCandles, indicatorMode),
    [displayedCandles, indicatorMode]
  );
  const normalizedMarkers = useMemo(
    () => aggregateMarkers(markers, unitMinutes),
    [markers, unitMinutes]
  );

  useEffect(() => {
    modeRef.current = chartMode;
  }, [chartMode]);

  useEffect(() => {
    toolRef.current = toolMode;
  }, [toolMode]);

  useEffect(() => {
    displayedCandlesRef.current = displayedCandles;
  }, [displayedCandles]);

  useEffect(() => {
    pendingTrendStartRef.current = pendingTrendStart;
  }, [pendingTrendStart]);

  useEffect(() => {
    const el = chartHostRef.current;
    if (!el) return;

    const chart = createChart(el, {
      width: el.clientWidth,
      height: 360,
      layout: {
        textColor: '#1f2937',
        background: { color: '#ffffff' }
      },
      grid: {
        vertLines: { color: '#edf2f7' },
        horzLines: { color: '#edf2f7' }
      },
      rightPriceScale: {
        borderColor: '#d6deea',
        scaleMargins: {
          top: 0.05,
          bottom: 0.23
        }
      },
      timeScale: {
        borderColor: '#d6deea',
        timeVisible: true,
        secondsVisible: false
      },
      crosshair: {
        vertLine: { color: '#94a3b8', labelBackgroundColor: '#111827' },
        horzLine: { color: '#94a3b8', labelBackgroundColor: '#111827' }
      }
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#e15241',
      downColor: '#3a7df6',
      wickUpColor: '#e15241',
      wickDownColor: '#3a7df6',
      borderUpColor: '#e15241',
      borderDownColor: '#3a7df6'
    });

    const lineSeries = chart.addSeries(LineSeries, {
      color: '#2563eb',
      lineWidth: 2,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
      priceLineVisible: true,
      lastValueVisible: true,
      visible: false
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceScaleId: 'volume',
      priceLineVisible: false,
      lastValueVisible: false,
      base: 0
    });
    chart.priceScale('volume').applyOptions({
      scaleMargins: {
        top: 0.78,
        bottom: 0
      },
      borderVisible: false
    });

    candleMarkersRef.current = createSeriesMarkers(candleSeries, [], { zOrder: 'top' }) as ISeriesMarkersPluginApi<UTCTimestamp>;
    lineMarkersRef.current = createSeriesMarkers(lineSeries, [], { zOrder: 'top' }) as ISeriesMarkersPluginApi<UTCTimestamp>;
    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    lineSeriesRef.current = lineSeries;
    volumeSeriesRef.current = volumeSeries;

    const onChartClick = (param: MouseEventParams) => {
      if (!param.point || typeof param.time !== 'number') {
        return;
      }
      const tool = toolRef.current;
      if (tool === 'NONE') {
        return;
      }

      const activeSeries = modeRef.current === 'CANDLE' ? candleSeriesRef.current : lineSeriesRef.current;
      const price = activeSeries?.coordinateToPrice(param.point.y);
      if (typeof price !== 'number') {
        return;
      }
      const time = param.time as UTCTimestamp;
      const clicked = { time, value: price };

      if (tool === 'HORIZONTAL_LINE') {
        setDrawings((prev) => [...prev, { id: createDrawingId('hline'), kind: 'HORIZONTAL_LINE', price }]);
        return;
      }

      const start = pendingTrendStartRef.current;
      if (!start) {
        setPendingTrendStart(clicked);
        return;
      }

      setDrawings((prev) => [
        ...prev,
        { id: createDrawingId('trend'), kind: 'TREND_LINE', start, end: clicked }
      ]);
      setPendingTrendStart(undefined);
    };
    chart.subscribeClick(onChartClick);

    const onResize = () => {
      if (!chartHostRef.current || !chartRef.current) return;
      chartRef.current.applyOptions({ width: chartHostRef.current.clientWidth });
    };

    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      chart.unsubscribeClick(onChartClick);
      candleMarkersRef.current?.detach();
      lineMarkersRef.current?.detach();
      candleMarkersRef.current = null;
      lineMarkersRef.current = null;
      overlaySeriesRef.current = [];
      drawingSeriesRef.current = [];
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      lineSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    candleSeriesRef.current?.applyOptions({ visible: chartMode === 'CANDLE' });
    lineSeriesRef.current?.applyOptions({ visible: chartMode === 'LINE' });
  }, [chartMode]);

  useEffect(() => {
    fitOnNextDataRef.current = true;
  }, [timeframe]);

  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    const lineSeries = lineSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    const chart = chartRef.current;
    if (!candleSeries || !lineSeries || !volumeSeries || !chart) return;

    candleSeries.setData(displayedCandles.map((candle) => ({
      time: candle.time,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close
    })));
    lineSeries.setData(displayedCandles.map((candle) => ({
      time: candle.time,
      value: candle.close
    })));
    volumeSeries.setData(displayedCandles.map((candle) => ({
      time: candle.time,
      value: toVolumeValue(candle),
      color: toVolumeColor(candle)
    })));

    if (fitOnNextDataRef.current) {
      chart.timeScale().fitContent();
      fitOnNextDataRef.current = false;
    }
  }, [displayedCandles]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) {
      return;
    }

    overlaySeriesRef.current.forEach((series) => {
      chart.removeSeries(series);
    });
    overlaySeriesRef.current = [];

    const nextSeries = [...overlayLines, ...indicatorLines]
      .filter((line) => line.data.length > 0)
      .map((overlay) => {
        const series = chart.addSeries(LineSeries, {
          color: overlay.color,
          lineWidth: overlay.lineWidth ?? 1,
          lineStyle: overlay.lineStyle ?? LineStyle.Solid,
          crosshairMarkerVisible: false,
          priceLineVisible: false,
          lastValueVisible: false
        });
        series.setData([...overlay.data]);
        return series;
      });

    overlaySeriesRef.current = nextSeries;
  }, [overlayLines, indicatorLines]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) {
      return;
    }

    drawingSeriesRef.current.forEach((series) => {
      chart.removeSeries(series);
    });
    drawingSeriesRef.current = [];

    const first = displayedCandles[0];
    const last = displayedCandles[displayedCandles.length - 1];
    if (!first || !last) {
      return;
    }

    const nextDrawingSeries = drawings.map((drawing) => {
      const series = chart.addSeries(LineSeries, {
        color: '#111827',
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        crosshairMarkerVisible: false,
        priceLineVisible: false,
        lastValueVisible: false
      });

      if (drawing.kind === 'TREND_LINE') {
        series.setData([drawing.start, drawing.end]);
      } else {
        series.setData([
          { time: first.time, value: drawing.price },
          { time: last.time, value: drawing.price }
        ]);
      }
      return series;
    });

    drawingSeriesRef.current = nextDrawingSeries;
  }, [drawings, displayedCandles]);

  useEffect(() => {
    if (chartMode === 'CANDLE') {
      candleMarkersRef.current?.setMarkers(normalizedMarkers.map((marker) => ({ ...marker })));
      lineMarkersRef.current?.setMarkers([]);
      return;
    }

    lineMarkersRef.current?.setMarkers(normalizedMarkers.map((marker) => ({ ...marker })));
    candleMarkersRef.current?.setMarkers([]);
  }, [chartMode, normalizedMarkers]);

  return (
    <div
      style={{
        width: '100%',
        border: '1px solid #d6deea',
        borderRadius: 8,
        background: '#ffffff',
        padding: 8
      }}
    >
      <Flex align="stretch" gap={8}>
        <Flex vertical gap={6} style={{ width: 64 }}>
          <Button
            size="small"
            type={toolMode === 'NONE' ? 'primary' : 'default'}
            onClick={() => setToolMode('NONE')}
            style={{ fontSize: 0 }}
          >
            <span style={{ fontSize: 14 }}>{TOOL_LABELS.NONE}</span>
            커서
          </Button>
          <Button
            size="small"
            type={toolMode === 'TREND_LINE' ? 'primary' : 'default'}
            onClick={() => setToolMode('TREND_LINE')}
            style={{ fontSize: 0 }}
          >
            <span style={{ fontSize: 14 }}>{TOOL_LABELS.TREND_LINE}</span>
            추세선
          </Button>
          <Button
            size="small"
            type={toolMode === 'HORIZONTAL_LINE' ? 'primary' : 'default'}
            onClick={() => setToolMode('HORIZONTAL_LINE')}
            style={{ fontSize: 0 }}
          >
            <span style={{ fontSize: 14 }}>{TOOL_LABELS.HORIZONTAL_LINE}</span>
            수평선
          </Button>
          <Button
            size="small"
            onClick={() => {
              setDrawings([]);
              setPendingTrendStart(undefined);
            }}
            style={{ fontSize: 0 }}
          >
            <span style={{ fontSize: 14 }}>지우기</span>
            지우기
          </Button>
          <Button
            size="small"
            onClick={() => {
              chartRef.current?.timeScale().fitContent();
            }}
            style={{ fontSize: 0 }}
          >
            <span style={{ fontSize: 14 }}>맞춤</span>
            맞춤
          </Button>
        </Flex>

        <div style={{ flex: 1, minWidth: 0 }}>
          <Flex justify="space-between" align="center" wrap gap={8} style={{ marginBottom: 8 }}>
            <Space wrap size={6}>
              <Segmented
                size="small"
                value={timeframe}
                onChange={(value) => setTimeframe(value as TimeframeKey)}
                options={TIMEFRAME_OPTIONS.map((option) => ({ label: TIMEFRAME_LABELS[option.key], value: option.key }))}
              />
              <Segmented
                size="small"
                value={chartMode}
                onChange={(value) => setChartMode(value as ChartMode)}
                options={[
                  { label: '캔들', value: 'CANDLE' },
                  { label: '라인', value: 'LINE' }
                ]}
              />
              <Segmented
                size="small"
                value={indicatorMode}
                onChange={(value) => setIndicatorMode(value as IndicatorMode)}
                options={[
                  { label: '지표 없음', value: 'NONE' },
                  { label: '이평선', value: 'MA' },
                  { label: '볼린저', value: 'BB' }
                ]}
              />
            </Space>

            <Space size={8}>
              <Text type="secondary">도구: {toolMode === 'NONE' ? '커서' : toolMode === 'TREND_LINE' ? '추세선' : '수평선'}</Text>
            </Space>
          </Flex>

          {pendingTrendStart ? (
            <Text style={{ display: 'block', marginBottom: 6, color: '#b45309' }}>
              추세선 시작점이 선택되었습니다. 두 번째 점을 클릭해 선을 완성하세요.
            </Text>
          ) : null}

          <div ref={chartHostRef} style={{ width: '100%', height: 360 }} />
        </div>
      </Flex>
    </div>
  );
}
