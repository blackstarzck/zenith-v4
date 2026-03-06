# 21_REMAINING_TASKS_HANDOFF.md
# 남은 작업 핸드오프 (다른 개발 환경용)

## 0) 목적
- 현재 구현 상태를 기준으로 남은 작업을 우선순위/완료기준과 함께 정리한다.
- 다른 PC/환경에서 바로 이어서 작업할 수 있도록 실행 명령과 검증 기준을 함께 제공한다.
- 런타임 실검증 절차는 `22_RUNTIME_E2E_CHECKLIST.md`를 기준으로 수행한다.

---

## 1) 현재 완료 상태 요약
- 실시간 데이터 경로: `REST 1m 캔들 스냅샷 + WS trade 델타`
- 엔진 이벤트: `MARKET_TICK`, `SIGNAL_EMIT`, `APPROVE_ENTER`, `ORDER_INTENT`, `FILL`, `EXIT`, `RISK_BLOCK`, `LIVE_GUARD_BLOCKED`, `PAUSE`
- 실행 제어 API: `PATCH /runs/:runId/control`
- 런 설정 API: `GET /runs/:runId/config`
- 운영 메트릭 API: `GET /ops/metrics`
- 리포트 KPI: 서버 `kpi` 기반으로 UI 반영 (`PF`, `avgWin`, `avgLoss` 포함)
- 비교 리포트 필터: 기간/모드/마켓/전략버전 반영
- 비교 리포트 집계 API: `GET /reports/compare`
- runConfig 불일치 감시: 이벤트 payload와 runConfig의 strategy/version/market 불일치 감지 + 카운트
- 운영 복구 지표: 업비트 재연결 시도/복구 수/평균 복구 시간 집계

---

## 2) 남은 작업 (우선순위)
- 현재 기준 **필수 남은 작업 없음**.
- 완료됨:
  - P0 런타임 E2E 실검증(A~E)
  - P1 STRAT_A/B/C 규칙 확장 + 테스트 보강 + 파라미터 레지스트리 코드 참조
  - P1 runConfig mismatch 차단 시 `PAUSE` 자동 전이
  - P2 전략 버전별 회귀 추이 시각화
  - P2 업비트 재연결/복구 메트릭 + 강제 재연결 테스트 엔드포인트

---

## 3) 권장 작업 순서
1. 운영 환경에서 동일 체크리스트(A~E) 재실행
2. 전략 실성능 데이터 축적 후 파라미터 튜닝
3. 알림/대시보드 연동 고도화

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
- [x] `npm run typecheck` 통과
- [x] `npm --workspace @zenith/api run test` 통과
- [x] `/runs/live` 캔들 실시간 갱신 확인
- [x] `SEMI_AUTO` 승인 이벤트 확인
- [x] `RISK_BLOCK`/`PAUSE` 이벤트 확인
- [x] `/reports/runs`, `/reports/compare` 실데이터 확인
- [x] `/ops/metrics` 값 증가 확인
