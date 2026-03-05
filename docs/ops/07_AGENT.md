# 07_AGENT.md
# AGENT.md (Codex 개발/유지보수 운영 지침)

## 0) 역할
- Codex가 변경을 만들 때 “어디를 고쳐야 하는지 / 무엇을 깨면 안 되는지”를 안내한다.
- 특히 “조용한 로직 훼손”을 막기 위해, 엔진 계약을 기준으로 리뷰한다.

참조:
- 개발 규칙: `../guides/02_DEV_GUIDE.md`
- IA(정보구조): `../specs/11_IA.md`
- 프로젝트 구조(React/NestJS/WS): `../specs/12_PROJECT_STRUCTURE.md`
- Contracts 표준(API/WS DTO): `../specs/14_CONTRACTS_SPEC.md`
- 개발 착수 체크리스트(Code-First Gate): `../specs/16_DEV_START_CHECKLIST.md`
- Supabase 저장 전략: `../specs/17_SUPABASE_PERSISTENCE.md`
- Supabase SQL 초안: `../specs/18_SUPABASE_SQL_DRAFT.md`
- 주석 규칙: `../guides/03_COMMENT_RULES.md`
- 엔진 계약(핵심): `../architecture/06_ARCHITECTURE.md`
- 전략 구조: `../specs/08_STRATEGIES.md`
- 파라미터 레지스트리: `../specs/09_PARAMETER_REGISTRY.md`
- 실험 프로토콜: `../specs/10_EXPERIMENT_PROTOCOL.md`

---

## 1) 작업 단위 원칙
모든 변경은 다음 중 하나로 분류:
1) 전략 로직 변경
2) 파라미터 변경(추가/기본값/범위)
3) 실행 엔진/체결 모델 변경(fillModel 포함)
4) 리포트 지표 변경
5) UI/UX 변경

- 사용자 요구를 반영하기 위해 현재 문서(00, 02~18) 중 어느 한 곳이라도 수정이 필요하면, 해당 문서를 반드시 수정한다.
- 모든 변경 요청은 착수 전에 영향도 분석을 수행한다.
  - 분석 범위: 문서(md) + 코드 컴포넌트 + 백엔드 모듈 + contracts + 테스트/운영 설정
  - 문서만 수정하고 실제 컴포넌트/모듈 반영이 필요한 변경을 누락하면 안 된다.
- 사용자 요청이 잘못된 방향이거나 너무 추상적이면, 구현 전에 반드시 역질문으로 요구사항을 구체화한다.

각 분류별로 반드시 수정해야 하는 문서:
- 전략 로직 변경 → `../specs/08_STRATEGIES.md`
- 파라미터 변경 → `../specs/09_PARAMETER_REGISTRY.md`
- 엔진/체결 변경 → `../architecture/06_ARCHITECTURE.md` + `../specs/10_EXPERIMENT_PROTOCOL.md`
- 리포트 변경 → `../specs/10_EXPERIMENT_PROTOCOL.md`
- UI 변경 → `../guides/04_DESIGN_GUIDE.md`
- IA 변경(페이지 트리/내비게이션/플로우) → `../specs/11_IA.md` (+ 필요 시 `../guides/04_DESIGN_GUIDE.md`)
- 디렉토리 구조/모듈 경계 변경 → `../specs/12_PROJECT_STRUCTURE.md` (+ 필요 시 `../guides/02_DEV_GUIDE.md`, `../specs/05_TECH_SPEC.md`)
- API/WS DTO 스키마 변경 → `../specs/14_CONTRACTS_SPEC.md` (+ 필요 시 `packages/contracts` 구현 및 `../specs/10_EXPERIMENT_PROTOCOL.md`)
- 저장소/DB 정책 변경(Supabase/RLS/보존) → `../specs/17_SUPABASE_PERSISTENCE.md` (+ 필요 시 `../specs/05_TECH_SPEC.md`, `../specs/12_PROJECT_STRUCTURE.md`)
- DB 스키마/인덱스/RLS SQL 변경 → `../specs/18_SUPABASE_SQL_DRAFT.md` (+ 필요 시 `../specs/17_SUPABASE_PERSISTENCE.md`)
- 네트워크 복원력/예외처리 정책 변경(timeout/retry/circuit-breaker/queue) → `../architecture/06_ARCHITECTURE.md` + `../specs/12_PROJECT_STRUCTURE.md` + 관련 모듈 구현(`apps/api/modules/resilience`, `observability`, `infra/db`)

---

## 2) “전략 3개” 분리 규칙(강제)
- 전략 코드는 반드시 `strategies/<strategyId>/` 아래에만 존재
- 공통 유틸은 `shared/`로 이동
- 전략 간 import 금지(전략 A가 전략 B 코드를 참조하지 않음)

---

## 3) 실험/배포(실주문 전환) 가드레일
- 기본 모드: PAPER(가상 시드 1,000,000 KRW)
- 실주문(LIVE) 모드는 반드시 다음 조건 충족 후 허용:
  - 최소 N회 runId 실험 결과가 `../specs/10_EXPERIMENT_PROTOCOL.md` 기준 충족
  - 최대 손실 한도/1일 주문 제한 설정 완료
  - killSwitch 동작 확인
  - 엔진 계약(06)의 우선순위/ENTRY_PENDING/WAIT_CONFIRM/fillModel 변경 없음

---

## 4) 변경 체크리스트(PR 단위)
- [ ] `../specs/16_DEV_START_CHECKLIST.md`의 항목을 모두 통과했는가?
- [ ] 변경 유형별 필수 문서(08/09/10/11/12/13/14) 동기화가 완료되었는가?
- [ ] 엔진 계약(06)에 위배되는 변경이 없는가? (우선순위/상태/체결 계약)
- [ ] 외부 I/O 경계에 `try/catch + timeout + retry 정책`이 반영되었는가?
- [ ] Supabase RLS/키 경계(서비스키 서버 전용)가 유지되는가?
- [ ] 중복/역순 이벤트(`run_id+seq`) 처리 시 크래시 없이 복구 가능한가?

---

## 5) 완료 보고 규칙(재발 방지)
- 작업 완료 응답에는 아래 3개를 반드시 포함한다.
  1) `완료된 작업`
  2) `미완료/제한사항`
  3) `남은 작업(Next Actions)`
- 수용 기준(acceptance criteria)을 하나라도 충족하지 못하면 `완료`라고 표현하지 않는다.
- UI/기능이 목업(mock) 데이터로 동작하는 경우, 실데이터 연동 전까지 반드시 `미완료`로 표기한다.
- 문서와 실제 구현이 다르면 문서/코드 둘 다 즉시 정정하고, 보고 시 불일치 항목을 명시한다.
- 사용자가 “계속 진행”을 요청한 경우에도, 단계 종료마다 남은 작업을 누락 없이 보고한다.
