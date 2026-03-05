-- Zenith v4: initial persistence schema for run-based strategy testing
-- Source docs:
-- - 17_SUPABASE_PERSISTENCE.md
-- - 18_SUPABASE_SQL_DRAFT.md

begin;

create extension if not exists pgcrypto;

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
end $$;

create table if not exists public.text_runs (
  run_id text primary key,
  strategy_id strategy_id not null,
  strategy_version text not null,
  mode run_mode not null,
  market text not null,
  timeframes text[] not null default '{}',
  status run_status not null default 'IDLE',
  started_at timestamptz,
  ended_at timestamptz,
  fill_model_requested text not null,
  fill_model_applied fill_model,
  entry_policy jsonb not null default '{}'::jsonb,
  dataset_ref jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_runs_strategy_time
  on public.text_runs (strategy_id, created_at desc);
create index if not exists idx_runs_status
  on public.text_runs (status);

create table if not exists public.text_run_configs (
  id uuid primary key default gen_random_uuid(),
  run_id text not null references public.text_runs(run_id) on delete cascade,
  parameter_snapshot jsonb not null,
  risk_snapshot jsonb not null,
  fee_snapshot jsonb not null,
  slippage_assumed_pct numeric(10,8) not null default 0,
  created_at timestamptz not null default now(),
  unique (run_id)
);

create table if not exists public.text_run_events (
  id bigserial primary key,
  run_id text not null references public.text_runs(run_id) on delete cascade,
  seq bigint not null,
  event_type text not null,
  event_ts timestamptz not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (run_id, seq)
);

create index if not exists idx_run_events_run_ts
  on public.text_run_events (run_id, event_ts);
create index if not exists idx_run_events_type_ts
  on public.text_run_events (event_type, event_ts desc);

create table if not exists public.text_trades (
  trade_id text primary key,
  run_id text not null references public.text_runs(run_id) on delete cascade,
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
  on public.text_trades (run_id, entry_ts);
create index if not exists idx_trades_run_exit_reason
  on public.text_trades (run_id, exit_reason);

create table if not exists public.text_run_reports (
  run_id text primary key references public.text_runs(run_id) on delete cascade,
  kpi jsonb not null default '{}'::jsonb,
  exit_reason_breakdown jsonb not null default '{}'::jsonb,
  artifact_manifest jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.text_system_event_logs (
  id bigserial primary key,
  run_id text references public.text_runs(run_id) on delete set null,
  level text not null check (level in ('DEBUG','INFO','WARN','ERROR','FATAL')),
  event_type text not null,
  trace_id text not null,
  source text not null,
  message text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_system_event_logs_level_ts
  on public.text_system_event_logs (level, created_at desc);
create index if not exists idx_system_event_logs_type_ts
  on public.text_system_event_logs (event_type, created_at desc);
create index if not exists idx_system_event_logs_run_ts
  on public.text_system_event_logs (run_id, created_at desc);

create table if not exists public.text_run_event_checkpoints (
  run_id text primary key references public.text_runs(run_id) on delete cascade,
  last_persisted_seq bigint not null default 0,
  updated_at timestamptz not null default now(),
  check (last_persisted_seq >= 0)
);

create table if not exists public.text_dead_letter_events (
  id bigserial primary key,
  run_id text references public.text_runs(run_id) on delete set null,
  seq bigint,
  event_type text,
  payload jsonb not null default '{}'::jsonb,
  reason text not null,
  trace_id text,
  created_at timestamptz not null default now()
);

create index if not exists idx_dead_letter_events_run_ts
  on public.text_dead_letter_events (run_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_runs_updated_at on public.text_runs;
create trigger trg_runs_updated_at
before update on public.text_runs
for each row execute function public.set_updated_at();

alter table public.text_runs enable row level security;
alter table public.text_run_configs enable row level security;
alter table public.text_run_events enable row level security;
alter table public.text_trades enable row level security;
alter table public.text_run_reports enable row level security;
alter table public.text_system_event_logs enable row level security;
alter table public.text_run_event_checkpoints enable row level security;
alter table public.text_dead_letter_events enable row level security;

-- Service role full access (backend writes/reads)
drop policy if exists runs_service_role_all on public.text_runs;
create policy runs_service_role_all on public.text_runs
for all to service_role
using (true)
with check (true);

drop policy if exists run_configs_service_role_all on public.text_run_configs;
create policy run_configs_service_role_all on public.text_run_configs
for all to service_role
using (true)
with check (true);

drop policy if exists run_events_service_role_all on public.text_run_events;
create policy run_events_service_role_all on public.text_run_events
for all to service_role
using (true)
with check (true);

drop policy if exists trades_service_role_all on public.text_trades;
create policy trades_service_role_all on public.text_trades
for all to service_role
using (true)
with check (true);

drop policy if exists run_reports_service_role_all on public.text_run_reports;
create policy run_reports_service_role_all on public.text_run_reports
for all to service_role
using (true)
with check (true);

drop policy if exists system_event_logs_service_role_all on public.text_system_event_logs;
create policy system_event_logs_service_role_all on public.text_system_event_logs
for all to service_role
using (true)
with check (true);

drop policy if exists run_event_checkpoints_service_role_all on public.text_run_event_checkpoints;
create policy run_event_checkpoints_service_role_all on public.text_run_event_checkpoints
for all to service_role
using (true)
with check (true);

drop policy if exists dead_letter_events_service_role_all on public.text_dead_letter_events;
create policy dead_letter_events_service_role_all on public.text_dead_letter_events
for all to service_role
using (true)
with check (true);

-- Optional read policies for authenticated dashboard users
drop policy if exists runs_authenticated_select on public.text_runs;
create policy runs_authenticated_select on public.text_runs
for select to authenticated
using (true);

drop policy if exists trades_authenticated_select on public.text_trades;
create policy trades_authenticated_select on public.text_trades
for select to authenticated
using (true);

drop policy if exists run_reports_authenticated_select on public.text_run_reports;
create policy run_reports_authenticated_select on public.text_run_reports
for select to authenticated
using (true);

-- grants for backend key based writes
grant usage on schema public to service_role;
grant select, insert, update, delete on table public.text_runs to service_role;
grant select, insert, update, delete on table public.text_run_configs to service_role;
grant select, insert, update, delete on table public.text_run_events to service_role;
grant select, insert, update, delete on table public.text_trades to service_role;
grant select, insert, update, delete on table public.text_run_reports to service_role;
grant select, insert, update, delete on table public.text_system_event_logs to service_role;
grant select, insert, update, delete on table public.text_run_event_checkpoints to service_role;
grant select, insert, update, delete on table public.text_dead_letter_events to service_role;
grant usage, select on sequence public.text_run_events_id_seq to service_role;
grant usage, select on sequence public.text_system_event_logs_id_seq to service_role;
grant usage, select on sequence public.text_dead_letter_events_id_seq to service_role;

commit;
