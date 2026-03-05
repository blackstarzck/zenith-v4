# 21_REMAINING_TASKS_HANDOFF.md
# 남은 작업 핸드오프 (다른 개발 환경용)

## 0) 목적
- 현재 구현 상태를 기준으로 남은 작업을 우선순위/완료기준과 함께 정리한다.
- 다른 PC/환경에서 바로 이어서 작업할 수 있도록 실행 명령과 검증 기준을 함께 제공한다.

---

## 1) 현재 완료 상태 요약
- 실시간 데이터 경로: `REST 1m 캔들 스냅샷 + WS trade 델타`
- 엔진 이벤트: `MARKET_TICK`, `SIGNAL_EMIT`, `APPROVE_ENTER`, `ORDER_INTENT`, `FILL`, `EXIT`, `RISK_BLOCK`, `LIVE_GUARD_BLOCKED`, `PAUSE`
- 실행 제어 API: `PATCH /runs/:runId/control`
- 운영 메트릭 API: `GET /ops/metrics`
- 리포트 KPI: 서버 `kpi` 기반으로 UI 반영

---

## 2) 남은 작업 (우선순위)

### P0. 런타임 E2E 실검증 (필수)
- 목표:
  - `/runs/live`에서 초기 캔들(스냅샷) + 실시간 델타 갱신 확인
  - `SEMI_AUTO`에서 `APPROVE_ENTER -> NEXT_OPEN` 체결 흐름 확인
  - 리스크 차단 시 `RISK_BLOCK/PAUSE` 확인
- 완료 기준:
  - 화면/로그/`/runs/:runId` 이벤트가 동일한 순서로 일치
  - `seq` 역순/중복 이벤트 무시가 동작

### P1. STRAT_A/B/C 규칙 문서 완전 매핑
- 목표:
  - 현재 단순화된 조건을 `08_STRATEGIES.md`, `09_PARAMETER_REGISTRY.md` 지표/필터로 확장
  - A: BB/ATR/ADX/RSI slope
  - B: OB/FVG/POI 유효기간/승인지연
  - C: breakout/lookback/value spike/buy ratio
- 완료 기준:
  - 각 전략별 단위 테스트 + 회귀 테스트 추가
  - 파라미터 키를 코드에서 직접 참조 가능(하드코딩 제거)

### P1. runConfig 파이프라인 정식화
- 목표:
  - 런 생성 시 `strategyId/mode/fillModel/entryPolicy/riskSnapshot`를 명시적으로 고정 기록
  - 엔진 실행값과 `/runs/:runId` 응답/리포트의 값 일치
- 완료 기준:
  - UI 제어값 변경 -> run snapshot 반영 -> 이벤트 payload 반영까지 검증

### P2. 리포트 확장
- 목표:
  - 비교 리포트에 기간 필터/모드 필터/전략 버전 필터 추가
  - KPI: trades/winRate/sumReturn/MDD 외 PF/avgWin/avgLoss 추가
- 완료 기준:
  - `/reports/compare`가 더미 없이 전부 실데이터 계산

### P2. 운영 안정화
- 목표:
  - WS 재연결/복구 지표(재시도 횟수, 평균 복구 시간) 메트릭화
  - 장애 시 `SYSTEM_EVENT` 집계/알림 강화
- 완료 기준:
  - `/ops/metrics` 확장 + 시스템 설정 화면 가시화

---

## 3) 권장 작업 순서
1. P0 런타임 E2E 검증
2. P1 STRAT_A/B/C 규칙 완전 매핑
3. P1 runConfig 정식화
4. P2 리포트 확장
5. P2 운영 안정화

---

## 4) 다른 환경에서 시작 명령
```bash
# 루트
npm install

# 타입/테스트
npm run typecheck
npm --workspace @zenith/api run test

# API
npm --workspace @zenith/api run dev

# WEB
npm --workspace @zenith/web run dev -- --port 5174
```

---

## 5) 필수 환경변수
루트 `.env` 기준:
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `UPBIT_ACCESS_KEY`
- `UPBIT_SECRET_KEY`
- `VITE_API_BASE_URL=http://localhost:4000`
- `VITE_SOCKET_PATH=/socket.io`
- `UPBIT_MARKET=KRW-XRP`
- `STRATEGY_ID=STRAT_A|STRAT_B|STRAT_C`
- `RUN_MODE=PAPER|SEMI_AUTO|AUTO|LIVE`
- `ALLOW_LIVE_TRADING=false|true`
- `RISK_DAILY_LOSS_LIMIT_PCT` (예: `-2`)
- `RISK_MAX_CONSECUTIVE_LOSSES` (예: `3`)
- `RISK_MAX_DAILY_ORDERS` (예: `200`)
- `RISK_KILL_SWITCH=true|false`

---

## 6) 인수인계 체크리스트
- [ ] `npm run typecheck` 통과
- [ ] `npm --workspace @zenith/api run test` 통과
- [ ] `/runs/live` 캔들 실시간 갱신 확인
- [ ] `SEMI_AUTO` 승인 이벤트 확인
- [ ] `RISK_BLOCK`/`PAUSE` 이벤트 확인
- [ ] `/reports/runs`, `/reports/compare` 실데이터 확인
- [ ] `/ops/metrics` 값 증가 확인
