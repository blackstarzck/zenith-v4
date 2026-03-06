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
  - `payload.tradePrice`: number
  - `payload.tradeVolume`: number
  - `payload.candle`: `{ time, open, high, low, close }` (1분 OHLC)
- 전략 이벤트(`SIGNAL_EMIT`, `ORDER_INTENT`, `FILL`, `POSITION_UPDATE`, `EXIT`)
  - `SEMI_AUTO`에서는 `APPROVE_ENTER` 이벤트가 진입 전 반드시 선행된다.
  - 공통: `payload.market`, `payload.candle`, `payload.strategy`
  - 이벤트별 세부값:
    - `SIGNAL_EMIT`: `signal`, `candleReturnPct`, `thresholdPct`
    - `ORDER_INTENT`: `side`, `qty`, `price`, `reason`
    - `FILL`: `side`, `qty`, `fillPrice`
    - `POSITION_UPDATE`: `side`, `qty`, `avgEntry | realizedPnlPct`
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
- `GET /runs/:runId/events.jsonl`
- `GET /runs/:runId/trades.csv`
- `GET /reports/compare?strategyVersion=&from=&to=&mode=&market=`
- `PATCH /runs/:runId/control`
  - body:
    - `strategyId?: STRAT_A|STRAT_B|STRAT_C`
    - `mode?: PAPER|SEMI_AUTO|AUTO|LIVE`
    - `market?: string`
    - `fillModelRequested?: AUTO|NEXT_OPEN|ON_CLOSE`
    - `fillModelApplied?: NEXT_OPEN|ON_CLOSE`
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
