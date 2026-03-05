# 10_EXPERIMENT_PROTOCOL.md
# 실험 프로토콜 v1.2 — runId 리포트 스키마(고정) 포함

## 0) 목적
- 전략 3개를 동일 조건에서 비교 가능하게 만든다.
- 통합/리팩터링 이후에도 로직 훼손 없이 재현/회귀가 가능해야 한다.
- A/B는 확증/승인 때문에 체결 타이밍이 성과에 큰 영향을 주므로 runConfig를 고정한다.

참조:
- 엔진 계약(체결/승인/우선순위/수수료): `../architecture/06_ARCHITECTURE.md`
- 전략 정의: `08_STRATEGIES.md`
- 파라미터(SSOT): `09_PARAMETER_REGISTRY.md`
- Supabase 저장 규격: `17_SUPABASE_PERSISTENCE.md`

---

## 1) runConfig 필수 항목(재현성 스냅샷)
- runId
- strategyId / strategyVersion
- parameterSnapshot(JSON)  ← 09의 값을 그대로 저장
- market, timeframe(s), startAt, endAt
- mode(PAPER/SEMI_AUTO/AUTO/LIVE)

### entryPolicy 고정
- STRAT_A: `a.entry.afterConfirmFill`
- STRAT_B:
  - `b.entry.fillWhenAuto`
  - `b.entry.fillWhenSemiAuto`
  - `b.approval.delayBars`
- STRAT_C: ENTRY_PENDING(NEXT_MINUTE_OPEN) 고정

### fillModel 고정
- `common.fillModel`을 runConfig의 `fillModelRequested`로 기록한다.
- 최종 적용값은 runReport에 `fillModelApplied`로 반드시 기록한다.

### fee/slippage/risk
- fee: `common.fee.mode` + perSide 또는 roundtrip 중 **하나만**
- slippageAssumedPct
- riskSnapshot: 09의 `common.risk.*` 기본값을 기반으로 하되 run에 스냅샷 저장

---

## 2) 룩어헤드 금지 체크(필수)
- `close[t+1] > open[t+1]` 같은 “t+1 close 확정이 필요한 조건”을 쓰는 경우:
  - confirm 판정은 t+1 close 이후여야 함
  - 진입 체결은 t+1 close 또는 t+2 open만 허용
  - t+1 open 진입은 금지(실험 무효)

---

## 3) SEMI_AUTO 승인 재현성 체크(필수)
- SEMI_AUTO에서는 `APPROVE_ENTER` 이벤트가 반드시 존재해야 한다.
- 승인 지연은 `b.approval.delayBars`로 고정(봉 단위).
- 기본 재현 모델:
  - SEMI_AUTO 진입 체결 = 승인 후 NEXT_OPEN

---

## 4) 수수료 이중 적용 방지 체크(필수)
- fee.mode=PER_SIDE → perSide만 사용
- fee.mode=ROUNDTRIP → roundtrip만 사용
- 둘 다 적용 흔적이 있으면 계약 위반(실험 무효)

---

## 5) KPI(최소)
- Win Rate
- Return, MDD
- #Trades, Avg Win/Loss
- Exit Reason 분포: SL/TP1/TP2/TIME/TRAIL/BULL_OFF/RISK_BLOCK
- 엔트리 지연: signal 시점 vs entry 체결 시점 차이(bar 단위)

---

## 6) runId 리포트 스키마(고정)
- 저장: `runs/<runId>/run_report.json`
- 추가 산출물: `trades.csv`, `events.jsonl`
- Supabase 기준 저장:
  - 메타/요약: Postgres 테이블(`runs`, `run_reports`, `run_metrics`)
  - 대용량 산출물: Storage bucket(`run-artifacts/<runId>/...`)

### 6.1 RunReport JSON (필수 필드 예시)
```json
{
  "runId": "RUN_202602_0001",
  "createdAt": "2026-03-05T12:34:56+09:00",
  "strategy": { "strategyId": "STRAT_A", "strategyVersion": "1.2.0" },
  "dataset": {
    "market": "KRW-XRP",
    "timeframes": ["15m"],
    "startAt": "2026-02-01T00:00:00+09:00",
    "endAt": "2026-03-01T00:00:00+09:00",
    "sources": {
      "candles15m": "KRW-XRP_candle-15m_202602.csv",
      "candles1h": null,
      "trades": null
    }
  },
  "execution": {
    "mode": "PAPER",
    "entryPolicy": { "a.entry.afterConfirmFill": "ON_CLOSE" },
    "fillModelRequested": "AUTO",
    "fillModelApplied": "ON_CLOSE",
    "notes": "룩어헤드 금지 준수"
  },
  "fees": { "feeMode": "PER_SIDE", "perSide": 0.0005, "roundtrip": null, "slippageAssumedPct": 0.0 },
  "risk": {
    "seedKrw": 1000000,
    "maxPositionRatio": 0.2,
    "dailyLossLimitPct": -0.02,
    "maxConsecutiveLosses": 3,
    "killSwitch": true,
    "maxDailyOrders": 200
  },
  "parameters": { "parameterSnapshot": { "a.bb.period": 20, "a.bb.std": 2.0 } },
  "results": {
    "trades": { "count": 5, "winCount": 4, "lossCount": 1, "winRate": 0.8, "avgReturnPct": 0.003698, "sumReturnPct": 0.01849 },
    "pnl": { "totalKrw": 18490, "mddPct": -0.004 },
    "exitReasonBreakdown": { "TP1": 3, "TRAIL": 1, "SL": 1, "TIME": 0, "BULL_OFF": 0, "RISK_BLOCK": 0 }
  },
  "artifacts": { "tradesCsv": "runs/RUN_202602_0001/trades.csv", "eventsJsonl": "runs/RUN_202602_0001/events.jsonl" }
}
```

위 스키마를 `run_report.json`의 최소 필수 형식으로 고정한다.

---

## 7) 실전 테스트 데이터 저장/재백테스트 규칙
- 실전 테스트(PAPER/SEMI_AUTO/AUTO/LIVE 포함)에서 생성된 데이터는 모두 `runId` 기준으로 저장한다.
- 최소 저장 대상:
  - runConfig 스냅샷(요청/적용 fillModel, entryPolicy 포함)
  - 이벤트 로그(`events.jsonl`)
  - 체결/주문/포지션 이력
  - 최종 리포트(`run_report.json`, KPI)
  - 사용 데이터셋 식별자(캔들/트레이드 소스, 기간, 버전)
- 재백테스트 시 필수 조건:
  - 동일 `parameterSnapshot`
  - 동일 `entryPolicy`, `fillModelRequested`, `fillModelApplied`
  - 동일 데이터셋 식별자와 기간
- 전략 고도화 루프:
  1) 실전 테스트 run 저장
  2) run 결과 분석(손실 구간/이벤트 패턴)
  3) 파라미터/로직 수정
  4) 동일 조건 재백테스트
  5) 개선 여부를 runId 비교 리포트로 검증
