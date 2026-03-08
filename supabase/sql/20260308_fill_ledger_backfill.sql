begin;

create table if not exists public.text_fills (
  id bigserial primary key,
  run_id text not null references public.text_runs(run_id) on delete cascade,
  seq bigint not null,
  event_ts timestamptz not null,
  trace_id text not null,
  side text not null check (side in ('BUY', 'SELL')),
  qty numeric(28,12) not null,
  fill_price numeric(20,8) not null,
  notional_krw numeric(20,2) not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (run_id, seq)
);

create index if not exists idx_fills_run_ts on public.text_fills (run_id, event_ts desc);
create index if not exists idx_fills_side_ts on public.text_fills (side, event_ts desc);

alter table public.text_fills enable row level security;

drop policy if exists fills_service_role_all on public.text_fills;
create policy fills_service_role_all on public.text_fills
for all to service_role using (true) with check (true);

drop policy if exists fills_authenticated_select on public.text_fills;
create policy fills_authenticated_select on public.text_fills
for select to authenticated using (true);

grant select, insert, update, delete on table public.text_fills to service_role;
grant usage, select on sequence public.text_fills_id_seq to service_role;

insert into public.text_fills (
  run_id,
  seq,
  event_ts,
  trace_id,
  side,
  qty,
  fill_price,
  notional_krw,
  payload
)
select
  e.run_id,
  e.seq,
  e.event_ts,
  concat('persisted-', e.run_id, '-', e.seq) as trace_id,
  upper(e.payload->>'side') as side,
  case
    when jsonb_typeof(e.payload->'qty') = 'number' and (e.payload->>'qty')::numeric > 0
      then (e.payload->>'qty')::numeric
    when jsonb_typeof(e.payload->'quantity') = 'number' and (e.payload->>'quantity')::numeric > 0
      then (e.payload->>'quantity')::numeric
    else 1::numeric
  end as qty,
  (e.payload->>'fillPrice')::numeric as fill_price,
  (
    case
      when jsonb_typeof(e.payload->'notionalKrw') = 'number' and (e.payload->>'notionalKrw')::numeric > 0
        then (e.payload->>'notionalKrw')::numeric
      else (
        (e.payload->>'fillPrice')::numeric * (
          case
            when jsonb_typeof(e.payload->'qty') = 'number' and (e.payload->>'qty')::numeric > 0
              then (e.payload->>'qty')::numeric
            when jsonb_typeof(e.payload->'quantity') = 'number' and (e.payload->>'quantity')::numeric > 0
              then (e.payload->>'quantity')::numeric
            else 1::numeric
          end
        )
      )
    end
  )::numeric(20,2) as notional_krw,
  e.payload
from public.text_run_events e
where e.event_type = 'FILL'
  and jsonb_typeof(e.payload->'side') = 'string'
  and jsonb_typeof(e.payload->'fillPrice') = 'number'
  and upper(e.payload->>'side') in ('BUY', 'SELL')
on conflict (run_id, seq) do nothing;

commit;
