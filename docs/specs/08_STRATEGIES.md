# 08_STRATEGIES.md
# 전략 정의서 (3 Strategies) — 실시간 테스트/실시간 적용용 통합본 (승률 유지형 정책 반영)

## 0) 공통 규격(필수)
- strategyId: `STRAT_A | STRAT_B | STRAT_C`
- version: semver
- parameterSetId: `09_PARAMETER_REGISTRY.md` 참조
- mode: `PAPER | SEMI_AUTO | AUTO | LIVE`
- 엔진 계약(체결/승인/우선순위/수수료): `../architecture/06_ARCHITECTURE.md`

## 0.1 현재 구현 상태(2026-03-05)
- 실행 엔진은 `STRAT_A/B/C`를 환경변수(`STRATEGY_ID`)로 선택해 평가한다.
- 공통:
  - 1분 봉 마감 기준 평가
  - 이벤트 흐름: `SIGNAL_EMIT -> ORDER_INTENT -> FILL -> POSITION_UPDATE -> EXIT`
  - 청산: TP/SL/TIME 공통 프레임
- 전략별 진입 규칙(현재 코드 기준):
  - STRAT_A: 평균회귀 성격(하단 꼬리 + 양봉 확정)
  - STRAT_B: POI 확인 성격(충분한 변동폭 + 고가 근처 마감)
  - STRAT_C: 돌파 성격(엄격한 상승 임계치)
- 목적:
  - 실시간 시세 기반 전략 분기/E2E 경로 검증
- 주의:
  - 세부 지표(ADX/BB/FVG 등) 완전 매핑은 다음 단계에서 계속 고도화한다.

---

## STRAT_A — XRP Mean-Reversion Confirmed (XMR-C) v1.2 (룩어헤드 없음 + 승률 유지형)

### 1) 개요
15m 볼린저 하단 이탈-복귀 후 “다음 봉 양봉 확증”이 완료되면 진입하고, +0.6% 부분익절 후 ATR 트레일과 시간 청산으로 관리한다.

### 2) 지표
- BB(20, 2.0), ATR(14), ADX(14), RSI(14) + slopeLookback=3
- 레짐(ADX):
  - ranging: ADX<20
  - trending: 20≤ADX<35
  - volatile: ADX≥35(필터)

### 3) 진입(Entry) — 룩어헤드 없는 정의(확정)
- Trigger(t, 15m close 시점 감지):
  - `low[t] < BB_LO[t]` AND `close[t] > BB_LO[t]`
- Filter(t):
  - ADX[t] ≤ 35
  - RSI slope ≥ 1.0
  - KST 13시 진입 제외
- Confirm(t+1, t+1 close 이후에만 판정):
  - `close[t+1] > open[t+1]`
- Entry fill(Confirm 이후):
  - **기본(canonical): t+1 close 진입(ON_CLOSE)**  
  - 옵션(보수적): t+2 open 진입(NEXT_OPEN)

> 이유: 룩어헤드 금지(06) 준수하면서도, “진입이 너무 늦어져 승률/기대값이 급락”하는 문제를 완화.

### 4) 청산(Exit)
- SL:
  - `stop = entry - stop_mult(regime)*ATR`
  - ranging 3.5 / trending 2.2 / volatile 2.5
- TP1(부분익절):
  - +0.6% 도달 시 50% 매도
- Trail(잔량):
  - TP1 이후 `trail = close - 1.2*ATR` (상향 갱신만)
- Time Exit:
  - 10 bars 초과 시 전량

### 5) 부분익절 체결 시점 보존
- `a.execution.partialExitFillTiming`:
  - 기본 NEXT_OPEN(재현성)
  - 옵션 INTRABAR_APPROX(실시간 근사)

### 6) 상태
- `FLAT → WAIT_CONFIRM → WAIT_ENTRY → IN_POSITION → IN_TRAIL → FLAT`

---

## STRAT_B — KRW-XRP OB+FVG Pullback Strategy v0.11 (AUTO/SEMI_AUTO 분리 확정)

### 1) 개요
1H 상승 구조(Bull Mode)에서만, 15m 임펄스로 생성된 FVG 되돌림 구간(POI) 터치 후 양봉 마감 시 진입한다.

### 2) 진입 신호(15m close 시점 생성)
- 포지션 없음 + Bull Mode ON + 활성 POI
- Touch: `low<=zoneHigh && high>=zoneLow`
- Trigger: 양봉 마감(close>open)

### 3) 진입 체결 정책(모드별 확정)
- AUTO:
  - 기본: t close 진입(ON_CLOSE) 허용
- SEMI_AUTO:
  - 승인 이벤트 `APPROVE_ENTER` 이후에만 진입
  - **기본: 승인 후 NEXT_OPEN(다음 봉 시가) 진입**
  - 승인 지연이 N bars면 “N bars 뒤 NEXT_OPEN”으로 진입(10에서 기록)

### 4) 청산(Exit)
- SL: `obLow*(1-SL_BUFFER)`
- TP: 스윙고점 우선, 없으면 RR fallback
- TIME EXIT: TIME_EXIT_BARS 경과 시 close
- BullOff: Bull Mode OFF + 손실이면 close 청산
- 동봉 SL/TP 충돌: SL 우선(06 고정)

### 5) 상태
- SEMI_AUTO에서 `WAIT_CONFIRM(승인대기)` 필수

---

## STRAT_C — XRP Profit-Max Scalper v1.0 (변경 없음)
- 1m 봉 확정 시 신호 평가 → **다음 1분 open(ENTRY_PENDING)** 진입
- 우선순위: SL > TP1 > TP2 > TIME (06 고정)
- “현재봉 제외” 규칙 준수(06/10)
