import { useEffect, useRef } from 'react';
import { CandlestickSeries, createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts';

type ChartPanelProps = Readonly<{
  delayed: boolean;
  candles: readonly ChartCandle[];
}>;

export type ChartCandle = Readonly<{
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
}>;

export function ChartPanel({ delayed, candles }: ChartPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      width: el.clientWidth,
      height: 270,
      layout: {
        textColor: '#1f2a37',
        background: { color: delayed ? '#fffaf0' : '#f8fbff' }
      },
      grid: {
        vertLines: { color: '#e6edf5' },
        horzLines: { color: '#e6edf5' }
      },
      rightPriceScale: {
        borderColor: '#d6deea'
      },
      timeScale: {
        borderColor: '#d6deea',
        timeVisible: true,
        secondsVisible: false
      }
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#16a34a',
      downColor: '#dc2626',
      borderVisible: false,
      wickUpColor: '#16a34a',
      wickDownColor: '#dc2626'
    });

    chartRef.current = chart;
    seriesRef.current = series;

    const onResize = () => {
      if (!containerRef.current || !chartRef.current) return;
      chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
    };

    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [delayed]);

  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart || candles.length === 0) return;
    series.setData([...candles]);
    chart.timeScale().fitContent();
  }, [candles]);

  return <div ref={containerRef} style={{ width: '100%' }} />;
}
