# 18_SUPABASE_SQL_DRAFT.md
# Supabase SQL 스키마 초안 (Postgres)

## 목적
- `17_SUPABASE_PERSISTENCE.md`의 데이터 모델을 바로 구현 가능한 SQL 형태로 제공한다.
- 실전 테스트/재백테스트 루프에서 필요한 무결성(재현성, 이벤트 순서, 추적성)을 DB 레벨에서 보장한다.

참조:
- 저장 전략: `17_SUPABASE_PERSISTENCE.md`
- 엔진 계약: `../architecture/06_ARCHITECTURE.md`
- contracts 표준: `14_CONTRACTS_SPEC.md`
- 실행 런북: `19_SUPABASE_SQL_RUNBOOK.md`

---

## 1) 전제
- 스키마: `public`
- 시간 컬럼: `timestamptz`(UTC 저장 권장)
- JSON payload: `jsonb`
- UUID 생성: `gen_random_uuid()` 사용(`pgcrypto` 확장)

```sql
create extension if not exists pgcrypto;
```

---

## 2) Enum 타입(권장)
```sql
do $$
begin
  if not exists (select 1 from pg_type where typname = 'run_mode') then
    create type run_mode as enum ('PAPER', 'SEMI_AUTO', 'AUTO', 'LIVE');
  end if;
  if not exists (select 1 from pg_type where typname = 'run_status') then
    create type run_status as enum ('IDLE', 'RUNNING', 'PAUSED', 'STOPPING', 'DONE', 'ERROR');
  end if;
  if not exists (select 1 from pg_type where typname = 'strategy_id') then
    create type strategy_id as enum ('STRAT_A', 'STRAT_B', 'STRAT_C');
  end if;
  if not exists (select 1 from pg_type where typname = 'fill_model') then
    create type fill_model as enum ('NEXT_OPEN', 'ON_CLOSE', 'NEXT_MINUTE_OPEN', 'INTRABAR_APPROX');
  end if;
  if not exists (select 1 from pg_type where typname = 'fee_mode') then
    create type fee_mode as enum ('PER_SIDE', 'ROUNDTRIP');
  end if;
end$$;
```

---

## 3) 핵심 테이블 DDL

### 3.1 `text_runs`
```sql
create table if not exists text_runs (
  run_id text primary key,
  strategy_id strategy_id not null,
  strategy_version text not null,
  mode run_mode not null,
  market text not null,
  timeframes text[] not null default '{}',
  status run_status not null default 'IDLE',
  started_at timestamptz,
  ended_at timestamptz,
  fill_model_requested text not null, -- AUTO 또는 명시 모델
  fill_model_applied fill_model,
  entry_policy jsonb not null default '{}'::jsonb, -- 최소 { "key": "<canonical entryPolicy>" }
  dataset_ref jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_runs_strategy_time
  on text_runs (strategy_id, created_at desc);
create index if not exists idx_runs_status
  on text_runs (status);
```

- 앱은 `entry_policy`를 우선 조회/갱신하되, 구버전 배포 환경에서 컬럼이 아직 없을 수 있으므로 legacy select/update fallback을 유지한다.

### 3.2 `text_run_configs`
```sql
create table if not exists text_run_configs (
  id uuid primary key default gen_random_uuid(),
  run_id text not null references text_runs(run_id) on delete cascade,
  parameter_snapshot jsonb not null,
  risk_snapshot jsonb not null,
  fee_snapshot jsonb not null,
  slippage_assumed_pct numeric(10,8) not null default 0,
  created_at timestamptz not null default now(),
  unique (run_id)
);
```

### 3.3 `text_run_events`
```sql
create table if not exists text_run_events (
  id bigserial primary key,
  run_id text not null references text_runs(run_id) on delete cascade,
  seq bigint not null,
  event_type text not null,
  event_ts timestamptz not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (run_id, seq)
);

create index if not exists idx_run_events_run_ts
  on text_run_events (run_id, event_ts);
create index if not exists idx_run_events_type_ts
  on text_run_events (event_type, event_ts desc);
```

### 3.4 `text_trades`
```sql
create table if not exists text_trades (
  trade_id text primary key,
  run_id text not null references text_runs(run_id) on delete cascade,
  entry_ts timestamptz not null,
  exit_ts timestamptz,
  entry_price numeric(20,8) not null,
  exit_price numeric(20,8),
  qty numeric(28,12) not null,
  notional_krw numeric(20,2) not null,
  exit_reason text,
  gross_return_pct numeric(12,8),
  net_return_pct numeric(12,8),
  bars_delay integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_trades_run_entry
  on text_trades (run_id, entry_ts);
create index if not exists idx_trades_run_exit_reason
  on text_trades (run_id, exit_reason);
```

### 3.5 `text_run_reports`
```sql
create table if not exists text_run_reports (
  run_id text primary key references text_runs(run_id) on delete cascade,
  kpi jsonb not null default '{}'::jsonb,
  exit_reason_breakdown jsonb not null default '{}'::jsonb,
  artifact_manifest jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
```

### 3.6 `text_system_event_logs`
```sql
create table if not exists text_system_event_logs (
  id bigserial primary key,
  run_id text references text_runs(run_id) on delete set null,
  level text not null check (level in ('DEBUG','INFO','WARN','ERROR','FATAL')),
  event_type text not null,
  trace_id text not null,
  source text not null,
  message text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_system_event_logs_level_ts
  on text_system_event_logs (level, created_at desc);
create index if not exists idx_system_event_logs_type_ts
  on text_system_event_logs (event_type, created_at desc);
create index if not exists idx_system_event_logs_run_ts
  on text_system_event_logs (run_id, created_at desc);
```

### 3.7 `text_run_event_checkpoints` (권장)
```sql
create table if not exists text_run_event_checkpoints (
  run_id text primary key references text_runs(run_id) on delete cascade,
  last_persisted_seq bigint not null default 0,
  updated_at timestamptz not null default now(),
  check (last_persisted_seq >= 0)
);
```

### 3.8 `text_dead_letter_events` (권장)
```sql
create table if not exists text_dead_letter_events (
  id bigserial primary key,
  run_id text references text_runs(run_id) on delete set null,
  seq bigint,
  event_type text,
  payload jsonb not null default '{}'::jsonb,
  reason text not null,
  trace_id text,
  created_at timestamptz not null default now()
);

create index if not exists idx_dead_letter_events_run_ts
  on text_dead_letter_events (run_id, created_at desc);
```

---

## 4) 무결성 보조 트리거(권장)
```sql
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_runs_updated_at on text_runs;
create trigger trg_runs_updated_at
before update on text_runs
for each row execute function set_updated_at();
```

---

## 5) RLS 초안(요지)
- 기본: 백엔드 서비스 키만 쓰기/수정 허용
- 읽기 정책:
  - 운영 대시보드 사용자에게 `text_runs`, `text_run_reports`, `text_trades` 읽기 제한 허용
  - `text_run_events`, `text_system_event_logs`는 최소 권한(운영자 역할만)

```sql
alter table text_runs enable row level security;
alter table text_run_configs enable row level security;
alter table text_run_events enable row level security;
alter table text_trades enable row level security;
alter table text_run_reports enable row level security;
alter table text_system_event_logs enable row level security;
alter table text_run_event_checkpoints enable row level security;
alter table text_dead_letter_events enable row level security;
```

정책은 프로젝트 인증 설계(역할/tenant)에 맞춰 별도 정의한다.

예시(초안):
```sql
-- 쓰기: service_role만 허용
create policy runs_service_write on text_runs
for all to service_role
using (true)
with check (true);

-- 읽기: 인증 사용자(대시보드) 조회 허용 예시
create policy runs_auth_read on text_runs
for select to authenticated
using (true);
```

---

## 6) Storage 버킷 메모
- `run-artifacts` (private)
  - `run-artifacts/<runId>/run_report.json`
  - `run-artifacts/<runId>/events.jsonl`
  - `run-artifacts/<runId>/text_trades.csv`
- `market-archive` (private, 선택)
  - 재백테스트 입력 데이터 스냅샷 보관

---

## 7) 적용 순서
1. enum/type 생성
2. table/index 생성
3. trigger 적용
4. RLS 활성화 + 정책 추가
5. checkpoint/dead-letter 테이블 추가(선택)
6. 백엔드 repository/DTO 연결
7. run 저장 E2E 테스트 수행(중복/역순/타임아웃 케이스 포함)

# Fill ledger SQL addendum (ASCII appendix)
```sql
create table if not exists text_fills (
  id bigserial primary key,
  run_id text not null references text_runs(run_id) on delete cascade,
  seq bigint not null,
  event_ts timestamptz not null,
  trace_id text not null,
  side text not null check (side in ('BUY', 'SELL')),
  qty numeric(28,12) not null,
  fill_price numeric(20,8) not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (run_id, seq)
);

create index if not exists idx_fills_run_ts
  on text_fills (run_id, event_ts desc);
create index if not exists idx_fills_side_ts
  on text_fills (side, event_ts desc);
```

- Backfill for existing environments should insert valid legacy `FILL` rows from `text_run_events` into `text_fills` with `on conflict (run_id, seq) do nothing`.
- Deploy order: schema first, backfill second, app read-path switch last.

# Run artifact storage upload addendum (ASCII appendix)
- Runtime artifact upload path now targets the existing private Storage bucket:
  - `run-artifacts/<runId>/run_report.json`
  - `run-artifacts/<runId>/trades.csv`
  - `run-artifacts/<runId>/events.jsonl`
- The DB schema does not need a new table for this step because `text_run_reports.artifact_manifest` already stores the logical artifact paths.
- Remaining DB-side work is still `dataset_ref` persistence in `text_runs`.
