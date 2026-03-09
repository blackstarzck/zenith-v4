import type { StrategyDocBenchmarkDto } from '@zenith/contracts';

export const STRATEGY_DOC_BENCHMARKS: readonly StrategyDocBenchmarkDto[] = [
  {
    strategyId: 'STRAT_A',
    sourcePath: 'C:\\Users\\chanki\\Downloads\\strat_a_win_rate_90.txt',
    benchmarkLabel: 'STRAT_A doc benchmark (KRW-XRP, 15m, 2026-02)',
    benchmarkAvailable: true,
    dataset: {
      market: 'KRW-XRP',
      timeframes: ['15m'],
      feeds: ['candle:15m'],
      dateRangeLabel: '2026-02',
      datasetRefRequired: true
    },
    execution: {
      allowedEntryPolicies: ['A_CONFIRM_NEXT_OPEN', 'A_CONFIRM_ON_CLOSE'],
      allowedFillModelApplied: ['NEXT_OPEN', 'ON_CLOSE']
    },
    parameters: {
      feeMode: 'PER_SIDE',
      feePerSide: 0.0005
    },
    metrics: [
      {
        key: 'winRate',
        label: 'Win rate',
        target: 90,
        tolerance: 0.5,
        required: true
      },
      {
        key: 'avgTradeReturnPct',
        label: 'Average trade return %',
        target: 1.009,
        tolerance: 0.05,
        required: true
      },
      {
        key: 'mddPct',
        label: 'MDD %',
        target: -0.405,
        tolerance: 0.05,
        required: true
      }
    ],
    notes: [
      'Doc source states KRW-XRP, 15m, 2026-02 and fee 0.05% per side.',
      'Comparison uses fee/slippage-adjusted round-trip KPI from persisted run reports.'
    ]
  },
  {
    strategyId: 'STRAT_B',
    sourcePath: 'C:\\Users\\chanki\\Downloads\\xrp_ob_fvg_backtest_trades_202602.csv',
    benchmarkLabel: 'STRAT_B CSV benchmark (KRW-XRP, 15m+1h, 2026-02)',
    benchmarkAvailable: true,
    dataset: {
      market: 'KRW-XRP',
      timeframes: ['15m', '1h'],
      feeds: ['candle:15m', 'candle:1h'],
      dateRangeLabel: '2026-02',
      datasetRefRequired: true
    },
    execution: {
      allowedModes: ['PAPER', 'AUTO'],
      allowedEntryPolicies: ['B_POI_TOUCH_CONFIRM_NEXT_OPEN', 'B_POI_TOUCH_CONFIRM_ON_CLOSE'],
      allowedFillModelRequested: ['AUTO'],
      allowedFillModelApplied: ['NEXT_OPEN', 'ON_CLOSE']
    },
    parameters: {
      feeMode: 'PER_SIDE',
      feePerSide: 0.0005,
      slippageAssumedPct: 0
    },
    metrics: [
      {
        key: 'winRate',
        label: 'Win rate',
        target: 54.5455,
        tolerance: 0.1,
        required: true
      },
      {
        key: 'avgTradeReturnPct',
        label: 'Average trade return %',
        target: 0.5685,
        tolerance: 0.05,
        required: true
      },
      {
        key: 'mddPct',
        label: 'MDD %',
        target: -4.697,
        tolerance: 0.1,
        required: true
      },
      {
        key: 'tradeCount',
        label: 'Trade count',
        target: 11,
        tolerance: 0,
        required: true
      }
    ],
    notes: [
      'Benchmark source is the user-provided CSV: xrp_ob_fvg_backtest_trades_202602.csv.',
      'CSV-derived KPI: 11 trades, 54.5455% win rate, 0.5685% average trade return, -4.697% MDD, and about 6.1641% net equity growth.',
      'The CSV gross/net delta is consistently 0.001, so the benchmark assumes 0.05% per side fee and zero slippage.',
      'Exact document-equivalence still requires a replay/backtest run with dataset_ref.exact=true for the same 2026-02 KRW-XRP dataset.'
    ]
  },
  {
    strategyId: 'STRAT_C',
    sourcePath: 'C:\\Users\\chanki\\Downloads\\strat_c_win_rate_56.txt',
    benchmarkLabel: 'STRAT_C doc benchmark (KRW-XRP, 1m, 2026-02)',
    benchmarkAvailable: true,
    dataset: {
      market: 'KRW-XRP',
      timeframes: ['1m'],
      feeds: ['trade', 'ticker', 'orderbook', 'candle:1m'],
      dateRangeLabel: '2026-02',
      datasetRefRequired: true
    },
    execution: {
      allowedEntryPolicies: ['C_NEXT_MINUTE_OPEN'],
      allowedFillModelRequested: ['AUTO', 'NEXT_MINUTE_OPEN'],
      allowedFillModelApplied: ['NEXT_MINUTE_OPEN']
    },
    parameters: {},
    metrics: [
      {
        key: 'winRate',
        label: 'Win rate',
        target: 56.25,
        tolerance: 0.5,
        required: true
      },
      {
        key: 'tradeCount',
        label: 'Trade count',
        target: 32,
        tolerance: 0,
        required: false,
        inferred: true
      }
    ],
    notes: [
      'The OCR text appears to mention 32 trades; keep that metric informational until the original source is normalized.',
      'Benchmark validation must preserve trade + ticker + orderbook-derived signal flow.'
    ]
  }
];

export function getStrategyDocBenchmarks(): readonly StrategyDocBenchmarkDto[] {
  return STRATEGY_DOC_BENCHMARKS;
}
