-- Zenith v4 compatibility patch (table prefix: text_)
-- Purpose:
-- 1) rename legacy tables to text_*
-- 2) normalize camelCase columns to snake_case aliases used by current SQL

begin;

-- 0) rename legacy tables to text_* if needed

do $$
begin
  if to_regclass('public.runs') is not null and to_regclass('public.text_runs') is null then
    alter table public.runs rename to text_runs;
  end if;

  if to_regclass('public.run_configs') is not null and to_regclass('public.text_run_configs') is null then
    alter table public.run_configs rename to text_run_configs;
  end if;

  if to_regclass('public.run_events') is not null and to_regclass('public.text_run_events') is null then
    alter table public.run_events rename to text_run_events;
  end if;

  if to_regclass('public.trades') is not null and to_regclass('public.text_trades') is null then
    alter table public.trades rename to text_trades;
  end if;

  if to_regclass('public.run_reports') is not null and to_regclass('public.text_run_reports') is null then
    alter table public.run_reports rename to text_run_reports;
  end if;

  if to_regclass('public.system_event_logs') is not null and to_regclass('public.text_system_event_logs') is null then
    alter table public.system_event_logs rename to text_system_event_logs;
  end if;

  if to_regclass('public.run_event_checkpoints') is not null and to_regclass('public.text_run_event_checkpoints') is null then
    alter table public.run_event_checkpoints rename to text_run_event_checkpoints;
  end if;

  if to_regclass('public.dead_letter_events') is not null and to_regclass('public.text_dead_letter_events') is null then
    alter table public.dead_letter_events rename to text_dead_letter_events;
  end if;
end $$;

-- 1) run_id normalization for all text_* tables

do $$
begin
  -- text_run_events
  if to_regclass('public.text_run_events') is not null then
    if not exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='text_run_events' and column_name='run_id'
    ) then
      alter table public.text_run_events add column run_id text;
    end if;

    if exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='text_run_events' and column_name='runId'
    ) then
      execute 'update public.text_run_events set run_id = "runId" where run_id is null';
    end if;
  end if;

  -- text_run_configs
  if to_regclass('public.text_run_configs') is not null then
    if not exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='text_run_configs' and column_name='run_id'
    ) then
      alter table public.text_run_configs add column run_id text;
    end if;

    if exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='text_run_configs' and column_name='runId'
    ) then
      execute 'update public.text_run_configs set run_id = "runId" where run_id is null';
    end if;
  end if;

  -- text_trades
  if to_regclass('public.text_trades') is not null then
    if not exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='text_trades' and column_name='run_id'
    ) then
      alter table public.text_trades add column run_id text;
    end if;

    if exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='text_trades' and column_name='runId'
    ) then
      execute 'update public.text_trades set run_id = "runId" where run_id is null';
    end if;

    if not exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='text_trades' and column_name='entry_ts'
    ) then
      alter table public.text_trades add column entry_ts timestamptz;
    end if;
    if exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='text_trades' and column_name='entryTs'
    ) then
      execute 'update public.text_trades set entry_ts = "entryTs" where entry_ts is null';
    end if;

    if not exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='text_trades' and column_name='exit_ts'
    ) then
      alter table public.text_trades add column exit_ts timestamptz;
    end if;
    if exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='text_trades' and column_name='exitTs'
    ) then
      execute 'update public.text_trades set exit_ts = "exitTs" where exit_ts is null';
    end if;

    if not exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='text_trades' and column_name='entry_price'
    ) then
      alter table public.text_trades add column entry_price numeric(20,8);
    end if;
    if exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='text_trades' and column_name='entryPrice'
    ) then
      execute 'update public.text_trades set entry_price = "entryPrice" where entry_price is null';
    end if;

    if not exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='text_trades' and column_name='exit_price'
    ) then
      alter table public.text_trades add column exit_price numeric(20,8);
    end if;
    if exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='text_trades' and column_name='exitPrice'
    ) then
      execute 'update public.text_trades set exit_price = "exitPrice" where exit_price is null';
    end if;

    if not exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='text_trades' and column_name='notional_krw'
    ) then
      alter table public.text_trades add column notional_krw numeric(20,2);
    end if;
    if exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='text_trades' and column_name='notionalKrw'
    ) then
      execute 'update public.text_trades set notional_krw = "notionalKrw" where notional_krw is null';
    end if;

    if not exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='text_trades' and column_name='exit_reason'
    ) then
      alter table public.text_trades add column exit_reason text;
    end if;
    if exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='text_trades' and column_name='exitReason'
    ) then
      execute 'update public.text_trades set exit_reason = "exitReason" where exit_reason is null';
    end if;

    if not exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='text_trades' and column_name='gross_return_pct'
    ) then
      alter table public.text_trades add column gross_return_pct numeric(12,8);
    end if;
    if exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='text_trades' and column_name='grossReturnPct'
    ) then
      execute 'update public.text_trades set gross_return_pct = "grossReturnPct" where gross_return_pct is null';
    end if;

    if not exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='text_trades' and column_name='net_return_pct'
    ) then
      alter table public.text_trades add column net_return_pct numeric(12,8);
    end if;
    if exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='text_trades' and column_name='netReturnPct'
    ) then
      execute 'update public.text_trades set net_return_pct = "netReturnPct" where net_return_pct is null';
    end if;

    if not exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='text_trades' and column_name='bars_delay'
    ) then
      alter table public.text_trades add column bars_delay integer;
    end if;
    if exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='text_trades' and column_name='barsDelay'
    ) then
      execute 'update public.text_trades set bars_delay = "barsDelay" where bars_delay is null';
    end if;
  end if;

  -- text_run_reports
  if to_regclass('public.text_run_reports') is not null then
    if not exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='text_run_reports' and column_name='run_id'
    ) then
      alter table public.text_run_reports add column run_id text;
    end if;

    if exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='text_run_reports' and column_name='runId'
    ) then
      execute 'update public.text_run_reports set run_id = "runId" where run_id is null';
    end if;
  end if;

  -- text_system_event_logs
  if to_regclass('public.text_system_event_logs') is not null then
    if not exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='text_system_event_logs' and column_name='run_id'
    ) then
      alter table public.text_system_event_logs add column run_id text;
    end if;

    if exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='text_system_event_logs' and column_name='runId'
    ) then
      execute 'update public.text_system_event_logs set run_id = "runId" where run_id is null';
    end if;
  end if;

  -- text_run_event_checkpoints
  if to_regclass('public.text_run_event_checkpoints') is not null then
    if not exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='text_run_event_checkpoints' and column_name='run_id'
    ) then
      alter table public.text_run_event_checkpoints add column run_id text;
    end if;

    if exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='text_run_event_checkpoints' and column_name='runId'
    ) then
      execute 'update public.text_run_event_checkpoints set run_id = "runId" where run_id is null';
    end if;
  end if;

  -- text_dead_letter_events
  if to_regclass('public.text_dead_letter_events') is not null then
    if not exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='text_dead_letter_events' and column_name='run_id'
    ) then
      alter table public.text_dead_letter_events add column run_id text;
    end if;

    if exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='text_dead_letter_events' and column_name='runId'
    ) then
      execute 'update public.text_dead_letter_events set run_id = "runId" where run_id is null';
    end if;
  end if;
end $$;

-- 2) safe index creation after normalization

do $$
begin
  if to_regclass('public.text_run_events') is not null
     and exists (select 1 from information_schema.columns where table_schema='public' and table_name='text_run_events' and column_name='run_id')
     and exists (select 1 from information_schema.columns where table_schema='public' and table_name='text_run_events' and column_name='event_ts') then
    execute 'create index if not exists idx_text_run_events_run_ts on public.text_run_events (run_id, event_ts)';
  end if;

  if to_regclass('public.text_trades') is not null
     and exists (select 1 from information_schema.columns where table_schema='public' and table_name='text_trades' and column_name='run_id')
     and exists (select 1 from information_schema.columns where table_schema='public' and table_name='text_trades' and column_name='entry_ts') then
    execute 'create index if not exists idx_text_trades_run_entry on public.text_trades (run_id, entry_ts)';
  end if;
end $$;

-- ensure backend key can write text_* tables on existing projects
grant usage on schema public to service_role;
do $$
begin
  if to_regclass('public.text_runs') is not null then
    execute 'grant select, insert, update, delete on table public.text_runs to service_role';
  end if;
  if to_regclass('public.text_run_configs') is not null then
    execute 'grant select, insert, update, delete on table public.text_run_configs to service_role';
  end if;
  if to_regclass('public.text_run_events') is not null then
    execute 'grant select, insert, update, delete on table public.text_run_events to service_role';
  end if;
  if to_regclass('public.text_trades') is not null then
    execute 'grant select, insert, update, delete on table public.text_trades to service_role';
  end if;
  if to_regclass('public.text_run_reports') is not null then
    execute 'grant select, insert, update, delete on table public.text_run_reports to service_role';
  end if;
  if to_regclass('public.text_system_event_logs') is not null then
    execute 'grant select, insert, update, delete on table public.text_system_event_logs to service_role';
  end if;
  if to_regclass('public.text_run_event_checkpoints') is not null then
    execute 'grant select, insert, update, delete on table public.text_run_event_checkpoints to service_role';
  end if;
  if to_regclass('public.text_dead_letter_events') is not null then
    execute 'grant select, insert, update, delete on table public.text_dead_letter_events to service_role';
  end if;
  if to_regclass('public.text_run_events_id_seq') is not null then
    execute 'grant usage, select on sequence public.text_run_events_id_seq to service_role';
  end if;
  if to_regclass('public.text_system_event_logs_id_seq') is not null then
    execute 'grant usage, select on sequence public.text_system_event_logs_id_seq to service_role';
  end if;
  if to_regclass('public.text_dead_letter_events_id_seq') is not null then
    execute 'grant usage, select on sequence public.text_dead_letter_events_id_seq to service_role';
  end if;
end $$;

commit;
