# 16_DEV_START_CHECKLIST.md
# 개발 착수 체크리스트 (Code-First Gate)

## 목적
- 문서 규칙(`06/09/10/12/14`)이 코드에 실제 반영되도록 착수/PR 단계에서 강제한다.
- 구현 이후가 아니라 구현 전에 불일치 리스크를 차단한다.

---

## 1) 착수 전(필수)
- 작업 유형 분류 완료:
  - 전략 / 파라미터 / 엔진 / 리포트 / UI / IA / 구조 / contracts
- 영향도 분석 완료:
  - 문서 + 컴포넌트 + 모듈 + contracts + 테스트 + 운영설정
- 요구사항 명확화 완료:
  - 추상적/상충 요구사항은 역질문으로 확정

---

## 2) 코드 반영 최소 조건
- `runConfig` 직렬화 구조에 다음 필드 존재:
  - `mode`, `entryPolicy`, `fillModelRequested`, `fillModelApplied`, `riskSnapshot`
- `SYSTEM_EVENT` 타입/스키마는 `packages/contracts`에서 import해 사용
- `SEMI_AUTO` 승인 흐름에서 `APPROVE_ENTER` 이벤트가 실제로 기록됨
- `PER_SIDE/ROUNDTRIP` 동시 적용 방지 로직 존재

---

## 3) 테스트 게이트
- Unit:
  - 실행엔진 상태 전이, 리스크 차단, fillModel 결정 테스트
- Integration:
  - DTO validation + controller/service/repository 경계 테스트
- Contract:
  - `packages/contracts` 변경 시 web/api 동시 타입체크
- E2E:
  - run 시작 -> 이벤트 생성 -> run_report 생성까지 `runId` 검증

---

## 4) PR 게이트(머지 금지 조건)
- 아래 중 하나라도 실패하면 머지 금지:
  - 문서 변경 필요 항목 누락
  - contracts 변경 후 버전/마이그레이션 노트 누락
  - `fillModelRequested`/`fillModelApplied` 기록 누락
  - `SYSTEM_EVENT` ERROR/FATAL 알림 경로 미검증
  - 완료 보고에서 `미완료/제약/남은 작업` 누락

---

## 5) 문서 동기화 매트릭스
- 엔진/체결 변경:
  - `../architecture/06_ARCHITECTURE.md`, `10_EXPERIMENT_PROTOCOL.md`, 코드(Execution/Runs), 테스트
- 파라미터 변경:
  - `09_PARAMETER_REGISTRY.md`, 코드(폼/검증/적용), 테스트
- WS/이벤트 변경:
  - `../architecture/06_ARCHITECTURE.md`, `12_PROJECT_STRUCTURE.md`, `14_CONTRACTS_SPEC.md`, 코드(WS/contracts), 테스트
- 화면/플로우 변경:
  - `11_IA.md`, `13_SCREEN_SPEC.md`, 코드(router/features), 테스트

---

## 6) 권장 자동화
- CI 필수 단계:
  - `typecheck` (web/api/contracts)
  - `test` (unit/integration)
  - `contract-test`
  - `lint`
- Commit/PR 템플릿에 체크박스 추가:
  - 영향도 분석 완료
  - 동기화 문서 반영 완료
  - run 재현성 검증 완료
  - 완료/미완료/남은 작업 보고 포함

---

## 8) 응답 포맷 규칙(사용자 커뮤니케이션)
- 작업 종료 응답은 아래 순서를 강제한다.
  1) 완료된 작업
  2) 미완료/제약
  3) 남은 작업
- `미완료/제약`이 비어있지 않으면 “완료” 단독 문구를 사용하지 않는다.
- 실시간/실데이터 요구사항에서 mock 데이터가 남아있으면 반드시 미완료로 분류한다.

## 7) 구현 진행 상태 (2026-03-05)
- [x] IA 핵심 라우트 구현: `/runs/live`, `/runs/history`, `/runs/:runId`
- [x] IA 상위 라우트 골격 구현: `/strategies*`, `/experiments*`, `/reports*`, `/settings*`
- [x] `/runs/live` Ant Design 기반 전환 + 실시간 상태 배지 연동
- [x] `/runs/live` 차트를 mock 데이터에서 실시간 `MARKET_TICK` 캔들 렌더링으로 전환
- [x] API 읽기 모델 추가: `GET /runs/history`, `GET /runs/:runId`
- [x] run 상세 Artifacts 다운로드 구현: `events.jsonl`, `trades.csv`
- [x] 차트 스냅샷 API 추가: `GET /runs/:runId/candles?limit=300`
- [x] 실시간 최소 전략 파이프라인 연결: 봉 마감 기준 `SIGNAL_EMIT -> ORDER_INTENT -> FILL -> EXIT`
- [x] 실행 제어 API 추가: `PATCH /runs/:runId/control`
- [x] 운영 메트릭 API 추가: `GET /ops/metrics`
- [x] 엔진 리스크/라이브 가드 추가: `RISK_BLOCK`, `LIVE_GUARD_BLOCKED`, `PAUSE`
- [x] 리스크 가드 순수 모듈 + 단위테스트 추가(`risk-guard.spec.ts`)
- [x] Reports runs 목록/상세 화면에 API 기반 데이터 연동
