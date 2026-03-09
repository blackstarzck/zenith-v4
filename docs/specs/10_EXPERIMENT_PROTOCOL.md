# 10_EXPERIMENT_PROTOCOL.md
# 실험 프로토콜 v1.2 — runId 리포트 스키마(고정) 포함

## 0) 목적
- 전략 3개를 동일 조건에서 비교 가능하게 만든다.
- 통합/리팩터링 이후에도 로직 훼손 없이 재현/회귀가 가능해야 한다.
- A/B는 확증/승인 때문에 체결 타이밍이 성과에 큰 영향을 주므로 runConfig를 고정한다.
- 실시간 엔진은 하나의 Upbit 피드에서 3개 전략 런타임을 동시에 구동하므로, 전략 간 상태 오염이 없는지 회귀 항목으로 관리한다.

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
- STRAT_A: 기본 `A_CONFIRM_NEXT_OPEN` (`a.entry.afterConfirmFill`로 override 가능)
- STRAT_B:
  - `B_POI_TOUCH_CONFIRM_ON_CLOSE` 또는 `B_POI_TOUCH_CONFIRM_NEXT_OPEN`
  - SEMI_AUTO는 `B_SEMI_AUTO_NEXT_OPEN_AFTER_APPROVAL`
  - `b.approval.delayBars`
- STRAT_C: `C_NEXT_MINUTE_OPEN`

### fillModel 고정
- `common.fillModel`을 runConfig의 `fillModelRequested`로 기록한다.
- 최종 적용값은 runReport에 `fillModelApplied`로 반드시 기록한다.
- `fillModelApplied` 허용값: `NEXT_OPEN | ON_CLOSE | NEXT_MINUTE_OPEN | INTRABAR_APPROX`

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
- `#Trades`, `Win Rate`, `profitFactor`, `Avg Win/Loss`, `sumReturnPct`, `MDD`는 실제 체결된 `BUY ... EXIT + SELL` round-trip 완료 건만 집계한다.
- 수익률(`netReturnPct`)과 손익은 `common.fee.*`, `slippageAssumedPct`를 반영한 순체결 기준으로 계산한다.

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
    "datasetRef": {
      "key": "UPBIT|REPLAY_BACKTEST|KRW-XRP|15m|candle:15m|2026-02|||exact",
      "source": "UPBIT",
      "profile": "REPLAY_BACKTEST",
      "market": "KRW-XRP",
      "timeframes": ["15m"],
      "feeds": ["candle:15m"],
      "dateRangeLabel": "2026-02",
      "exact": true
    },
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
    "entryPolicy": { "a.entry.afterConfirmFill": "NEXT_OPEN" },
    "fillModelRequested": "AUTO",
    "fillModelApplied": "NEXT_OPEN",
    "notes": "룩어헤드 금지 준수"
  },
  "fees": { "feeMode": "PER_SIDE", "perSide": 0.0005, "roundtrip": null, "slippageAssumedPct": 0.0 },
  "risk": {
    "seedKrw": 1000000,
    "maxPositionRatio": 0.2,
    "dailyLossLimitPct": -2,
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
- API export endpoint: `GET /runs/:runId/run_report.json`
- `trades.csv`는 실제 `EXIT + FILL` 이벤트를 짝지어 생성해야 하며, 더미/합성 reason 또는 수익률을 넣지 않는다.
- `trades.csv`의 `netReturnPct`는 진입/청산 양쪽 체결에 수수료와 슬리피지를 반영한 순수익률이어야 한다.

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
### 7.1 Candle validity guard
- Realtime and snapshot candles used for evaluation/replay must be minute-bucket aligned.
- If a startup snapshot loader times out, the unfinished loader must not keep mutating runtime candle state during live evaluation.
- Realtime evaluation must ignore a closed candle when the candle timestamp is abnormally older than the triggering live trade timestamp.

### 7.2 Execution sequence regression guard
- Execution order regression checks must use `apps/api/src/modules/execution/engine/execution-sequence.ts` as the canonical source.
- Entry verification order: `SIGNAL_EMIT -> ORDER_INTENT -> FILL -> POSITION_UPDATE`
- Exit verification order: `EXIT -> ORDER_INTENT -> FILL -> POSITION_UPDATE`
- STRAT_B semi-auto verification order:
  - request phase: `SIGNAL_EMIT -> APPROVE_ENTER`
  - approved execution phase: `ORDER_INTENT -> FILL -> POSITION_UPDATE`

### 7.3 Realtime engine boundary regression guard
- Realtime engine refactors must keep the following module boundaries explicit:
  - candle state: `apps/api/src/modules/execution/engine/realtime-candle-state.ts`
  - runtime transition: `apps/api/src/modules/execution/engine/strategy-runtime-processor.ts`
  - runtime boot state: `apps/api/src/modules/execution/engine/strategy-runtime-state.ts`
  - websocket orchestration: `apps/api/src/modules/execution/engine/upbit-realtime-engine.ts`
- Regression checks must verify that a live trade still flows through these phases without skipping:
  1. trade message decode
  2. minute candle update
  3. closed candle detection
  4. strategy runtime transition
  5. event publish/persist
- Tests should prefer direct unit coverage of the extracted helper modules in addition to the high-level engine tests.

### 7.4 Runtime mode transition regression guard
- Mode-specific transition checks must use `apps/api/src/modules/execution/engine/strategy-runtime-mode-machine.ts` as the canonical source.
- Lifecycle sync checks must use `apps/api/src/modules/execution/engine/strategy-runtime-state.ts`.
- Minimum regression cases:
  1. `SEMI_AUTO + FLAT + strategy entry signal -> WAITING_APPROVAL`
  2. `SEMI_AUTO + WAITING_APPROVAL + approval missing -> WAITING_APPROVAL`
  3. `SEMI_AUTO + WAITING_APPROVAL + approval consumed -> IN_POSITION`
  4. `PAPER/AUTO/LIVE + FLAT + executable entry intent -> direct entry path`
- Processor tests should assert both emitted events and resulting lifecycle state.

### 7.5 Realtime network recovery regression guard
- Websocket recovery checks must use `apps/api/src/modules/execution/engine/upbit-realtime-connection.ts` as the canonical source.
- Minimum regression cases:
  1. websocket open sends the trade-stream subscription payload
  2. websocket close schedules reconnect with exponential backoff
  3. reconnect open marks recovery metrics
  4. owner stop/destroy prevents reconnect scheduling
- Engine tests may stay high-level, but connection lifecycle tests should target the extracted helper directly.

### 7.6 Runtime realtime status regression guard
- `apps/api/src/modules/runs/runs.service.ts` must stay the canonical derivation point for `realtimeStatus`.
- Minimum regression cases:
  1. startup snapshot delay marks the run as `DELAYED`
  2. persistence backlog marks the run as `DELAYED` with queue depth and retry metadata
  3. websocket reconnect marks the run as `RECONNECTING`
  4. repeated reconnect attempts may surface as `PAUSED`
  5. stale `lastEventAt` degrades a nominally live run to `DELAYED`

### 7.7 Persistence recovery regression guard
- DB write recovery checks must use `apps/api/src/modules/ws/gateways/run-event-persistence-buffer.ts` as the canonical source.
- Minimum regression cases:
  1. first DB failure buffers the event and does not publish it yet
  2. later successful flush publishes buffered events in order
  3. duplicate `(runId, seq)` events are still dropped before persistence buffering
  4. out-of-order but non-duplicate events remain observable and do not break the retry loop

### 7.8 Snapshot timeout recovery regression guard
- If startup snapshot bootstrap times out, the unfinished snapshot task must not clear runtime delayed status by itself.
- The first valid live trade must clear the delayed snapshot state for all runtime strategies.

### 7.9 Fill ledger regression guard
- Persisted fill regression checks must treat `public.text_fills` as the durable source of truth for fill history.
- Minimum regression cases:
  1. valid `FILL` persists to both `text_run_events` and `text_fills`
  2. retry after partial success still inserts a missing `text_fills` row when `text_run_events` already has `(run_id, seq)`
  3. strategy fill history and account summary continue to match after general run event retention rotates older ticks/events out
  4. rollout backfill from `text_run_events` to `text_fills` is idempotent

### 7.10 Realtime account summary regression guard
- `apps/api/src/modules/runs/runs.service.ts` must remain the canonical derivation point for strategy account summary mark-to-market fields.
- Minimum regression cases:
  1. latest retained strategy candle close overrides the last fill price for `markPriceKrw` on an open position
  2. `FILL` still updates `positionQty`, `avgEntryPriceKrw`, and `realizedPnlKrw` before mark-to-market recalculation
  3. live market updates change `totalPnlKrw` and `totalPnlPct` without mutating fill-driven fields

### 7.11 Position sizing regression guard
- `StrategyRuntimeProcessor` must size both direct entry and semi-auto approved entry through one shared sizing path.
- Minimum regression cases:
  1. BUY `ORDER_INTENT`, BUY `FILL`, and BUY `POSITION_UPDATE` share one computed `qty`
  2. SELL `ORDER_INTENT` and SELL `FILL` reuse the open runtime position qty
  3. account-base sizing uses latest strategy equity when available and falls back to `seedKrw` on cold start
  4. `ENTRY_READINESS=100` remains a readiness/status signal only; it must not imply a fixed quantity or repeated buy behavior by itself

### 7.12 Shared multi-strategy runtime regression guard
- One websocket feed drives three independent runtimes: `STRAT_A`, `STRAT_B`, `STRAT_C`.
- Minimum regression cases:
  1. one live trade updates all three strategy runs without overwriting another strategy's `strategyState`
  2. 1m close reaches STRAT_C, 15m close reaches STRAT_A/STRAT_B, 1h close reaches STRAT_B Bull Mode without cross-timeframe leakage
  3. `ENTRY_READINESS` and approval state remain isolated per strategy `runId`
  4. snapshot timeout recovery clears delayed status for every runtime only after the first valid live trade
  5. Runs Live initial hydration must read the fixed strategy runtime shells (`run-strat-a-0001`, `run-strat-b-0001`, `run-strat-c-0001`) instead of selecting the latest historical run per strategy, so stale entry-readiness snapshots cannot leak into the live operator table
  6. In `WAITING_APPROVAL`, identical `ENTRY_READINESS` snapshots for the same candle must be deduplicated so tick/orderbook bursts do not pin one strategy at a misleadingly noisy 100%

### 7.13 Strategy-document benchmark guard (ASCII addendum)
- Benchmark validation must follow `docs/ops/36_STRATEGY_DOC_VALIDATION_WORKFLOW_2026-03-08.md`.
- API comparison path: `GET /reports/benchmark-compare?strategyId=&strategyVersion=`.
- The endpoint must read persisted `text_run_reports` first, then reconstruct the selected `run_report.json` only for dataset/execution/fee verification.
- A run may only be compared against a strategy document when all of the following match:
  1. same market/timeframe/date window
  2. same `entryPolicy`
  3. same `fillModelRequested` and `fillModelApplied`
  4. same fee/slippage assumptions
  5. same parameter snapshot
- `status=MATCHED` may still be provisional.
- `docClaimEligible=true` is allowed only when persisted `dataset_ref` proves exact equality for:
  1. `market`
  2. ordered `timeframes`
  3. ordered `feeds`
  4. `dateRangeLabel`
  5. `exact=true`
- Default live/runtime dataset refs are non-exact and must not be treated as replay-equivalent benchmark evidence.
- `STRAT_A` benchmark row currently comes from the user-provided `strat_a_win_rate_90.txt`.
- `STRAT_C` benchmark row currently comes from the user-provided `strat_c_win_rate_56.txt`.
- `STRAT_B` benchmark row currently comes from the user-provided `xrp_ob_fvg_backtest_trades_202602.csv` (`11` trades, win rate `54.5455%`, average trade return `+0.5685%`, MDD `-4.697%`, fee `0.05%/side`, slippage `0%`).
- Generated artifacts are uploaded best-effort to Supabase Storage using `run-artifacts/<runId>/run_report.json`, `trades.csv`, and `events.jsonl`.

### 7.14 Runtime operator-session determinism guard
- `E2E_FORCE_SEMI_AUTO_SIGNAL=true` is the deterministic STRAT_B-only operator-session forcing switch.
- In `RUN_MODE=SEMI_AUTO`, the next `1m` candle open while STRAT_B is `FLAT` must emit a forced approval request.
- The normal SEMI_AUTO contract must still stay intact:
  1. `SIGNAL_EMIT`
  2. `APPROVE_ENTER`
  3. approval via `POST /runs/:runId/actions/approve`
  4. next open executes either `ORDER_INTENT -> FILL -> POSITION_UPDATE` or `RISK_BLOCK -> PAUSE`
- Engine startup must re-sync restored run shells to the current env session so `mode`, `entryPolicy`, and fill policy are not stale during live E2E.
