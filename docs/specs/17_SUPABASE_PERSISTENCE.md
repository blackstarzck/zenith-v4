# 17_SUPABASE_PERSISTENCE.md
# Supabase 저장 전략 (실전 테스트 데이터/결과/재백테스트)

## 0) 목적
- 실전 테스트 데이터와 결과를 손실 없이 저장해 재백테스트/전략 고도화에 재사용한다.
- `runId`를 중심으로 메타, 이벤트, 체결, 리포트를 추적 가능하게 만든다.

참조:
- 엔진 계약: `../architecture/06_ARCHITECTURE.md`
- 실험 프로토콜: `10_EXPERIMENT_PROTOCOL.md`
- 구조 표준: `12_PROJECT_STRUCTURE.md`
- SQL 구현 초안: `18_SUPABASE_SQL_DRAFT.md`

---

## 1) 저장 원칙
- 단일 추적 키: `runId`
- 저장 분리:
  - 구조화 메타/KPI: Supabase Postgres
  - 대용량 원본/산출물: Supabase Storage
- 재현성 보장:
  - `parameterSnapshot`, `entryPolicy`, `fillModelRequested`, `fillModelApplied`, 데이터셋 식별자를 반드시 저장

---

## 2) Postgres 테이블(권장 최소)

### 2.1 `text_runs`
- 용도: run 기본 메타/상태
- 주요 컬럼:
  - `run_id` (pk)
  - `strategy_id`, `strategy_version`
  - `mode`
  - `market`, `timeframes`
  - `status` (`IDLE|RUNNING|PAUSED|DONE|ERROR`)
  - `started_at`, `ended_at`
  - `fill_model_requested`, `fill_model_applied`
  - `entry_policy` (jsonb)
  - `dataset_ref` (jsonb)

### 2.2 `text_run_configs`
- 용도: runConfig 스냅샷 보관
- 주요 컬럼:
  - `run_id` (fk -> text_runs)
  - `parameter_snapshot` (jsonb)
  - `risk_snapshot` (jsonb)
  - `fee_snapshot` (jsonb)
  - `slippage_assumed_pct`

### 2.3 `text_run_events`
- 용도: 핵심 이벤트 인덱스/검색
- 주요 컬럼:
  - `id` (pk)
  - `run_id` (fk)
  - `seq` (run 내부 순번)
  - `event_type` (`SIGNAL_EMIT`, `ORDER_INTENT`, `FILL`, `EXIT`, `SYSTEM_EVENT` ...)
  - `event_ts`
  - `payload` (jsonb)
- 인덱스:
  - `(run_id, seq)` unique
  - `(event_type, event_ts)`

### 2.4 `text_trades`
- 용도: 체결 기반 거래 결과 분석
- 주요 컬럼:
  - `trade_id` (pk)
  - `run_id` (fk)
  - `entry_ts`, `exit_ts`
  - `entry_price`, `exit_price`
  - `qty`, `notional_krw`
  - `exit_reason`
  - `gross_return_pct`, `net_return_pct`
  - `bars_delay`

### 2.5 `text_run_reports`
- 용도: 최종 요약 리포트
- 주요 컬럼:
  - `run_id` (pk/fk)
  - `kpi` (jsonb)
  - `exit_reason_breakdown` (jsonb)
  - `artifact_manifest` (jsonb)
  - `created_at`

### 2.6 `text_system_event_logs`
- 용도: 시스템 이슈 추적
- 주요 컬럼:
  - `id` (pk)
  - `run_id` (nullable fk)
  - `level`, `event_type`
  - `trace_id`, `source`
  - `message`
  - `payload` (jsonb)
  - `created_at`

---

## 3) Storage 버킷(권장)
- `run-artifacts`
  - 경로: `run-artifacts/<runId>/run_report.json`
  - 경로: `run-artifacts/<runId>/events.jsonl`
  - 경로: `run-artifacts/<runId>/text_trades.csv`
- `market-archive` (선택)
  - 재백테스트용 캔들/트레이드 스냅샷
  - 경로: `market-archive/<market>/<timeframe>/<yyyymm>.parquet|csv`

---

## 4) 실전 테스트 -> 재백테스트 루프
1. 실전 테스트 run 실행
2. `text_runs/text_run_configs/text_run_events/text_trades/text_run_reports` 저장
3. 손실 구간/이벤트 패턴 분석
4. 전략/파라미터 수정
5. 동일 데이터셋 식별자로 재백테스트 실행
6. runId 간 KPI/exit reason 비교

---

## 5) 타입/무결성 규칙
- API/WS DTO는 `packages/contracts`를 사용한다.
- `text_run_events.payload`는 eventType별 schema 검증 후 저장한다.
- `run_id + seq` unique로 중복 이벤트 저장 방지.
- 모든 시간값은 ISO-8601 또는 epoch(ms) 중 하나로 통일(프로젝트 전역 동일).

---

## 6) 운영/보안 규칙
- Supabase RLS:
  - 서비스키만 쓰기 권한(백엔드)
  - 대시보드 사용자 읽기 권한은 최소 범위로 제한
- 민감정보 마스킹:
  - API key, secret, auth header는 DB/Storage 저장 금지
- 보존 정책(권장):
  - `text_run_events` 원본 jsonl은 180일 이상 보관
  - 요약 테이블(`text_runs`, `text_run_reports`, `text_trades`)은 장기 보관

### 6.1 Supabase 권한 경계(필수)
- `service_role` 키는 `apps/api` 서버 전용(브라우저/프론트 주입 금지).
- 프론트는 `anon(publishable)` 키 + RLS 읽기 정책만 사용한다.
- 쓰기 작업은 API 서버를 통해서만 수행하며, 직접 테이블 write를 허용하지 않는다.

### 6.2 네트워크 장애 내성(필수)
- Supabase 쓰기/읽기는 모두 타임아웃 + 재시도(backoff+jitter)를 적용한다.
- 재시도 가능 범위는 멱등 작업으로 제한한다.
- `(run_id, seq)` unique 충돌은 `duplicate`로 처리하고 성공으로 간주(재전송 허용 설계).
- 일시 장애 시 임시 큐 적재 후 복구 시점에 순차 flush한다.
- flush 실패가 임계치를 넘으면 run을 `PAUSED`로 전환하고 `SYSTEM_EVENT`를 남긴다.

### 6.3 시퀀스 정합성 규칙
- `text_run_events`는 `last_persisted_seq` 체크포인트를 관리한다.
- `seq > last_persisted_seq + 1`이면 out-of-order로 기록하고 재동기화 절차를 실행한다.
- 재동기화 완료 전에는 해당 run을 `DEGRADED` 상태로 간주한다.

---

## 7) 구현 체크리스트
- [ ] `text_runs`, `text_run_configs`, `text_run_events`, `text_trades`, `text_run_reports`, `text_system_event_logs` 생성
- [ ] `run_id + seq` unique 인덱스 생성
- [ ] `run-artifacts` 버킷 정책 적용
- [ ] run 종료 시 `run_report.json` 업로드 + `artifact_manifest` 저장
- [ ] 재백테스트 시 dataset_ref 동일성 검증 로직 구현
- [ ] Supabase 호출 공통 래퍼(timeout/retry/catch) 구현
- [ ] 중복/역순 이벤트 처리(duplicate/out-of-order) 로직 구현
- [ ] 장애 시 임시 큐 flush 및 `PAUSED` 전환 임계치 설정
