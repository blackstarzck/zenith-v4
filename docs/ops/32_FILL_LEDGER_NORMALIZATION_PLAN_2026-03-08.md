# 32_FILL_LEDGER_NORMALIZATION_PLAN_2026-03-08

## Goal
- Split persisted trade fills from the raw event log so the fill table and account summary no longer depend on filtering `text_run_events`.

## Scope
- add a normalized `text_fills` ledger table to the Supabase bootstrap/schema docs
- persist valid `FILL` events into `text_fills` while keeping `text_run_events` as the raw event log
- switch persisted fill reads for strategy fill history and account summary to `text_fills`
- keep the external fill API shape as `WsEventEnvelopeDto` so the web client does not need a contract change
- sync architecture, persistence, SQL, and experiment docs

## Acceptance
1. `safeInsertRunEvent` persists a raw run event and, when valid, a normalized fill ledger row in the same retryable operation.
2. A partial failure where `text_run_events` already contains the row must still allow the retry path to insert the missing `text_fills` row.
3. `RunsService` strategy fill history and account summary use persisted rows from `text_fills` plus runtime-retained fills.
4. The raw event log remains available for run history/debugging without being the persisted source of truth for fill history.
