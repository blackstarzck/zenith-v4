# 22_RUNTIME_E2E_CHECKLIST.md
# 런타임 E2E 실검증 체크리스트

## 0) 목적
- `/runs/live` 실시간 동작이 문서 흐름과 일치하는지 운영 관점에서 검증한다.
- 스냅샷/델타/승인/리스크 차단/복구 메트릭을 한 번에 확인한다.

## 1) 사전 준비
- `.env` 필수값 설정
  - `SUPABASE_URL`, `SUPABASE_SECRET_KEY`
  - `UPBIT_ACCESS_KEY`, `UPBIT_SECRET_KEY`
  - `VITE_API_BASE_URL=http://localhost:4000`
  - `VITE_SOCKET_PATH=/socket.io`
  - `UPBIT_MARKET=KRW-XRP`
  - `RUN_MODE=SEMI_AUTO` (승인 플로우 검증용)
  - `RUNCONFIG_MISMATCH_BLOCK=false` (초기 검증)
  - (선택) `E2E_FORCE_SEMI_AUTO_SIGNAL=true` (실시장 조건으로 승인 이벤트가 늦을 때 사용)
- 실행
  - `npm --workspace @zenith/api run dev`
  - `npm --workspace @zenith/web run dev -- --port 5174`

## 2) 시나리오 A: 캔들 스냅샷 + 실시간 델타
1. `http://localhost:5174/runs/live` 진입
2. 차트 첫 로드 시 과거 캔들(스냅샷) 렌더링 확인
3. 1~2분 관찰하여 마지막 캔들이 실시간으로 갱신되는지 확인
4. `GET /runs/run-dev-0001/candles?limit=300` 응답과 차트 마지막 캔들 값이 일치하는지 확인

성공 기준:
- 빈 차트가 아니라 초기 캔들이 즉시 보인다.
- `MARKET_TICK` 이벤트 증가와 함께 마지막 캔들이 변경된다.

## 3) 시나리오 B: SEMI_AUTO 승인 플로우
1. `RUN_MODE=SEMI_AUTO` 상태에서 이벤트 탭 관찰
2. `SIGNAL_EMIT` 이후 `APPROVE_ENTER` 이벤트 발생 확인
3. 승인 버튼 클릭
4. 다음 봉에서 `ORDER_INTENT -> FILL -> POSITION_UPDATE` 순서 확인

성공 기준:
- 승인 전에는 진입 체결이 발생하지 않는다.
- 승인 후 다음 봉에 체결 이벤트가 발생한다.

## 4) 시나리오 C: 리스크 차단
1. 테스트를 위해 리스크 값을 엄격하게 설정
  - 예: `RISK_MAX_DAILY_ORDERS=1`
2. 첫 진입 이후 추가 진입 시도 이벤트를 관찰
3. `RISK_BLOCK` 또는 `LIVE_GUARD_BLOCKED` 이후 `PAUSE` 발생 확인

성공 기준:
- 차단 이벤트가 발생하면 추가 진입 체결이 중단된다.
- 이벤트 순서가 `/runs/:runId` 응답과 동일하다.

## 5) 시나리오 D: runConfig 불일치 가드
1. `RUNCONFIG_MISMATCH_BLOCK=true` 설정 후 API 재시작
2. `GET /ops/metrics`에서 `runConfigMismatches` 카운터 확인
3. 불일치가 감지되면 이벤트가 차단되고 경고 로그가 남는지 확인

성공 기준:
- 불일치 이벤트는 저장/브로드캐스트 전에 차단된다.
- `ENGINE_STATE_INVALID` 로그와 카운터 증가가 함께 발생한다.
- 차단 시 `PAUSE(reason=RUNCONFIG_MISMATCH_BLOCKED)` 이벤트가 기록된다.

## 6) 시나리오 E: 복구 메트릭
1. 네트워크를 잠시 차단하거나 업비트 WS 연결을 끊었다가 복구
  - 개발/로컬 검증용: `POST /ops/actions/upbit-reconnect` 호출로 재연결 강제
2. `GET /ops/metrics`에서 아래 값 확인
  - `upbitReconnectAttempts`
  - `upbitReconnectRecoveries`
  - `upbitAvgRecoveryMs`

성공 기준:
- 재연결 시도/복구 수가 증가한다.
- 평균 복구 시간이 0보다 큰 값으로 집계된다.

## 7) 최종 종료 기준
- `/runs/live` 차트 갱신 정상
- 승인 플로우 정상
- 리스크 차단 정상
- runConfig 가드 정상
- 복구 메트릭 정상
- `npm run typecheck`, `npm --workspace @zenith/api run test` 통과
