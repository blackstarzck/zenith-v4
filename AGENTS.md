## Encoding Safety

- For files that may contain Korean text, do not rewrite whole files via shell commands.
- Forbidden commands/patterns:
  - `Set-Content`
  - `Out-File`
  - shell redirection (`>`)
  - `WriteAllText`
  - `WriteAllLines`
- Use `apply_patch` for code/file edits.
- If a large-scale replacement is needed, ask for user approval first.
- After edits, check `git diff` for mojibake or broken string literals.
- If any encoding corruption is detected, stop and report immediately.

## Agent Operation Policy

### Documentation Sync Rule (User-Requested Changes)

- If the user requests code changes (add/modify/delete) and those changes affect project documentation, you must analyze the impact and update the relevant Markdown documents in the same task.
- Do not finish the task with code-only changes when documentation updates are required by the change scope.
- At minimum, check and update the relevant files under `docs/` (specs, architecture, guides, ops) and any root-level policy docs (including `AGENTS.md`) when applicable.
- In the final report, explicitly state:
  1) which Markdown files were updated,
  2) why each update was necessary,
  3) which documentation was reviewed but did not require changes.

### Pre-Work Planning Rule

- Standing user rules and core project goals must be recorded in `docs/ops/07_AGENT.md`.
- Before substantial code changes, review `docs/ops/07_AGENT.md`, analyze impact, and present a concrete execution plan before editing.
- If the user adds a new standing rule or priority, update `docs/ops/07_AGENT.md` in the same task.

### 0) 목적
- Codex가 변경을 만들 때 왜 이 변경이 필요한지, 무엇을 함께 수정해야 하는지 명확히 안내한다.
- 부분 수정으로 인한 로직 파편화와 문서-구현 불일치를 방지한다.

참조 문서:
- 개발 가이드: `docs/guides/02_DEV_GUIDE.md`
- 주석 규칙: `docs/guides/03_COMMENT_RULES.md`
- 디자인 가이드: `docs/guides/04_DESIGN_GUIDE.md`
- 운영 계약: `docs/architecture/06_ARCHITECTURE.md`
- 전략 구조: `docs/specs/08_STRATEGIES.md`
- 파라미터 레지스트리: `docs/specs/09_PARAMETER_REGISTRY.md`
- 실험 프로토콜: `docs/specs/10_EXPERIMENT_PROTOCOL.md`
- IA: `docs/specs/11_IA.md`
- 프로젝트 구조: `docs/specs/12_PROJECT_STRUCTURE.md`
- Contracts 스펙: `docs/specs/14_CONTRACTS_SPEC.md`
- 개발 시작 체크리스트: `docs/specs/16_DEV_START_CHECKLIST.md`
- Supabase 영속화: `docs/specs/17_SUPABASE_PERSISTENCE.md`
- Supabase SQL 초안: `docs/specs/18_SUPABASE_SQL_DRAFT.md`

### 1) 작업 범위와 동시 수정 원칙
- 모든 변경은 아래 중 하나 이상으로 분류한다.
  1) 전략 로직 변경
  2) 파라미터 변경(추가/삭제/기본값/범위)
  3) 실행 엔진/체결 모델 변경(fillModel 포함)
  4) 리포트/지표 변경
  5) UI/UX 변경
- 사용자 요구를 반영하기 위해 문서(00, 02~18) 중 관련 항목이 하나라도 바뀌면 문서를 함께 수정한다.
- 변경 전 영향도 분석을 수행한다.
  - 분석 범위: 문서(md), 프론트 컴포넌트, 백엔드 모듈, contracts, 테스트/운영 설정
- 문서만 바꾸고 구현을 누락하거나, 구현만 바꾸고 문서를 누락하지 않는다.
- 요구가 모호하면 구현 전에 질문으로 확정한다.

변경 유형별 필수 문서:
- 전략 로직: `docs/specs/08_STRATEGIES.md`
- 파라미터: `docs/specs/09_PARAMETER_REGISTRY.md`
- 엔진/체결: `docs/architecture/06_ARCHITECTURE.md`, `docs/specs/10_EXPERIMENT_PROTOCOL.md`
- 리포트/지표: `docs/specs/10_EXPERIMENT_PROTOCOL.md`
- UI/UX: `docs/guides/04_DESIGN_GUIDE.md`
- IA: `docs/specs/11_IA.md`
- 디렉터리/모듈 경계: `docs/specs/12_PROJECT_STRUCTURE.md`
- API/WS DTO: `docs/specs/14_CONTRACTS_SPEC.md` (+ `packages/contracts`)
- 저장소/DB 정책: `docs/specs/17_SUPABASE_PERSISTENCE.md`
- SQL/RLS/인덱스: `docs/specs/18_SUPABASE_SQL_DRAFT.md`

### 2) 전략 분리 강제 규칙
- 전략 코드는 `strategies/<strategyId>/` 하위에만 둔다.
- 공통 유틸은 `shared/`로 이동한다.
- 전략 간 직접 import를 금지한다.

### 3) 실행/배포(실주문 전환) 가드레일
- 기본 모드는 PAPER(시드 1,000,000 KRW).
- LIVE 전환은 아래를 모두 만족할 때만 허용한다.
  - `docs/specs/10_EXPERIMENT_PROTOCOL.md`의 실험 기준 충족
  - 최대 손실/주문 제한/kill switch 설정 완료
  - 운영 계약(06)의 우선순위/상태/체결 계약 준수

### 4) 변경 체크리스트(PR 전)
- [ ] `docs/specs/16_DEV_START_CHECKLIST.md` 항목 통과
- [ ] 변경 유형별 필수 문서 업데이트 완료
- [ ] 운영 계약(06) 위반 없음(우선순위/상태/체결 계약)
- [ ] 외부 I/O 경계에 `try/catch + timeout + retry` 반영
- [ ] Supabase RLS/권한 경계(service role 서버 전용) 준수
- [ ] 중복/역순 이벤트(`run_id + seq`) 처리 및 복구 가능성 확인

### 5) 완료 보고 규칙
- 완료 응답에는 아래 3가지를 포함한다.
  1) 완료된 작업
  2) 미완료 또는 제한 사항
  3) 다음 작업(Next Actions)
- 수용 기준을 만족하지 못하면 완료로 선언하지 않는다.
- 목업/더미 데이터 의존 항목은 미완료로 명시한다.
- 문서와 구현이 다르면 즉시 정정하고 불일치 항목을 보고한다.

