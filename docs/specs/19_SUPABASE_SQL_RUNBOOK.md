# 19_SUPABASE_SQL_RUNBOOK.md
# Supabase 실행 SQL 런북 (실행용)

## 목적
- Supabase SQL Editor에서 바로 실행할 수 있는 쿼리 경로와 실행 순서를 제공한다.
- 스키마/인덱스/RLS를 한 번에 적용해 백엔드에서 즉시 `text_run_events` write가 가능하도록 만든다.

참조:
- 저장 전략: `17_SUPABASE_PERSISTENCE.md`
- SQL 초안: `18_SUPABASE_SQL_DRAFT.md`
- 실행 SQL 파일: `../../supabase/sql/20260305_supabase_init.sql`
- 호환 패치 파일(에러 대응): `../../supabase/sql/20260305_supabase_compat_patch.sql`

---

## 1) 실행 방법 (Supabase SQL Editor)
1. Supabase 프로젝트 -> SQL Editor 진입
2. 이전 스키마가 존재하거나 아래 오류가 발생한 경우:
   - `column "run_id" does not exist`
   - `column "entry_ts" does not exist`
   - `../../supabase/sql/20260305_supabase_compat_patch.sql` 먼저 실행
3. `../../supabase/sql/20260305_supabase_init.sql` 내용 전체 붙여넣기
4. `Run` 실행
5. 오류 없이 완료되면 아래 검증 쿼리 실행

---

## 2) 검증 쿼리
```sql
-- 테이블 존재 확인
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'text_runs',
    'text_run_configs',
    'text_run_events',
    'text_trades',
    'text_run_reports',
    'text_system_event_logs',
    'text_run_event_checkpoints',
    'text_dead_letter_events'
  )
order by table_name;

-- RLS 활성 확인
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in (
    'text_runs',
    'text_run_configs',
    'text_run_events',
    'text_trades',
    'text_run_reports',
    'text_system_event_logs',
    'text_run_event_checkpoints',
    'text_dead_letter_events'
  )
order by tablename;

-- unique(run_id, seq) 확인
select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'text_run_events'
  and indexdef ilike '%(run_id, seq)%';
```

---

## 3) 운영 주의사항
- 프론트에서는 `SUPABASE_PUBLISHABLE_KEY`만 사용한다.
- `SUPABASE_SECRET_KEY(service_role)`는 백엔드 서버에서만 사용한다.
- `text_run_events` write는 서버 API를 통해서만 수행한다.

---

## 4) 롤백 참고
초기 구축 단계에서는 드롭보다 "새 migration으로 수정"을 권장한다.
불가피한 경우에만 별도 롤백 SQL을 작성해 적용한다.

---

## 5) 서버 부팅 진단 로그(추가)
- API는 부팅 시 `text_run_events` 조회 권한을 자동 점검한다.
- 성공 로그: `Supabase diagnostics passed`
- 실패 로그: `Supabase diagnostics failed` + `status/code/message/hint`
- 이 로그가 실패이면 키/프로젝트/RLS를 먼저 점검한다.

---

## 6) Fill Ledger Rollout (ASCII appendix)
- Migration file:
  - `../../supabase/migrations/20260308010000_fill_ledger.sql`
- SQL file for manual editor use:
  - `../../supabase/sql/20260308_fill_ledger_backfill.sql`

### Rollout order
1. Apply the fill-ledger schema migration.
2. Verify that `public.text_fills` exists and RLS/policies were created.
3. Verify the historical backfill inserted valid legacy `FILL` rows.
4. Deploy the application code that reads persisted fills from `text_fills`.

### Verification queries
```sql
-- table exists
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name = 'text_fills';

-- RLS enabled
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename = 'text_fills';

-- unique(run_id, seq) index exists
select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'text_fills'
  and indexdef ilike '%(run_id, seq)%';

-- compare raw valid fill count vs ledger count
with raw_valid as (
  select count(*) as cnt
  from public.text_run_events
  where event_type = 'FILL'
    and jsonb_typeof(payload->'side') = 'string'
    and jsonb_typeof(payload->'fillPrice') = 'number'
    and upper(payload->>'side') in ('BUY', 'SELL')
)
select
  (select cnt from raw_valid) as raw_valid_fill_count,
  (select count(*) from public.text_fills) as fill_ledger_count;
```

### Notes
- The app currently keeps a fallback to `text_run_events` only for pre-migration environments.
- After the remote project finishes this rollout and stabilizes, the raw-event fallback can be removed in a later cleanup.
