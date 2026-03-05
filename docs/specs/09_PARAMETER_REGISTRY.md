# 09_PARAMETER_REGISTRY.md
# 파라미터 레지스트리 (SSOT: Single Source of Truth) v1.1

## 0) 원칙
- 전략 코드에 파라미터 하드코딩 금지. 모든 파라미터는 여기서 정의한다.
- 네이밍 규칙(강제):
  - 공통: `common.*`
  - A: `a.*`
  - B: `b.*`
  - C: `c.*`

---

## 1) 공통 파라미터(common.*)

### 1.1 실행/체결
| key | type | default | allowed/constraint | impact | note |
|---|---|---:|---|---|---|
| common.mode | enum | PAPER | PAPER/SEMI_AUTO/AUTO/LIVE | HIGH | 실행 모드 |
| common.fillModel | enum | AUTO | AUTO/NEXT_OPEN/ON_CLOSE/NEXT_MINUTE_OPEN/INTRABAR_APPROX | HIGH | AUTO면 정책으로 결정(06) |
| common.seedKrw | number | 1000000 | >=10000 | HIGH | 페이퍼 시드 |
| common.market | string | KRW-XRP | - | MED | 기본 마켓 |
| common.slippage.assumedPct | number | 0.0 | 0~0.01 | MED | 슬리피지 가정 |

### 1.2 수수료(이중 적용 방지)
| key | type | default | allowed/constraint | impact | note |
|---|---|---:|---|---|---|
| common.fee.mode | enum | PER_SIDE | PER_SIDE/ROUNDTRIP | HIGH | 단일 모드 |
| common.fee.perSide | number | 0.0005 | 0~0.01 | MED | mode=PER_SIDE일 때만 |
| common.fee.roundtrip | number | 0.0010 | 0~0.02 | MED | mode=ROUNDTRIP일 때만 |

### 1.3 공통 리스크(= riskSnapshot 기본값)
| key | type | default | allowed/constraint | impact | note |
|---|---|---:|---|---|---|
| common.risk.maxPositionRatio | number | 0.20 | 0~1 | HIGH | 계좌 대비 최대 비중 |
| common.risk.dailyLossLimitPct | number | -0.02 | -1~0 | HIGH | 일 손실 제한(%) |
| common.risk.maxConsecutiveLosses | number | 3 | 1~50 | HIGH | 연속 손실 제한 |
| common.risk.killSwitch | boolean | true | true/false | HIGH | 긴급정지 |
| common.risk.maxDailyOrders | number | 200 | 1~5000 | MED | 과도 주문 방지(옵션) |

---

## 2) STRAT_A 파라미터(a.*) — XRP Mean-Reversion Confirmed

### 2.1 엔트리 정책(룩어헤드 없음)
| key | type | default | allowed/constraint | impact | note |
|---|---|---:|---|---|---|
| a.entry.afterConfirmFill | enum | ON_CLOSE | ON_CLOSE/NEXT_OPEN | HIGH | Confirm 이후 진입 체결 |
| a.execution.partialExitFillTiming | enum | NEXT_OPEN | NEXT_OPEN/INTRABAR_APPROX | HIGH | 부분익절 체결 |

### 2.2 지표/필터
| key | type | default | allowed/constraint | impact | note |
|---|---|---:|---|---|---|
| a.bb.period | number | 20 | 5~200 | MED | Bollinger period |
| a.bb.std | number | 2.0 | 0.5~5.0 | MED | Bollinger std |
| a.atr.period | number | 14 | 5~100 | MED | ATR |
| a.adx.period | number | 14 | 5~100 | MED | ADX |
| a.rsi.period | number | 14 | 5~100 | MED | RSI |
| a.rsi.slopeLookback | number | 3 | 1~20 | MED | slope lookback |
| a.filters.excludeEntryHoursKst | number[] | [13] | each 0~23 | MED | 진입 제외 시간 |
| a.filters.maxAdx | number | 35 | 5~100 | HIGH | ADX 상한 |
| a.filters.rsiSlopeMin | number | 1.0 | 0~10 | HIGH | RSI slope 최소 |

### 2.3 청산/레짐
| key | type | default | allowed/constraint | impact | note |
|---|---|---:|---|---|---|
| a.tp.tpPct | number | 0.006 | 0~0.2 | HIGH | +0.6% |
| a.tp.partialRatio | number | 0.5 | 0~1 | HIGH | 50% |
| a.trail.atrMult | number | 1.2 | 0.1~10 | HIGH | trail |
| a.timeExit.maxHoldBars | number | 10 | 1~500 | HIGH | 시간청산 |
| a.regime.adxRangingLt | number | 20 | 1~100 | MED | 레짐 |
| a.regime.adxTrendingLt | number | 35 | 1~100 | MED | 레짐 |
| a.stop.multRanging | number | 3.5 | 0.1~20 | HIGH | SL 멀티 |
| a.stop.multTrending | number | 2.2 | 0.1~20 | HIGH | SL 멀티 |
| a.stop.multVolatile | number | 2.5 | 0.1~20 | HIGH | SL 멀티 |

---

## 3) STRAT_B 파라미터(b.*) — OB+FVG Pullback

### 3.1 운영/승인
| key | type | default | allowed/constraint | impact | note |
|---|---|---:|---|---|---|
| b.execution.requireUserConfirm | boolean | true | true/false | HIGH | SEMI_AUTO 승인 |
| b.approval.delayBars | number | 1 | 0~999 | MED | 백테스트 승인 지연(봉) |
| b.entry.fillWhenAuto | enum | ON_CLOSE | ON_CLOSE/NEXT_OPEN | HIGH | AUTO 체결 |
| b.entry.fillWhenSemiAuto | enum | NEXT_OPEN | NEXT_OPEN | HIGH | SEMI_AUTO 체결 고정 |

### 3.2 지표/POI 생성
| key | type | default | allowed/constraint | impact | note |
|---|---|---:|---|---|---|
| b.atr.period | number | 14 | 5~100 | MED | ATR |
| b.impulse.mult | number | 1.5 | 0.1~10 | HIGH | impulse |
| b.impulse.bodyRatioMin | number | 0.50 | 0~1 | HIGH | body/range |
| b.poi.validBars | number | 48 | 1~500 | HIGH | POI expiry |
| b.ob.lookback | number | 10 | 1~200 | MED | OB 탐색 범위 |
| b.sl.buffer | number | 0.002 | 0~0.05 | HIGH | SL buffer |
| b.tp.rrFallback | number | 1.5 | 0.1~10 | MED | fallback RR |
| b.timeExit.bars | number | 24 | 1~500 | HIGH | TIME EXIT |

---

## 4) STRAT_C 파라미터(c.*) — Profit-Max Scalper

| key | type | default | allowed/constraint | impact | note |
|---|---|---:|---|---|---|
| c.entry.allowedHoursKst | number[] | [6,7,10,14,16,20,22] | each 0~23 | MED | 시간 필터 |
| c.breakout.lookbackCandles | number | 10 | 1~500 | HIGH | breakout |
| c.valueSpike.lookbackCandles | number | 30 | 1~2000 | HIGH | value spike |
| c.valueSpike.mult | number | 4.0 | 1~50 | HIGH | mult |
| c.buyRatio.min | number | 0.75 | 0~1 | HIGH | buy_ratio |
| c.bodyRatio.min | number | 0.70 | 0~1 | HIGH | body_ratio |
| c.tp1.pct | number | 0.004 | 0~0.2 | HIGH | TP1 |
| c.tp1.ratio | number | 0.70 | 0~1 | HIGH | 70% |
| c.tp2.pct | number | 0.006 | 0~0.2 | HIGH | TP2 |
| c.tp2.ratio | number | 0.30 | 0~1 | HIGH | 30% |
| c.sl.pct | number | 0.004 | 0~0.2 | HIGH | SL |
| c.timeStop.minutes | number | 5 | 1~120 | HIGH | time stop |
| c.cooldown.normalMinutes | number | 2 | 0~120 | MED | cooldown |
| c.cooldown.afterStopMinutes | number | 5 | 0~240 | MED | cooldown |
| c.pause.consecutiveStops | number | 2 | 1~20 | HIGH | pause |
| c.pause.minutes | number | 20 | 1~10000 | HIGH | pause |