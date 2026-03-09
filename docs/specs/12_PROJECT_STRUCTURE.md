# 12_PROJECT_STRUCTURE.md
# 프로젝트 디렉토리 구조 표준 (React + NestJS + 실시간 WebSocket)

## 0) 목적
- 프론트엔드(React)와 백엔드(NestJS)의 디렉토리 구조를 고정해 확장 시 혼선을 줄인다.
- 실시간 WebSocket 프로젝트에서 병목/경합/타입 불일치를 줄이는 구조를 강제한다.
- DTO/TypeScript 중심의 타입 안전성과 불변성 규칙을 명문화한다.

참조:
- 프론트 개발 규칙: `../guides/02_DEV_GUIDE.md`
- 디자인/IA: `../guides/04_DESIGN_GUIDE.md`, `11_IA.md`
- 엔진 계약: `../architecture/06_ARCHITECTURE.md`
- 실험/리포트 규격: `10_EXPERIMENT_PROTOCOL.md`
- contracts 타입/enum 표준: `14_CONTRACTS_SPEC.md`
- Supabase 저장 모델: `17_SUPABASE_PERSISTENCE.md`

---

## 1) 저장소 루트 구조(권장)
```text
zenith-v4/
  apps/
    web/                      # React
    api/                      # NestJS
  packages/
    contracts/                # 공통 타입/DTO/이벤트 스키마(zod/class-validator 병행 가능)
    utils/                    # 순수 유틸(무상태, 부작용 최소)
    config/                   # eslint/tsconfig 공유 설정
  docs/                       # 선택: 문서 모음(현재는 루트 md 사용 중)
  infra/                      # docker, compose, deploy 스크립트
```

원칙:
- `apps/web`은 UI/상태/뷰 모델만 담당.
- `apps/api`는 도메인/실행엔진/데이터파이프라인 담당.
- `packages/contracts`가 API/WS 메시지의 단일 타입 기준이다.

---

## 2) 프론트엔드 구조(React 최적화)

### 2.1 디렉토리
```text
apps/web/src/
  app/
    router/                   # route config
    providers/                # QueryClientProvider, ThemeProvider 등
    store/                    # 전역 UI store(zustand/redux 중 1개)
  features/
    runs/
      pages/
      components/
      hooks/
      api/                    # feature 전용 query/mutation
      model/                  # view model / selectors
    strategies/
    experiments/
    reports/
    settings/
  entities/
    run/
    strategy/
    order/
    fill/                     # 도메인 단위 공용 모델
  shared/
    ui/
    lib/
    hooks/
    constants/
    types/                    # contracts를 감싼 프론트 전용 확장 타입
```

### 2.2 프론트 구조 규칙
- 페이지는 `features/*/pages`에만 둔다.
- API 호출은 `features/*/api`로 모아 UI 컴포넌트에서 직접 fetch하지 않는다.
- 서버 상태는 TanStack Query로, UI 상태는 단일 store로 분리한다.
- WS 이벤트는 `app/providers/ws-provider` 같은 단일 진입점에서 수신 후 feature 단으로 fan-out한다.
- 컴포넌트 props는 `readonly` 타입을 기본으로 하고, mutable 객체 전달을 피한다.

---

## 3) 백엔드 구조(NestJS + 실시간 WS 중심)

### 3.1 디렉토리
```text
apps/api/src/
  main.ts
  app.module.ts
  common/
    dto/                      # 공통 DTO base (paging, cursor 등)
    guards/
    filters/
    interceptors/
    pipes/
    types/
    constants/
  modules/
    strategy/
      controllers/
      services/
      domain/                 # 순수 전략 로직
      dto/
      strategy.module.ts
    execution/
      engine/                 # 상태머신/실행 오케스트레이션
        shared/               # 공통 타입/지표/집계/strategy module contract
        strategies/
          strat-a/            # STRAT_A 전용 구현
          strat-b/            # STRAT_B 전용 구현
          strat-c/            # STRAT_C 전용 구현
      services/
      dto/
      events/                 # 내부 도메인 이벤트 타입
      execution.module.ts
    market-data/
      ingest/                 # REST/WS 인입
      aggregators/            # 1m/15m/1h 집계
      dto/
      market-data.module.ts
    exchange/
      upbit/
        clients/
        dto/
        mappers/
      exchange.module.ts
    orders/
      services/
      dto/
      orders.module.ts
    positions/
      services/
      dto/
      positions.module.ts
    risk/
      services/
      policies/
      dto/
      risk.module.ts
    reports/
      services/
      dto/
      reports.module.ts
    observability/
      logger/                 # pino/winston adapter, log formatter
      system-events/          # 시스템 이벤트 기록 서비스
      alerts/                 # 임계치 기반 알림(telegram/email/webhook)
      dto/
      observability.module.ts
    runs/
      services/
      dto/
      runs.module.ts
    ws/
      gateways/               # WebSocket gateway
      channels/               # channel/topic 라우팅
      serializers/            # outbound event serialization
      ws.module.ts
    resilience/
      policies/               # timeout/retry/backoff/circuit-breaker 정책
      idempotency/            # runId+seq / request key 중복 방지
      guards/                 # 외부 연동 보호 래퍼
      resilience.module.ts
  infra/
    db/
      supabase/
        client/               # supabase-js / service role adapter
        sql/                  # schema, index, rls 정책
      entities/
      repositories/
      migrations/
    storage/
      supabase/
        buckets/              # run-artifacts, market-archive 정책
    queue/
      producers/
      consumers/
```

### 3.2 실시간 WS 설계 원칙(심화)
- 전략 분리 규칙:
  - 전략 구현은 `execution/engine/strategies/<strategyId>/` 하위에만 둔다.
  - 전략 간 직접 import를 금지한다.
  - 공통 로직은 `execution/engine/shared/`로 이동한다.
- 인입과 송신을 분리한다:
  - 인입: `market-data/ingest` (거래소 WS/REST)
  - 송신: `ws/gateways` (클라이언트 구독 전달)
- 도메인 이벤트 버스를 고정한다:
  - `SIGNAL_EMIT`, `ORDER_INTENT`, `FILL`, `POSITION_UPDATE`, `EXIT` 등 06 계약 이벤트를 내부 이벤트로 먼저 발행
  - WS는 내부 이벤트를 구독해 직렬화 후 push
- Backpressure 정책:
  - 고빈도 이벤트는 배치/샘플링 채널 분리(예: tick 채널 vs run-log 채널)
  - 느린 소비자(클라이언트) 세션은 drop 또는 snapshot-only 모드로 강등
- 멱등성/순서:
  - `runId + sequence`를 모든 이벤트에 포함
  - 재전송 시 동일 `sequence`는 중복 처리 금지
- 멀티전략 fan-out:
  - 하나의 `trade/ticker/orderbook` 피드에서 3개 전략 런타임으로 fan-out한다.
  - 각 전략은 별도 `runId`/`strategyState`/`riskState`를 유지하고 shared helper만 공유한다.
- 채널 설계:
  - `/ws/runs/:runId/events`
  - `/ws/runs/:runId/positions`
  - `/ws/market/:symbol/ticks`
  - 채널 권한은 guard에서 제어

---

## 4) DTO/타입 안전성 규칙

### 4.1 DTO 계층 분리
- `Request DTO`: controller 입력 검증(class-validator + ValidationPipe)
- `Command DTO`: application 서비스 진입용(비즈니스 의도 표현)
- `Event DTO`: 내부/외부 이벤트 payload
- `Response DTO`: API 응답 전용(노출 필드 최소화)

규칙:
- 엔티티를 API 응답으로 직접 반환 금지.
- DTO는 버전 명시 권장(`RunReportV1Dto` 등).
- 숫자 정밀도 요구가 있는 값(KRW, 수익률)은 문자열 또는 decimal 래퍼로 통일 정책을 정한다.

### 4.2 계약 단일화
- API/WS payload 타입은 `packages/contracts`에서 export한다.
- `apps/api`와 `apps/web`은 동일 계약 타입을 참조한다.
- 런타임 검증과 정적 타입을 함께 사용한다:
  - 입력: class-validator
  - 경계 검증: zod(선택) 또는 커스텀 schema guard
- `SYSTEM_EVENT`의 `eventType` enum은 `14_CONTRACTS_SPEC.md`를 기준으로 관리한다.

---

## 5) 불변성/안전성 규칙(TypeScript)
- `tsconfig` 권장:
  - `"strict": true`
  - `"noUncheckedIndexedAccess": true`
  - `"exactOptionalPropertyTypes": true`
  - `"noImplicitOverride": true`
  - `"useUnknownInCatchVariables": true`
- 함수 경계의 입력 타입은 `Readonly<T>` 우선.
- 이벤트/DTO 생성 후 `Object.freeze` 또는 deep readonly 패턴 적용(핫패스 제외).
- `any` 금지, `unknown` 후 좁히기 사용.
- enum보다 string literal union 우선(계약 공유 시 tree-shaking 유리).
- 날짜/시간은 ISO 문자열 또는 epoch(ms) 중 하나로 통일하고 문서에 고정.

---

## 6) 에러/로깅/추적성 규칙
- 모든 로그는 `runId`, `strategyId`, `mode`, `fillModelApplied`를 포함한다.
- WS 송신 실패는 경고로만 버리지 않고 metric 카운트한다.
- `run_report.json`과 이벤트 로그(`events.jsonl`)는 동일 `runId`로 연결 가능해야 한다.
- run 메타/KPI는 Supabase Postgres에, 대용량 산출물(csv/jsonl)은 Supabase Storage에 분리 저장한다.

### 6.1 시스템 로그 기능(백엔드 필수)
- `modules/observability/system-events`에서 시스템 이벤트를 구조화 로그로 저장한다.
- 저장 대상(최소):
  - 엔진 상태 이상: `ENGINE_STATE_INVALID`, `ENGINE_LOOP_DELAYED`
  - WS 이상: `WS_BACKPRESSURE`, `WS_CLIENT_DROPPED`, `WS_SERIALIZE_FAILED`
  - 외부 연동 실패: `EXCHANGE_API_ERROR`, `DB_WRITE_FAILED`, `QUEUE_PUBLISH_FAILED`
  - 리스크/운영 이벤트: `KILL_SWITCH_TRIGGERED`, `RISK_LIMIT_BREACH`, `LIVE_GUARD_BLOCKED`
- 기록 위치(권장):
  - 표준 출력(JSON) + 파일 롤링(`logs/system-events-YYYYMMDD.log`)
  - 장기 보관용 DB 테이블 `system_event_logs` (선택)

### 6.2 SystemEvent DTO (권장)
```ts
type SystemEventDto = Readonly<{
  ts: string; // ISO-8601
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';
  eventType:
    | 'ENGINE_STATE_INVALID'
    | 'ENGINE_LOOP_DELAYED'
    | 'WS_BACKPRESSURE'
    | 'WS_CLIENT_DROPPED'
    | 'WS_SERIALIZE_FAILED'
    | 'EXCHANGE_API_ERROR'
    | 'DB_WRITE_FAILED'
    | 'QUEUE_PUBLISH_FAILED'
    | 'KILL_SWITCH_TRIGGERED'
    | 'RISK_LIMIT_BREACH'
    | 'LIVE_GUARD_BLOCKED';
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

### 6.3 알림/임계치 규칙
- `ERROR` 이상 이벤트는 기본 알림 채널로 전송(중복 억제 윈도우 적용).
- 동일 `eventType`가 N회 연속 발생하면 `SYSTEM_DEGRADED` 상태로 승격한다.
- `FATAL` 또는 `KILL_SWITCH_TRIGGERED`는 즉시 운영자 알림 + run 중지 사유에 기록한다.

### 6.4 불변성/무결성 규칙
- 로그 payload는 생성 후 변경 금지(`Readonly`, 직렬화 직전 freeze 권장).
- 민감정보(API key, secret, auth header)는 저장 전 마스킹한다.
- 로그 스키마 변경 시 `packages/contracts`의 이벤트 타입을 함께 업데이트한다.

### 6.5 네트워크 안전장치 구현 규칙(필수)
- 외부 I/O 경계(`exchange/supabase/storage/queue/ws`)는 공통 보호 래퍼를 통해서만 호출한다.
- 보호 래퍼 기본 동작:
  - `try/catch` + 타임아웃 + 재시도(backoff+jitter)
  - 실패 시 `SYSTEM_EVENT` 기록 후 typed error 반환
  - 재시도 불가 작업(비멱등)은 즉시 실패/보호 중단
- DB unique 충돌(`run_id, seq`)은 중복 이벤트로 분류하고 프로세스 크래시를 금지한다.
- 엔진 루프와 WS 송신을 분리해 WS 장애가 실행 루프를 멈추지 않게 한다.
- circuit breaker 상태(`OPEN/HALF_OPEN/CLOSED`)를 메트릭과 로그에 노출한다.

---

## 7) 테스트 전략(구조 연계)
- Unit:
  - `strategy/domain`, `execution/engine`, `risk/policies`는 순수 함수 중심 단위테스트
- Integration:
  - controller + service + repository + dto validation
- E2E:
  - run 시작 -> 이벤트 송신 -> 리포트 생성까지 `runId` 단위 검증
- Contract:
  - `packages/contracts` 변경 시 web/api 동시 검증(호환성 테스트)

---

## 8) 변경 규칙
- 폴더 구조(상위 모듈) 변경 시 이 문서를 먼저 갱신한다.
- WS 채널/이벤트 스키마 변경 시:
  - `../architecture/06_ARCHITECTURE.md`, `10_EXPERIMENT_PROTOCOL.md`, `packages/contracts`를 함께 수정한다.
- DTO 필드 변경 시:
  - 마이그레이션 노트와 버전 표기를 남긴다.
- 전략 구조 변경 시:
  - `08_STRATEGIES.md`, `09_PARAMETER_REGISTRY.md`, `06_ARCHITECTURE.md`를 함께 검토한다.
