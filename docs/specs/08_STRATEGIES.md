# 08_STRATEGIES.md
# 전략 정의서 (3 Strategies) — 실시간 테스트/실시간 적용용 통합본 (승률 유지형 정책 반영)

## 0) 공통 규격(필수)
- strategyId: `STRAT_A | STRAT_B | STRAT_C`
- version: semver
- parameterSetId: `09_PARAMETER_REGISTRY.md` 참조
- mode: `PAPER | SEMI_AUTO | AUTO | LIVE`
- 엔진 계약(체결/승인/우선순위/수수료): `../architecture/06_ARCHITECTURE.md`

## 0.1 현재 구현 상태(2026-03-08)
- 실행 엔진은 하나의 프로세스에서 `STRAT_A/B/C` 3개 런타임을 동시에 구동한다.
- 각 전략은 독립 `runId`, `strategyState`, `riskSnapshot`, `latestEntryReadiness`를 유지하고 동일 Upbit 피드를 공유한다.
- 공통:
  - 실시간 소스: `trade + ticker + orderbook`
  - `trade`로 1분 봉을 갱신하고, 닫힌 1분 봉으로 15m/1h를 집계한 뒤 각 timeframe의 `CANDLE_CLOSE`/`CANDLE_OPEN` 이벤트를 fan-out한다.
  - 실행 이벤트 흐름: `SIGNAL_EMIT -> ORDER_INTENT -> FILL -> POSITION_UPDATE`, 청산은 `EXIT -> ORDER_INTENT -> FILL -> POSITION_UPDATE`
  - 전략 구현은 `apps/api/src/modules/execution/engine/strategies/<strategyId>/strategy.ts`, 공통 타입/지표/집계는 `engine/shared/`에 둔다.
- 전략별 현재 구현 포인트:
  - STRAT_A: 15m BB reclaim + confirm + `NEXT_OPEN/ON_CLOSE` 후속 체결 정책
  - STRAT_B: 1h Bull Mode + 15m impulse/FVG/OB zone + 승인 대기 런타임
  - STRAT_C: 1m breakout + `tradeValue/buyValue/buyRatio` + fixed KRW sizing + cooldown/pause
- 주의:
  - 리포트 산출물과 fee/slippage 기반 손익 정교화는 후속 범위로 남는다.

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
  - **기본(runtime default): t+2 open 진입(NEXT_OPEN)**
  - 옵션(연구/비교용): t+1 close 진입(ON_CLOSE)

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
1H 상승 구조(Bull Mode)에서만, 15m 임펄스/상승 FVG/오더블록 기반 zone을 만들고 zone touch + 양봉 마감 시 진입한다.

### 2) 상위 구조(Bull Mode, 1h close)
- 최근 `b.bullMode.lookback`개의 1h 봉으로 계산
- 조건:
  - 구간 종가 기울기(slope) > 0
  - 각 봉의 `close >= (high+low)/2` 인 봉 수가 `b.bullMode.minClosesAboveTrend` 이상
  - 단기 ADX >= 15

### 3) 15m POI/Zone 생성
- 최근 3개 15m 봉 기준
- impulse candle:
  - bullish
  - `bodyRatio >= b.impulse.bodyRatioMin`
  - `range >= ATR * b.impulse.mult`
- bullish FVG:
  - `latest.low > older.high * (1 + b.fvg.minGapPct)`
- zone 구성:
  - bullish FVG가 있으면 `zoneLow = older.high`, `zoneHigh = latest.low`
  - 없으면 `zoneLow = obLow`, `zoneHigh = prev.high`
- 유효기간:
  - `b.poi.validBars * 15m`
- target:
  - 최근 고점과 RR fallback(`b.tp.rrFallback`) 중 큰 값 사용

### 4) 진입/승인
- 포지션 없음 + Bull Mode ON + activeZone
- Touch: `low<=zoneHigh && high>=zoneLow`
- Confirm: `close>open`
- AUTO/PAPER/LIVE:
  - direct entry path
  - 기본 fill = `b.entry.fillWhenAuto`
- SEMI_AUTO:
  - `WAIT_APPROVAL`로 전환
  - `APPROVE_ENTER` 소비 후 다음 open에서 진입

### 5) 청산(Exit)
- SL: `obLow*(1-SL_BUFFER)`
- TP: 스윙고점 우선, 없으면 RR fallback
- TIME EXIT: `b.timeExit.bars`
- BullOff: 1h Bull Mode OFF 시 즉시 청산
- 동봉 SL/TP 충돌: SL 우선(06 고정)

### 6) 상태
- `FLAT -> WAIT_POI -> WAIT_CONFIRM -> WAIT_APPROVAL(optional) -> IN_POSITION -> FLAT`

---

## STRAT_C — XRP Profit-Max Scalper v1.0

### 1) 개요
1m 돌파 스캘핑 전략이다. 실시간 `trade` 흐름으로 `tradeValue`, `buyValue`, `buyRatio`를 누적하고, 조건 충족 시 **다음 1분 open(ENTRY_PENDING)** 에 진입한다.

### 2) 진입
- 허용 시간: `c.entry.allowedHoursKst`
- breakout:
  - `close > max(high, 최근 c.breakout.lookbackCandles 개)`
- value spike:
  - `tradeValue >= avg(tradeValue, 최근 c.valueSpike.lookbackCandles 개) * c.valueSpike.mult`
- order-flow/body 필터:
  - `buyRatio >= c.buyRatio.min`
  - `bodyRatio >= c.bodyRatio.min`
- fill:
  - signal close 이후 `ENTRY_PENDING`
  - 다음 1분 open에서 진입
- sizing:
  - 기본 `c.order.fixedKrw = 50,000`
  - 고정 주문금액이 없거나 비정상이면 risk sizing fallback

### 3) 청산/보호
- 우선순위: SL > TP1 > TP2 > TIME
- SL: `-0.4%`
- TP1: `+0.4%`, 70% 부분청산
- TP2: `+0.6%`, 잔량 청산
- TIME: 5분
- 일반 종료 후 cooldown 2분
- 손절 후 cooldown 5분
- 연속 손절 2회면 20분 pause

### 4) 상태
- `IDLE -> ENTRY_PENDING -> IN_POSITION -> COOLDOWN/PAUSED -> IDLE`
