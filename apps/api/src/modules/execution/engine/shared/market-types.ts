export type TimeframeKey = '1m' | '15m' | '1h';

export type StrategyCandle = Readonly<{
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number | undefined;
  tradeValue?: number | undefined;
  buyValue?: number | undefined;
  buyRatio?: number | undefined;
}>;

export type OrderbookTop = Readonly<{
  bidPrice: number;
  askPrice: number;
  bidSize?: number | undefined;
  askSize?: number | undefined;
  tsMs: number;
}>;

export type RealtimePriceTick = Readonly<{
  market: string;
  price: number;
  volume?: number | undefined;
  askBid?: string | undefined;
  tsMs: number;
  bestBidPrice?: number | undefined;
  bestAskPrice?: number | undefined;
}>;

export type StrategyMarketEvent =
  | Readonly<{
    type: 'CANDLE_OPEN';
    timeframe: TimeframeKey;
    candle: StrategyCandle;
  }>
  | Readonly<{
    type: 'CANDLE_CLOSE';
    timeframe: TimeframeKey;
    candle: StrategyCandle;
  }>
  | Readonly<{
    type: 'TRADE_TICK';
    tick: RealtimePriceTick;
  }>
  | Readonly<{
    type: 'TICKER';
    tick: RealtimePriceTick;
  }>
  | Readonly<{
    type: 'ORDERBOOK';
    orderbook: OrderbookTop;
  }>;

export type StrategyPositionSnapshot = Readonly<{
  qty: number;
  initialQty: number;
  avgEntryPrice: number;
  entryTime: number;
  entryNotionalKrw?: number | undefined;
  barsHeld: number;
  partialExitQty: number;
  realizedPnlPct: number;
  realizedPnlKrw: number;
  lastExitReason?: string | undefined;
}>;

export type StrategyAStage = 'FLAT' | 'WAIT_CONFIRM' | 'WAIT_ENTRY' | 'IN_POSITION' | 'IN_TRAIL';
export type StrategyBStage = 'FLAT' | 'WAIT_POI' | 'WAIT_CONFIRM' | 'WAIT_APPROVAL' | 'WAIT_ENTRY' | 'IN_POSITION';
export type StrategyCStage = 'IDLE' | 'ENTRY_PENDING' | 'IN_POSITION' | 'EXIT_PENDING' | 'COOLDOWN' | 'PAUSED';

export type StratAPendingExit = Readonly<{
  reason: 'TP_PARTIAL' | 'TIME_EXIT' | 'STOP_OR_TRAIL';
  executeAt: number;
  qtyRatio: number;
}>;

export type StratAState = Readonly<{
  stage: StrategyAStage;
  triggerCandleTime?: number | undefined;
  confirmCandleTime?: number | undefined;
  pendingEntryAt?: number | undefined;
  stopPrice?: number | undefined;
  trailingStop?: number | undefined;
  regime?: 'RANGING' | 'TRENDING' | 'VOLATILE' | undefined;
  partialDone?: boolean | undefined;
  atrAtEntry?: number | undefined;
  pendingExit?: StratAPendingExit | undefined;
}>;

export type StrategyBZone = Readonly<{
  zoneLow: number;
  zoneHigh: number;
  obLow: number;
  obHigh: number;
  targetPrice: number;
  createdAt: number;
  expiresAt: number;
  sourceTime: number;
  trendLineSlope: number;
  trendLineBase: number;
  bullModeAtCreation: boolean;
}>;

export type StratBState = Readonly<{
  stage: StrategyBStage;
  bullMode: boolean;
  activeZone?: StrategyBZone | undefined;
  pendingApprovalAt?: number | undefined;
  pendingEntryAt?: number | undefined;
  pendingSignalTime?: number | undefined;
  stopPrice?: number | undefined;
  targetPrice?: number | undefined;
}>;

export type StratCState = Readonly<{
  stage: StrategyCStage;
  pendingEntryAt?: number | undefined;
  pendingExitReason?: 'TP1' | 'TP2' | 'SL' | 'TIME' | undefined;
  tp1Done?: boolean | undefined;
  tp1Price?: number | undefined;
  tp2Price?: number | undefined;
  stopPrice?: number | undefined;
  cooldownUntil?: number | undefined;
  pausedUntil?: number | undefined;
  consecutiveStops: number;
  lastTradeValue?: number | undefined;
  lastBuyValue?: number | undefined;
  lastBuyRatio?: number | undefined;
  lastBodyRatio?: number | undefined;
  lastBreakoutLevel?: number | undefined;
}>;
