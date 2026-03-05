# 00_INDEX.md

## 목적
- 3개 자동매매 전략을 동일한 시스템에서 **독립적으로 실행/비교/개선**하기 위한 문서 세트.
- 초기에는 **가상 시드 1,000,000 KRW**로 전략별 가상 매수/매도(페이퍼) 테스트.
- 이후 업비트 실계정(약 240,000 KRW)은 옵션으로 전환.

## 문서 맵 (00~21)
- 00 인덱스: `00_INDEX.md`
- 02 개발 가이드: `../guides/02_DEV_GUIDE.md`
- 03 주석 규칙: `../guides/03_COMMENT_RULES.md`
- 04 디자인 가이드: `../guides/04_DESIGN_GUIDE.md`
- 05 개발 스펙: `../specs/05_TECH_SPEC.md`
- 06 아키텍처 + 엔진 계약(단일 진실): `../architecture/06_ARCHITECTURE.md`
- 07 운영/유지보수(AGENT): `../ops/07_AGENT.md`
- 08 전략 정의: `../specs/08_STRATEGIES.md`
- 09 파라미터 레지스트리(SSOT): `../specs/09_PARAMETER_REGISTRY.md`
- 10 실험 프로토콜: `../specs/10_EXPERIMENT_PROTOCOL.md`
- 11 IA(정보구조): `../specs/11_IA.md`
- 12 프로젝트 디렉토리 구조(React/NestJS/WS): `../specs/12_PROJECT_STRUCTURE.md`
- 13 화면 설계(Wireframe UI Spec): `../specs/13_SCREEN_SPEC.md`
- 14 Contracts 표준(API/WS DTO, SYSTEM_EVENT enum): `../specs/14_CONTRACTS_SPEC.md`
- 15 One Page Flow(핵심 흐름 요약): `../specs/15_ONE_PAGE_FLOW.md`
- 16 개발 착수 체크리스트(Code-First Gate): `../specs/16_DEV_START_CHECKLIST.md`
- 17 Supabase 저장 전략(실전 테스트/재백테스트): `../specs/17_SUPABASE_PERSISTENCE.md`
- 18 Supabase SQL 초안(DB 스키마/인덱스/RLS): `../specs/18_SUPABASE_SQL_DRAFT.md`
- 19 Supabase SQL 런북(실행 순서/검증 쿼리): `../specs/19_SUPABASE_SQL_RUNBOOK.md`
- 20 용어집(트레이딩/실시간 시스템): `../specs/20_TERMS_GLOSSARY.md`
- 21 남은 작업 핸드오프: `../ops/21_REMAINING_TASKS_HANDOFF.md`

## 중요 원칙(실전/실시간 목적)
- 엔진 계약(체결 타이밍, 승인 흐름, 우선순위, 수수료 모델)은 **06에서만 정의**한다.
- 전략 개선은 **08/09**에서만 진행한다.
- 백테스트 재현성은 **10의 runConfig + run_report.json 스키마**로 고정한다.

## 파일 정책(혼선 방지)
- `../architecture/06_ENGINE_CONTRACT.md`는 **더 이상 사용하지 않는다**. (06으로 리다이렉트 문구만 유지)
- 번호 정책: 현재 문서 세트는 `00, 02~19`를 사용하며 `01` 문서는 없다.
