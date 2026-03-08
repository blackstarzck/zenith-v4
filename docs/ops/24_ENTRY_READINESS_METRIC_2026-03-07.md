# 24_ENTRY_READINESS_METRIC_2026-03-07.md

## 변경 목적
- 전략별 진입 시점을 더 직관적으로 파악할 수 있도록 `진입률(0~100%)` 지표를 Runs Live 화면에 추가.

## 적용 위치
- 화면: `apps/web/src/features/runs/pages/runs-live.page.tsx`
- 영역: 각 전략 섹션의 `핵심 지표 / 리스크 모니터`

## 동작 요약
- `진입률`은 전략별 실시간 캔들 기준의 진입 근접도 점수.
- 점수 범위: `0~100`
- 포지션 보유 중(`LONG`)이면 진입률 `100%`로 표시하고 `보유 중` 텍스트를 함께 노출.
- 임계값 배지:
  - `85% 이상`: `진입 임박`
  - `70% 이상`: `주의 구간`
  - `70% 미만`: `대기 구간`

## 서버 동기화
- 백엔드 엔진이 매 캔들마다 `ENTRY_READINESS` 이벤트를 발행한다.
- payload:
  - `entryReadinessPct` (0~100)
  - `entryReady` (전략 진입 조건 충족 여부)
  - `entryExecutable` (리스크/모드 기준 실제 실행 가능 여부)
  - `reason` (대기/차단 사유)
  - `inPosition` (보유 상태)
- 프론트는 `ENTRY_READINESS` 값만 표시한다(미수신 시 `0`, 보유중은 `100` 표시).

## 2026-03-07 보정
- 프론트 로컬 상향 보정(`Math.max(server, local)`) 제거.
- 진입률 표시는 서버 `ENTRY_READINESS.entryReadinessPct`만 사용.
- 엔진은 캔들당 `ENTRY_READINESS`를 최종 상태 기준 1회만 발행.
- `evaluateStrategyCandle` / `evaluateStrategyEntryReadiness`는 공통 내부 평가(`evaluateStrategyCandleDetailed`)를 공유해 진입 판단 단일 소스로 유지.

## 전략별 계산 방식 (엔진 기준)
- `STRAT_A`: BB Lower 근접도 + 리클레임(저가 하단 터치 후 종가 상단 회복) 보너스.
- `STRAT_B`: POI Zone(rolling high/low) 접촉 여부 및 근접 거리 기반.
- `STRAT_C`: 최근 고점 돌파 진행도 + 거래대금(또는 range 대체값) 스파이크 진행도 기반.

## 참고
- `entryReady=true`가 되어도 `entryExecutable=false`인 경우(리스크/모드 제한) 실제 매수는 실행되지 않는다.

## 2026-03-07 retention hotfix
- Runs Live now keeps the latest `ENTRY_READINESS` snapshot outside the general 500-event run window.
- Strategy fill history and account summary must merge persisted fills with runtime-retained fills.
- Page refresh must not reset STRAT_B entry readiness or fill history to zero only because `MARKET_TICK` events rotated older entries out of the recent event list.

## 2026-03-07 engine follow-up
- STRAT_B `ENTRY_READINESS` must reuse the first candle evaluation result for that bar.
- Re-evaluating the same closed candle after mutating strategy state is forbidden because it can self-confirm POI readiness on the impulse bar.
- STRAT_B flat-state readiness now scans recent bullish impulse candidates from retained candle history and scores POI proximity with age decay, so the metric does not stay pinned at `0` only because persisted POI state was lost.
- Strategy runtime now restores recent candle history on startup, and exit transitions keep indicator history needed for the next readiness calculation.
- Runs Live client now forces section re-sync when the backend restarts and event `seq` rewinds with a newer timestamp, preventing stale `0%` snapshots from remaining on screen.
- Waiting-state `ENTRY_READINESS` is capped at `99%`; `100%` is reserved for actual entry-ready states or in-position states to avoid false expectations of immediate fills.
