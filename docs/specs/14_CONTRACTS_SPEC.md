# 14_CONTRACTS_SPEC.md
# Contracts 표준 (API/WS DTO + SYSTEM_EVENT enum)

## 0) 목적
- `packages/contracts`를 API/WS payload의 단일 진실로 고정한다.
- 백엔드/프론트의 타입 불일치, 이벤트 스키마 드리프트를 방지한다.
- `SYSTEM_EVENT`의 `eventType`을 명확히 표준화해 운영 로그/알림을 안정화한다.

참조:
- 엔진 계약: `../architecture/06_ARCHITECTURE.md`
- 실험 프로토콜: `10_EXPERIMENT_PROTOCOL.md`
- 구조/타입 안전성: `12_PROJECT_STRUCTURE.md`

---

## 1) 패키지 구조(권장)
```text
packages/contracts/src/
  realtime/
    connection-state.ts
    realtime-status.dto.ts
  system-events/
    system-event-type.ts
    system-event.dto.ts
    system-event.schema.ts
  run/
    run-config.dto.ts
    run-report.dto.ts
  ws/
    ws-channel.ts
    ws-message.dto.ts
    ws-event-envelope.dto.ts
  index.ts
```

원칙:
- DTO 타입과 runtime schema를 같은 경로에서 관리한다.
- API/WS 경계 타입은 `apps/api`, `apps/web` 모두 `packages/contracts`에서 import한다.
- `packages/contracts/src/run/run-config.dto.ts` exports the run control SSOT:
  - `StrategyId`, `RunMode`
  - `FillModelRequested`, `FillModelApplied`
  - `DatasetRefDto`, `RiskSnapshotDto`, `RunConfigDto`
- `packages/contracts/src/run/run-report.dto.ts` exports the run read-model SSOT:
  - `RunKpiDto`, `EntryReadinessDto`
  - `RunHistoryItemDto`, `RunDetailDto`, `RunReportDto`
  - `StrategyAccountSummaryDto`, `StrategyFillPageDto`

---

## 2) SYSTEM_EVENT enum 표준

### 2.1 TypeScript 상수/타입
```ts
export const SYSTEM_EVENT_TYPE = {
  ENGINE_STATE_INVALID: 'ENGINE_STATE_INVALID',
  ENGINE_LOOP_DELAYED: 'ENGINE_LOOP_DELAYED',
  WS_BACKPRESSURE: 'WS_BACKPRESSURE',
  WS_CLIENT_DROPPED: 'WS_CLIENT_DROPPED',
  WS_SERIALIZE_FAILED: 'WS_SERIALIZE_FAILED',
  EXCHANGE_API_ERROR: 'EXCHANGE_API_ERROR',
  DB_WRITE_FAILED: 'DB_WRITE_FAILED',
  QUEUE_PUBLISH_FAILED: 'QUEUE_PUBLISH_FAILED',
  KILL_SWITCH_TRIGGERED: 'KILL_SWITCH_TRIGGERED',
  RISK_LIMIT_BREACH: 'RISK_LIMIT_BREACH',
  LIVE_GUARD_BLOCKED: 'LIVE_GUARD_BLOCKED',
} as const;

export type SystemEventType =
  (typeof SYSTEM_EVENT_TYPE)[keyof typeof SYSTEM_EVENT_TYPE];
```

### 2.2 레벨 표준
```ts
export const SYSTEM_EVENT_LEVEL = {
  DEBUG: 'DEBUG',
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
  FATAL: 'FATAL',
} as const;

export type SystemEventLevel =
  (typeof SYSTEM_EVENT_LEVEL)[keyof typeof SYSTEM_EVENT_LEVEL];
```

---

## 3) SystemEvent DTO 표준
```ts
export type SystemEventDto = Readonly<{
  ts: string; // ISO-8601
  level: SystemEventLevel;
  eventType: SystemEventType;
  message: string;
  runId?: string;
  strategyId?: 'STRAT_A' | 'STRAT_B' | 'STRAT_C';
  mode?: 'PAPER' | 'SEMI_AUTO' | 'AUTO' | 'LIVE';
  fillModelApplied?: 'NEXT_OPEN' | 'ON_CLOSE' | 'NEXT_MINUTE_OPEN' | 'INTRABAR_APPROX';
  traceId: string;
  spanId?: string;
  source: string; // module.service.method
  payload?: Readonly<Record<string, unknown>>;
}>;
```

필수 조건:
- `ts`, `level`, `eventType`, `message`, `traceId`, `source`는 항상 존재.
- 민감정보는 `payload`에 넣기 전에 마스킹.
- 생성 후 불변(`Readonly`) 유지.

---

## 4) Runtime Schema 표준(zod 예시)
```ts
import { z } from 'zod';
import { SYSTEM_EVENT_LEVEL, SYSTEM_EVENT_TYPE } from './system-event-type';

export const SystemEventSchema = z.object({
  ts: z.string().datetime(),
  level: z.enum(Object.values(SYSTEM_EVENT_LEVEL) as [string, ...string[]]),
  eventType: z.enum(Object.values(SYSTEM_EVENT_TYPE) as [string, ...string[]]),
  message: z.string().min(1),
  runId: z.string().optional(),
  strategyId: z.enum(['STRAT_A', 'STRAT_B', 'STRAT_C']).optional(),
  mode: z.enum(['PAPER', 'SEMI_AUTO', 'AUTO', 'LIVE']).optional(),
  fillModelApplied: z.enum(['NEXT_OPEN', 'ON_CLOSE', 'NEXT_MINUTE_OPEN', 'INTRABAR_APPROX']).optional(),
  traceId: z.string().min(1),
  spanId: z.string().optional(),
  source: z.string().min(1),
  payload: z.record(z.unknown()).optional(),
});
```

---

## 5) 버전닝/호환성 규칙
- 필드 추가(하위 호환): `minor` 증가
- 필드 제거/타입 변경(비호환): `major` 증가
- enum 값 추가:
  - 소비자가 unknown-safe 처리 가능한 경우 `minor`
  - strict switch로 누락 시 장애 가능하면 `major`
- 변경 시 체크:
  - `apps/api` 컴파일
  - `apps/web` 컴파일
  - contract 테스트 통과

---

## 6) 실시간 UI 상태 계약

### 6.1 ConnectionState 표준
```ts
export const CONNECTION_STATE = {
  LIVE: 'LIVE',
  DELAYED: 'DELAYED',
  RECONNECTING: 'RECONNECTING',
  ERROR: 'ERROR',
  PAUSED: 'PAUSED',
} as const;

export type ConnectionState =
  (typeof CONNECTION_STATE)[keyof typeof CONNECTION_STATE];
```

### 6.2 RealtimeStatus DTO 표준
```ts
export type RealtimeStatusDto = Readonly<{
  connectionState: ConnectionState;
  lastEventAt?: string; // ISO-8601
  queueDepth?: number;
  retryCount?: number;
  nextRetryInMs?: number;
  staleThresholdMs: number;
}>;
```

### 6.3 WS 이벤트 Envelope 표준
```ts
export type WsEventEnvelopeDto<TPayload = Readonly<Record<string, unknown>>> = Readonly<{
  runId: string;
  seq: number;
  traceId: string;
  eventType: string;
  eventTs: string; // ISO-8601
  payload: TPayload;
}>;
```

### 6.4 실시간 시세/전략 이벤트 payload 표준(현재 구현)
- `MARKET_TICK`
  - `payload.market`: string (예: `KRW-XRP`)
  - `payload.strategyId`: `STRAT_A | STRAT_B | STRAT_C`
  - `payload.strategyVersion`: string
  - `payload.strategyName`: string
  - `payload.tradePrice`: number
  - `payload.tradeVolume`: number
  - `payload.askBid`: string
  - `payload.change`: string
  - `payload.bestBidPrice?`: number
  - `payload.bestAskPrice?`: number
  - `payload.candle`: `{ time, open, high, low, close, volume?, tradeValue?, buyValue?, buyRatio?, bestBidPrice?, bestAskPrice? }`
- 전략 이벤트(`SIGNAL_EMIT`, `APPROVE_ENTER`, `ENTRY_READINESS`, `ORDER_INTENT`, `FILL`, `POSITION_UPDATE`, `EXIT`)
  - `SEMI_AUTO`에서는 `APPROVE_ENTER` 이벤트가 진입 전 반드시 선행된다.
  - 공통: `payload.market`, `payload.candle`, `payload.strategyId`, `payload.strategyVersion`, `payload.strategyName`
  - 이벤트별 세부값:
    - `SIGNAL_EMIT`: `signal`, `reason` + 전략별 세부 필드(`zoneLow`, `zoneHigh`, `targetPrice`, `breakoutLevel`, `tradeValue`, `buyRatio`, `bodyRatio` 등)
    - `APPROVE_ENTER`: `approvalMode`, `entryPolicy`, `suggestedPrice`
    - `ENTRY_READINESS`: `entryReadinessPct`, `entryReady`, `entryExecutable`, `reason`, `inPosition`
    - `ORDER_INTENT`: `side`, `qty`, `price`, `reason`, `notionalKrw?`
    - `FILL`: `side`, `qty`, `fillPrice`, `notionalKrw?`
    - `POSITION_UPDATE`: `side`, `qty`, `avgEntry | realizedPnlPct`, `notionalKrw?`
    - `EXIT`: `reason`, `pnlPct`, `barsHeld`

---

## 7) 운영 규칙
- `ERROR` 이상 `SYSTEM_EVENT`는 알림 채널로 전송한다.
- 동일 `eventType` 연속 발생 임계치 초과 시 `SYSTEM_DEGRADED` 상태로 승격한다.
- `FATAL`, `KILL_SWITCH_TRIGGERED`는 즉시 알림 + run 상태 전이 기록 필수.

---

## 8) 변경 프로세스
1. `packages/contracts` 타입/스키마 수정
2. 본 문서(14)와 `06`, `10`, `12` 영향 검토
3. API/WS contract 테스트 통과
4. PR에 마이그레이션 노트 첨부(변경 이유, 영향 범위, 롤백 방법)

---

## 9) API 엔드포인트(현재 구현)
- `GET /runs/history?strategyId=&strategyVersion=&mode=&market=&from=&to=`
- `GET /runs/:runId`
- `GET /runs/:runId/config`
- `GET /runs/:runId/candles?limit=300`
- `GET /runs/:runId/run_report.json`
- `GET /runs/:runId/events.jsonl`
- `GET /runs/:runId/trades.csv`
- `GET /runs/strategies/:strategyId/fills?page=&pageSize=`
- `GET /runs/strategies/:strategyId/account-summary`
- `GET /reports/compare?strategyVersion=&from=&to=&mode=&market=`
- `GET /reports/benchmark-compare?strategyId=&strategyVersion=`
- `PATCH /runs/:runId/control`
  - body:
    - `strategyId?: STRAT_A|STRAT_B|STRAT_C`
    - `mode?: PAPER|SEMI_AUTO|AUTO|LIVE`
    - `market?: string`
    - `fillModelRequested?: AUTO|NEXT_OPEN|ON_CLOSE|NEXT_MINUTE_OPEN|INTRABAR_APPROX`
    - `fillModelApplied?: NEXT_OPEN|ON_CLOSE|NEXT_MINUTE_OPEN|INTRABAR_APPROX`
    - `entryPolicy?: string`
- `GET /ops/metrics`
  - runtime counters:
    - `wsConnections`, `wsDisconnections`
    - `wsActiveClients`
    - `eventsIngested`, `marketTicks`, `signals`, `fills`, `exits`
    - `dbWriteFailures`, `wsPushFailures`
    - `runConfigMismatches`
    - `upbitReconnectAttempts`, `upbitReconnectRecoveries`, `upbitAvgRecoveryMs`
    - `lastDisconnectAt`
    - `lastEventAt`

`GET /runs/history` 응답 KPI 필드(현재):
- `trades`, `exits`
- `winRate`, `sumReturnPct`, `mddPct`
- `profitFactor`, `avgWinPct`, `avgLossPct`
- `strategyVersion`

`GET /runs/history` KPI contract note:
- `trades`는 raw `FILL` 개수가 아니라 완료된 round-trip trade 개수다.
- `winRate`, `sumReturnPct`, `profitFactor`, `avgWinPct`, `avgLossPct`, `mddPct`는 실제 매칭된 진입/청산 체결의 순손익 기준으로 계산한다.
- `exits`는 참고용 raw `EXIT` 이벤트 개수이며, `trades`보다 클 수 있다.

`GET /runs/:runId` 응답 추가 필드(현재):
- `runConfig`
  - `strategyId`, `mode`, `market`
  - `strategyVersion`
  - `fillModelRequested`, `fillModelApplied`, `entryPolicy`
  - `riskSnapshot.dailyLossLimitPct`
  - `riskSnapshot.maxConsecutiveLosses`
  - `riskSnapshot.maxDailyOrders`
  - `riskSnapshot.killSwitch`
  - `updatedAt`
- `latestEntryReadiness`
  - `entryReadinessPct`
  - `entryReady`
  - `entryExecutable`
  - `reason`
  - `inPosition`

`GET /runs/strategies/:strategyId/fills` contract note:
- returns latest-first fill rows after merging persisted fills and runtime-retained fills
- must not drop rows just because `MARKET_TICK` events rotated out of the general run event window

`GET /runs/strategies/:strategyId/account-summary` contract note:
- summary must use the same merged fill source as the fill table so live holdings/PnL do not reset to zero after event retention
- `markPriceKrw` must resolve to the latest retained strategy market price/candle close when available, not only the last fill price
- `marketValueKrw`, `equityKrw`, `unrealizedPnlKrw`, `totalPnlKrw`, and `totalPnlPct` are mark-to-market fields and may move on live market updates without a new `FILL`
- `positionQty`, `avgEntryPriceKrw`, `realizedPnlKrw`, and `fillCount` remain fill-driven fields
- `avgEntryPriceKrw` and `realizedPnlKrw` must use fee/slippage-adjusted net execution values, not raw fill price only

`payload.candle` contract note:
- `payload.candle.time` is the candle start bucket in Unix seconds.
- `payload.candle` may include `tradeValue`, `buyValue`, `buyRatio`, `bestBidPrice`, `bestAskPrice` when the runtime derived them from live trade/orderbook flow.
- For Upbit REST snapshot candles, `payload.candle.time` must be derived from `candle_date_time_utc`, not the REST `timestamp` field.

## 10) Realtime Status Contract Notes (ASCII appendix)
- `GET /runs/:runId` may include `realtimeStatus`.
- `realtimeStatus` fields follow `packages/contracts/src/realtime/realtime-status.dto.ts`.
- `realtimeStatus.connectionState` is a derived view, not a raw websocket field.
- Derivation priority:
  1. transport state (`RECONNECTING`, `PAUSED`, `ERROR`)
  2. snapshot delay
  3. persistence backlog
  4. stale last-event age
  5. `LIVE`
- `queueDepth`, `retryCount`, and `nextRetryInMs` are optional because they only appear while recovery work is active.

## 11) Persistence Recovery Contract Notes (ASCII appendix)
- `RealtimeGateway` must not publish a run event to websocket subscribers before DB persistence succeeds.
- If DB persistence fails, the accepted event remains in runtime memory and enters the ordered persistence buffer for that run.
- When persistence recovers, buffered events are published in original arrival order for that run.

## 12) Fill Ledger Contract Notes (ASCII appendix)
- `GET /runs/strategies/:strategyId/fills` must read persisted rows from `public.text_fills`, not by re-filtering `public.text_run_events`.
- The response shape stays `WsEventEnvelopeDto` for backward compatibility with the web client.
- `GET /runs/strategies/:strategyId/account-summary` must use the same merged fill source as the fill table:
  - persisted ledger rows from `text_fills`
  - runtime-retained fills that are accepted but not fully flushed yet
- `public.text_run_events` remains available for run detail/history/debugging, but it is not the durable fill ledger.

## 13) Entry Sizing Contract Notes (ASCII appendix)
- `runConfig.riskSnapshot` includes `seedKrw` and `maxPositionRatio` in addition to daily loss/order/kill-switch fields.
- STRAT_C may size entry directly from `c.order.fixedKrw`; in that case `notionalKrw` follows the fixed-order result and does not use `maxPositionRatio`.
- BUY execution payload contract:
  - `ORDER_INTENT.qty`, `FILL.qty`, and `POSITION_UPDATE.qty` must match for one accepted entry
- SELL execution payload contract:
  - `ORDER_INTENT.qty` and `FILL.qty` must use the current open position qty, not a default literal
- `notionalKrw` may be included on `ORDER_INTENT` and `FILL` payloads for display/debugging; clients must treat it as optional metadata.

## 14) Trades CSV Contract Notes (ASCII appendix)
- `GET /runs/:runId/trades.csv` must be derived from actual accepted `EXIT` + `FILL` events.
- The artifact must not synthesize placeholder exit reasons or fake return percentages.
- Each row represents one completed round-trip trade and `netReturnPct` must be net of configured fee/slippage assumptions.

## 15) Run Report Artifact Contract Notes (ASCII appendix)
- `GET /runs/:runId/run_report.json` returns the JSON artifact contract represented by `packages/contracts/src/run/run-report.dto.ts`.
- `report.execution.*` must echo the same run control snapshot used by `GET /runs/:runId`.
- `report.results.trades.*` and `report.results.pnl.*` must reuse the same fee/slippage-adjusted closed-trade derivation used by run history KPI.
- `report.results.trades.profitFactor` is required so persisted run-report summaries can drive `/reports/compare` without recomputing full event history.
- `report.artifacts.*` stores Storage-relative artifact paths rooted at `run-artifacts/<runId>/...`.
- Generated artifacts are uploaded best-effort to Supabase Storage while `GET /runs/:runId/run_report.json`, `trades.csv`, and `events.jsonl` continue to serve the same content directly from the API.

## 16) Shared Run-Control Rules Contract Notes (ASCII appendix)
- `packages/contracts/src/run/run-control-rules.ts` is the SSOT for strategy-aware run-control constraints used by the web control panel and regression tests.
- The module currently defines:
  - allowed run modes per strategy
  - allowed requested/applied fill models per strategy/mode
  - derived `entryPolicy`
  - strategy-specific control-note text
  - strategy-specific overlay payload extraction for `zoneHigh`, `zoneLow`, `targetPrice`, and `breakoutLevel`

## 17) Strategy-document Benchmark Compare Contract Notes (ASCII appendix)
- `GET /reports/benchmark-compare` returns the contract represented by `packages/contracts/src/run/run-benchmark.dto.ts`.
- The response must emit one row per requested strategy with:
  - `status`: `MATCHED|DATASET_MISMATCH|EXECUTION_POLICY_MISMATCH|PARAMETER_MISMATCH|RULE_IMPLEMENTATION_GAP|BLOCKED|NO_CANDIDATE`
  - `benchmark`: normalized document profile (dataset, execution, parameter, metric targets)
  - `candidate`: the selected persisted run-report candidate, when available, including `candidate.datasetRef`
  - `metricComparisons`: target vs actual deltas for the benchmark metrics
  - `checks.datasetExact`: exact dataset identity gate
  - `docClaimEligible`: true only when the candidate is `MATCHED` and `dataset_ref` proves exact equality
- Metric comparison must prefer persisted `text_run_reports.kpi` over ad-hoc history recomputation.
- `RunConfigDto.datasetRef`, `RunHistoryItemDto.datasetRef`, and `RunReportDto.dataset.datasetRef` are the SSOT fields for dataset identity.
- Dataset/execution/fee verification may reconstruct the selected `run_report.json`, but the endpoint may still return `MATCHED` with `docClaimEligible=false` when dataset compatibility is known but exact replay identity is not.
