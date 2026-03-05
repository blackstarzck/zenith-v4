# 06_ARCHITECTURE.md
# 프로젝트 아키텍처 + 엔진 계약(Engine Contract) v1.1

## A. 아키텍처 개요
### A1) 핵심 원칙
- 3개 전략은 엔진 관점에서 동일 실행 파이프라인을 공유한다.
- 전략마다 달라지는 것은 “시그널/파라미터/포지션 정책” 뿐이다.
- 문서 통합/리팩터링 과정에서 로직 훼손을 막기 위해 **엔진 계약(Contract)** 을 단일 진실로 둔다.

참조:
- 전략 정의: `../specs/08_STRATEGIES.md`
- 파라미터(SSOT): `../specs/09_PARAMETER_REGISTRY.md`
- 실험/회귀: `../specs/10_EXPERIMENT_PROTOCOL.md`
- 프로젝트 구조/실시간 WS 모듈 설계: `../specs/12_PROJECT_STRUCTURE.md`

---

## B. 엔진 계약(Engine Contract) — 훼손 방지 규격

### B1) 불변 원칙
1) 전략은 “의사결정(Decision)”만 한다. 체결(Fill)과 포지션/리스크/기록은 엔진 책임이다.  
2) **룩어헤드 금지**: 미래 봉의 close가 필요한 판단은 그 close 이후에만 확정될 수 있다.  
3) 체결 타이밍/승인 흐름/우선순위/수수료 모드 변경은 전략 로직 변경급이다. (10에서 회귀 필수)

---

### B2) runConfig 계약(필수)
- runId
- strategyId / strategyVersion
- parameterSnapshot(JSON)
- market, timeframe(s), startAt, endAt
- mode(PAPER|SEMI_AUTO|AUTO|LIVE)
- fillModelRequested (AUTO|NEXT_OPEN|ON_CLOSE|NEXT_MINUTE_OPEN|INTRABAR_APPROX)
- entryPolicy (전략별 엔트리 타이밍 확정값)
- fee: common.fee.mode + (perSide OR roundtrip 단일)
- slippageAssumedPct
- riskSnapshot (09의 common.risk.* 기본값을 사용하되, run에서 스냅샷으로 반드시 기록)
- fillModelApplied (엔진이 최종 적용한 체결 모델; run_report/events에 기록)

---

### B3) 평가 시점(Evaluation Point) 계약
- `ON_CANDLE_CLOSE`에서만 확정 가능한 조건(양봉/음봉, close 기반)은 **close 이후에만 평가 가능**
- `ON_CANDLE_OPEN`에서는 해당 봉의 close를 알 수 없다.

---

### B4) fillModel 의미(정의 고정)
- fillModelRequested: 사용자가 요청한 체결 모델(또는 AUTO)
- fillModelApplied: 엔진이 최종 적용한 체결 모델(재현/분석 기준)
- AUTO: 전략/모드별 entryPolicy에 의해 엔진이 최종 fillModelApplied를 결정한다.
- NEXT_OPEN: 체결은 t+1 open
- ON_CLOSE: 체결은 t close
- NEXT_MINUTE_OPEN: 1m에서 신호 후 다음 1분 open
- INTRABAR_APPROX: 봉 내부 high/low로 SL/TP 동봉 근사(옵션)

---

### B5) “확증(confirm) + 체결” 룰(룩어헤드 방지)
confirm이 `close[t+1] > open[t+1]`처럼 “t+1 close 확정”을 요구한다면:
- confirm 판정 시점 = t+1 close 이후
- confirm 이후 진입 체결은 아래 중 하나만 허용:
  - t+1 close 진입(ON_CLOSE)
  - t+2 open 진입(NEXT_OPEN)
- confirm을 요구하면서 t+1 open 진입은 금지(룩어헤드)

---

### B6) SEMI_AUTO 승인 계약(STRAT_B)
- SEMI_AUTO는 승인 이벤트(`APPROVE_ENTER`)가 “신호 발생 이후”에 일어난다.
- 따라서 SEMI_AUTO에서 동일 봉 close(ON_CLOSE) 체결은 기본 재현 모델에서 금지.
- 계약:
  - AUTO: ON_CLOSE 허용
  - SEMI_AUTO: 승인 후 NEXT_OPEN(다음 봉 시가)만 허용
  - 승인 지연(몇 봉 뒤 승인인지)은 runConfig/run_report에 기록해야 한다.

---

### B7) 수수료 계약(Fee Contract) — 이중 적용 금지
- `common.fee.mode = PER_SIDE` → `common.fee.perSide`만 사용
- `common.fee.mode = ROUNDTRIP` → `common.fee.roundtrip`만 사용
- 둘 다 적용은 계약 위반(실험 무효)

---

### B8) TP/SL/TIME 충돌 우선순위(고정)
- STRAT_C: SL > TP1 > TP2 > TIME
- STRAT_B: 동봉 SL/TP 충돌 시 SL 우선
- 변경 금지

---

### B9) 이벤트/로그 계약(필수)
최소 이벤트:
- RUN_START / RUN_END
- CANDLE_OPEN / CANDLE_CLOSE
- SIGNAL_EMIT
- APPROVE_ENTER (SEMI_AUTO)
- ORDER_INTENT
- FILL
- POSITION_UPDATE
- EXIT(reason, pnl)
- RISK_BLOCK / PAUSE
- SYSTEM_EVENT (엔진/WS/DB/Queue/Exchange 계층 이슈)

필수 메타:
- strategyId/version, parameterSnapshot, fillModelRequested, fillModelApplied, entryPolicy, fee.mode, exit reason
- SYSTEM_EVENT는 추가로 `level`, `eventType`, `traceId`, `source`를 필수 포함한다.

---

## C. 핵심 기능 흐름 (Mermaid)

### C1) 실행 파이프라인(전략 공통)
```mermaid
flowchart TD
    A[RUN_START<br/>runConfig 로드] --> B[Market Data Ingest<br/>REST/WS]
    B --> C[Strategy Evaluate<br/>SIGNAL_EMIT]
    C --> D{Risk Check}
    D -- Block --> E[RISK_BLOCK / PAUSE]
    D -- Pass --> F[ORDER_INTENT 생성]
    F --> G[fillModelApplied 결정<br/>entryPolicy + mode]
    G --> H[FILL]
    H --> I[POSITION_UPDATE]
    I --> J{Exit Condition}
    J -- No --> B
    J -- Yes --> K[EXIT(reason,pnl)]
    K --> L[RUN_END]
```

### C2) STRAT_B SEMI_AUTO 승인 흐름
```mermaid
sequenceDiagram
    participant M as MarketData
    participant S as Strategy(B)
    participant E as ExecutionEngine
    participant U as User/Operator
    participant W as WS Gateway

    M->>S: 15m 봉 close
    S->>E: SIGNAL_EMIT
    E->>W: Approval Queue Push
    W->>U: 승인 요청 알림
    U->>E: APPROVE_ENTER
    E->>E: delayBars 적용
    E->>E: 다음 봉 open 대기(NEXT_OPEN)
    E->>E: ORDER_INTENT
    E->>E: FILL
    E->>W: POSITION_UPDATE / EVENTS
```

### C3) 시스템 이슈 로깅/알림 흐름
```mermaid
flowchart LR
    A[Engine / WS / DB / Queue / Exchange] --> B[SYSTEM_EVENT 생성]
    B --> C[Observability Service]
    C --> D[JSON Log Stdout]
    C --> E[Rolling File<br/>logs/system-events-YYYYMMDD.log]
    C --> F[(system_event_logs)]
    C --> G{level >= ERROR?}
    G -- Yes --> H[Alert Channel<br/>Telegram/Email/Webhook]
    G -- No --> I[Metrics 집계]
```

---

## D. 네트워크/외부연동 안정성 계약 (필수)

### D1) 경계 try/catch 규칙
- `exchange`, `db(supabase)`, `storage`, `queue`, `ws-gateway` 경계는 반드시 `try/catch`로 감싼다.
- catch에서 예외를 삼키지 않는다:
  - `SYSTEM_EVENT`(`level`, `eventType`, `traceId`, `source`)를 남긴다.
  - 호출자에 `Result<T, E>` 또는 도메인 예외로 명시 반환한다.

### D2) 타임아웃/재시도 규칙
- 모든 외부 I/O는 타임아웃을 강제한다(무제한 대기 금지).
- 재시도는 멱등 작업에만 허용:
  - 지수 백오프 + 지터 사용
  - 최대 재시도 횟수 초과 시 `ERROR` 로그 + 회로 차단기 상태 전환 검토
- 비멱등 작업(실주문, 중복 체결 위험)은 재시도 전에 idempotency key 또는 주문 조회 검증이 선행되어야 한다.

### D3) 순서/중복 방지 계약
- 이벤트는 `runId + seq + traceId`를 필수 포함한다.
- 저장 계층은 `(run_id, seq)` unique 위반을 정상 중복으로 처리하고 프로세스를 중단하지 않는다.
- out-of-order 이벤트는 즉시 실패 처리하지 않고:
  - 단기 버퍼링 후 재정렬 또는
  - `DEGRADED` 모드 전환 + 재동기화(snapshot + lastSeq) 수행

### D4) 장애 격리/강등(Degrade) 규칙
- WS 송신 실패는 엔진 핵심 루프와 격리한다(송신 실패로 run 중단 금지).
- DB 일시 장애 시:
  - 메모리/로컬 큐(내구 큐 권장)로 임시 적재
  - 복구 후 순차 flush
  - flush 실패 누적 시 `KILL_SWITCH_TRIGGERED` 또는 `RUN_PAUSE` 정책 발동

### D4.1 리스크/라이브 가드(현재 구현)
- 진입 직전(`ORDER_INTENT BUY`)에 아래 가드를 적용한다.
  - `RUN_MODE=LIVE` 이고 `ALLOW_LIVE_TRADING=false`면 `LIVE_GUARD_BLOCKED` + `PAUSE`
  - `RISK_DAILY_LOSS_LIMIT_PCT` 초과 손실이면 `RISK_BLOCK(reason=DAILY_LOSS_LIMIT)` + `PAUSE`
  - `RISK_MAX_CONSECUTIVE_LOSSES` 초과면 `RISK_BLOCK(reason=MAX_CONSECUTIVE_LOSSES)` + `PAUSE`
  - `RISK_MAX_DAILY_ORDERS` 초과면 `RISK_BLOCK(reason=MAX_DAILY_ORDERS)` + `PAUSE`

### D5) 필수 시스템 이벤트 타입
- `EXCHANGE_TIMEOUT`, `EXCHANGE_RETRY_EXHAUSTED`
- `SUPABASE_TIMEOUT`, `SUPABASE_WRITE_RETRY`, `SUPABASE_WRITE_FAILED`
- `WS_SEND_TIMEOUT`, `WS_SEND_DROPPED`
- `EVENT_OUT_OF_ORDER`, `EVENT_DUPLICATED`
- `CIRCUIT_OPENED`, `CIRCUIT_HALF_OPEN`, `CIRCUIT_CLOSED`

### D6) 네트워크 실패 처리 시퀀스
```mermaid
sequenceDiagram
    participant E as Engine
    participant X as External(API/DB/WS)
    participant R as Resilience Layer
    participant O as Observability

    E->>R: request(traceId, runId, seq)
    R->>X: call with timeout
    alt success
      X-->>R: response
      R-->>E: success
    else timeout/error
      X-->>R: error
      R->>O: SYSTEM_EVENT(errorType, traceId)
      R->>R: retry(backoff+jitter)
      alt retry exhausted
        R->>O: SYSTEM_EVENT(RETRY_EXHAUSTED)
        R-->>E: degraded/fail result
      else retry success
        R-->>E: success
      end
    end
```
