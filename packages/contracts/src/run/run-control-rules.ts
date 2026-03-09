import type {
  FillModelApplied,
  FillModelRequested,
  RunMode,
  StrategyId
} from './run-config.dto';
import type { WsEventEnvelopeDto } from '../ws/ws-event-envelope.dto';

const ALLOWED_MODES_BY_STRATEGY: Readonly<Record<StrategyId, readonly RunMode[]>> = {
  STRAT_A: ['PAPER', 'AUTO', 'LIVE'],
  STRAT_B: ['PAPER', 'SEMI_AUTO', 'AUTO', 'LIVE'],
  STRAT_C: ['PAPER', 'AUTO', 'LIVE']
};

export type StrategyOverlayLevels = Readonly<{
  zoneHigh?: number;
  zoneLow?: number;
  targetPrice?: number;
  breakoutLevel?: number;
}>;

export function getAllowedModes(strategyId: StrategyId): readonly RunMode[] {
  return ALLOWED_MODES_BY_STRATEGY[strategyId];
}

export function getAllowedRequestedFillModels(
  strategyId: StrategyId,
  mode: RunMode
): readonly FillModelRequested[] {
  if (strategyId === 'STRAT_A') {
    return ['AUTO', 'NEXT_OPEN', 'ON_CLOSE'];
  }
  if (strategyId === 'STRAT_B') {
    return mode === 'SEMI_AUTO'
      ? ['AUTO', 'NEXT_OPEN']
      : ['AUTO', 'ON_CLOSE', 'NEXT_OPEN'];
  }
  return ['AUTO', 'NEXT_MINUTE_OPEN'];
}

export function getAllowedAppliedFillModels(
  strategyId: StrategyId,
  mode: RunMode
): readonly FillModelApplied[] {
  if (strategyId === 'STRAT_A') {
    return ['NEXT_OPEN', 'ON_CLOSE'];
  }
  if (strategyId === 'STRAT_B') {
    return mode === 'SEMI_AUTO'
      ? ['NEXT_OPEN']
      : ['ON_CLOSE', 'NEXT_OPEN'];
  }
  return ['NEXT_MINUTE_OPEN'];
}

export function normalizeAllowedValue<T extends string>(
  value: T,
  allowedValues: readonly T[]
): T {
  if (allowedValues.includes(value)) {
    return value;
  }
  return allowedValues[0] as T;
}

export function deriveEntryPolicy(
  strategyId: StrategyId,
  mode: RunMode,
  fillModelApplied: FillModelApplied
): string {
  if (strategyId === 'STRAT_A') {
    return fillModelApplied === 'ON_CLOSE' ? 'A_CONFIRM_ON_CLOSE' : 'A_CONFIRM_NEXT_OPEN';
  }
  if (strategyId === 'STRAT_B') {
    if (mode === 'SEMI_AUTO') {
      return 'B_SEMI_AUTO_NEXT_OPEN_AFTER_APPROVAL';
    }
    return fillModelApplied === 'NEXT_OPEN' ? 'B_POI_TOUCH_CONFIRM_NEXT_OPEN' : 'B_POI_TOUCH_CONFIRM_ON_CLOSE';
  }
  return 'C_NEXT_MINUTE_OPEN';
}

export function buildControlConstraintNote(
  strategyId: StrategyId,
  mode: RunMode
): string {
  if (strategyId === 'STRAT_A') {
    return 'STRAT_A는 NEXT_OPEN 또는 ON_CLOSE만 허용하며 SEMI_AUTO를 사용하지 않습니다.';
  }
  if (strategyId === 'STRAT_B') {
    return mode === 'SEMI_AUTO'
      ? 'STRAT_B SEMI_AUTO는 승인 후 NEXT_OPEN만 허용합니다.'
      : 'STRAT_B AUTO/PAPER/LIVE는 ON_CLOSE 또는 NEXT_OPEN을 사용할 수 있습니다.';
  }
  return 'STRAT_C는 NEXT_MINUTE_OPEN 고정 전략이며 SEMI_AUTO를 사용하지 않습니다.';
}

export function extractStrategyOverlayLevels(
  strategyId: StrategyId,
  events: readonly WsEventEnvelopeDto[]
): StrategyOverlayLevels {
  if (strategyId === 'STRAT_B') {
    const zoneHigh = findLatestNumericPayloadValue(events, ['zoneHigh']);
    const zoneLow = findLatestNumericPayloadValue(events, ['zoneLow']);
    const targetPrice = findLatestNumericPayloadValue(events, ['targetPrice']);
    return {
      ...(typeof zoneHigh === 'number' ? { zoneHigh } : {}),
      ...(typeof zoneLow === 'number' ? { zoneLow } : {}),
      ...(typeof targetPrice === 'number' ? { targetPrice } : {})
    };
  }

  if (strategyId === 'STRAT_C') {
    const breakoutLevel = findLatestNumericPayloadValue(events, ['breakoutLevel', 'lastBreakoutLevel']);
    return typeof breakoutLevel === 'number'
      ? { breakoutLevel }
      : {};
  }

  return {};
}

function findLatestNumericPayloadValue(
  events: readonly WsEventEnvelopeDto[],
  keys: readonly string[]
): number | undefined {
  const ordered = [...events].sort((a, b) => {
    const tsDiff = Date.parse(b.eventTs) - Date.parse(a.eventTs);
    if (Number.isFinite(tsDiff) && tsDiff !== 0) {
      return tsDiff;
    }
    return b.seq - a.seq;
  });

  for (const event of ordered) {
    const payload = event.payload as Readonly<Record<string, unknown>>;
    for (const key of keys) {
      const value = payload[key];
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
    }
  }

  return undefined;
}
