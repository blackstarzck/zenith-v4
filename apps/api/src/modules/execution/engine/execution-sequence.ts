export type StrategyEventDecision = Readonly<{
  eventType: 'SIGNAL_EMIT' | 'ORDER_INTENT' | 'FILL' | 'POSITION_UPDATE' | 'EXIT' | 'APPROVE_ENTER';
  payload: Readonly<Record<string, unknown>>;
}>;

type LongEntrySequenceInput = Readonly<{
  price: number;
  qty?: number;
  notionalKrw?: number;
  orderReason: string;
  signalPayload?: Readonly<Record<string, unknown>>;
  includeSignal?: boolean;
  fillPrice?: number;
  positionPayload?: Readonly<Record<string, unknown>>;
}>;

type ExitSequenceInput = Readonly<{
  price: number;
  qty?: number;
  notionalKrw?: number;
  orderReason: string;
  exitPayload: Readonly<Record<string, unknown>>;
  fillPrice?: number;
  positionPayload?: Readonly<Record<string, unknown>>;
}>;

type SemiAutoApprovalSequenceInput = Readonly<{
  suggestedPrice: number;
  signalPayload?: Readonly<Record<string, unknown>>;
  approvalMode?: string;
  entryPolicy?: string;
}>;

export function buildLongEntrySequence(input: LongEntrySequenceInput): readonly StrategyEventDecision[] {
  const qty = normalizeQty(input.qty);
  const fillPrice = input.fillPrice ?? input.price;
  const notionalPayload = typeof input.notionalKrw === 'number'
    ? { notionalKrw: roundMoney(input.notionalKrw) }
    : {};
  const decisions: StrategyEventDecision[] = [];

  if (input.includeSignal !== false) {
    decisions.push({
      eventType: 'SIGNAL_EMIT',
      payload: input.signalPayload ?? {
        signal: 'LONG_ENTRY',
        reason: input.orderReason
      }
    });
  }

  decisions.push({
    eventType: 'ORDER_INTENT',
    payload: {
      side: 'BUY',
      qty,
      price: input.price,
      reason: input.orderReason,
      ...notionalPayload
    }
  });
  decisions.push({
    eventType: 'FILL',
    payload: {
      side: 'BUY',
      qty,
      fillPrice,
      ...notionalPayload
    }
  });
  decisions.push({
    eventType: 'POSITION_UPDATE',
    payload: input.positionPayload ?? {
      side: 'LONG',
      qty,
      avgEntry: fillPrice,
      ...notionalPayload
    }
  });

  return decisions;
}

export function buildExitSequence(input: ExitSequenceInput): readonly StrategyEventDecision[] {
  const qty = normalizeQty(input.qty);
  const fillPrice = input.fillPrice ?? input.price;
  const realizedPnlPct = input.exitPayload.pnlPct;
  const notionalPayload = typeof input.notionalKrw === 'number'
    ? { notionalKrw: roundMoney(input.notionalKrw) }
    : {};

  return [
    {
      eventType: 'EXIT',
      payload: input.exitPayload
    },
    {
      eventType: 'ORDER_INTENT',
      payload: {
        side: 'SELL',
        qty,
        price: input.price,
        reason: input.orderReason,
        ...notionalPayload
      }
    },
    {
      eventType: 'FILL',
      payload: {
        side: 'SELL',
        qty,
        fillPrice,
        ...notionalPayload
      }
    },
    {
      eventType: 'POSITION_UPDATE',
      payload: input.positionPayload ?? {
        side: 'FLAT',
        qty: 0,
        ...(typeof realizedPnlPct === 'number' ? { realizedPnlPct } : {})
      }
    }
  ];
}

export function buildSemiAutoApprovalSequence(
  input: SemiAutoApprovalSequenceInput
): readonly StrategyEventDecision[] {
  const decisions: StrategyEventDecision[] = [];

  if (input.signalPayload) {
    decisions.push({
      eventType: 'SIGNAL_EMIT',
      payload: input.signalPayload
    });
  }

  decisions.push({
    eventType: 'APPROVE_ENTER',
    payload: {
      approvalMode: input.approvalMode ?? 'SEMI_AUTO',
      entryPolicy: input.entryPolicy ?? 'NEXT_OPEN_AFTER_APPROVAL',
      suggestedPrice: input.suggestedPrice
    }
  });

  return decisions;
}

function normalizeQty(qty: number | undefined): number {
  return typeof qty === 'number' && Number.isFinite(qty) && qty > 0 ? qty : 1;
}

function roundMoney(value: number): number {
  return Number(value.toFixed(2));
}
