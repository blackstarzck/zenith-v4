# 05_TECH_SPEC.md
# 개발 스펙 (v0.9)

## 목표
- 프론트: 전략 제어/모니터링/리포트(runId 중심)
- 백엔드: 실행 엔진(상태머신), 페이퍼 트레이딩, 데이터 적재/리포트
- 거래소: 업비트는 초기 “데이터 수집 중심”, 실주문은 옵션

---

## 1) Frontend
- React + TypeScript
- UI: Ant Design
- Chart: lightweight-charts
- 서버 상태: TanStack Query(권장)
- UI 상태: Zustand 또는 Redux Toolkit 중 1개 고정
- 라우팅: React Router
- 폼: AntD Form + Zod(권장)

파라미터 스키마 단일 진실: `09_PARAMETER_REGISTRY.md`

---

## 2) Backend
- NestJS + TypeScript
- 모듈: Strategy / Execution / Exchange / Report
- 외부 HTTP 클라이언트: Axios(기본 timeout/retry 정책과 함께 사용)
- DB: Supabase(PostgreSQL)
- 저장소: Supabase Storage(run artifacts, csv/jsonl)
- 실시간 보조: Supabase Realtime(필요 시 run 상태/이벤트 대시보드 연동)
- ORM: TypeORM
- Queue/Job(권장): BullMQ(리포트/집계)
- 실시간: WebSocket(실행 로그/체결 이벤트 push)
- 관측성(필수): 구조화 시스템 로그 + 이벤트 알림(ENGINE/WS/DB/Queue/Exchange 오류 추적)

엔진 계약(인터페이스/체결/우선순위/이벤트): `../architecture/06_ARCHITECTURE.md`

---

## 3) Paper Trading (필수)
- 초기 가상 시드: 1,000,000 KRW
- 체결 모델은 요청값/적용값(`fillModelRequested`/`fillModelApplied`)을 함께 기록(결과 재현 목적)
- 모든 실행은 runId로 기록
- 실험 규격: `10_EXPERIMENT_PROTOCOL.md`

---

## 4) Exchange (Upbit)
- 초기: 시세/호가/캔들 데이터 수집
- 추후: 실주문 옵션(실계정 약 240,000 KRW)
- 실주문 전환 가드레일: `../ops/07_AGENT.md`

---

## 5) 디렉토리 구조/타입 안전성 표준
- 프로젝트 디렉토리 구조(React/NestJS/실시간 WS): `12_PROJECT_STRUCTURE.md`
- DTO/타입 계약/불변성 규칙은 12 문서를 단일 기준으로 적용한다.
- API/WS contracts 및 `SYSTEM_EVENT` enum 표준: `14_CONTRACTS_SPEC.md`
- Supabase 데이터 모델/저장 규칙: `17_SUPABASE_PERSISTENCE.md`
- Supabase SQL 구현 초안: `18_SUPABASE_SQL_DRAFT.md`
