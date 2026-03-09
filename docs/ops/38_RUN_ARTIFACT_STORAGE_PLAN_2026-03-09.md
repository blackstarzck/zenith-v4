# 38_RUN_ARTIFACT_STORAGE_PLAN_2026-03-09.md

## Goal
- Persist generated `run_report.json`, `trades.csv`, and `events.jsonl` into Supabase Storage under `run-artifacts/<runId>/...` without breaking the existing DB summary sync path.

## Scope
- Persistence/contracts
- Network/resilience
- Report artifact generation

## Inputs / Outputs
- Inputs:
  - accepted runtime events for one `runId`
  - generated `RunReportDto`
  - generated `trades.csv`
  - generated `events.jsonl`
- Outputs:
  - `text_trades`
  - `text_run_reports`
  - Storage objects:
    - `run-artifacts/<runId>/run_report.json`
    - `run-artifacts/<runId>/trades.csv`
    - `run-artifacts/<runId>/events.jsonl`

## Change Order
1. Add a Supabase Storage upload wrapper beside the existing REST client.
2. Extend artifact sync so DB rows and Storage objects are written in one service boundary.
3. Update `RunsService.getRunReport()` to pass all artifact bodies in one call.
4. Update tests for DB + Storage sync behavior and artifact path expectations.
5. Sync affected markdown docs and remaining-work notes.

## Verification
- `npm.cmd --prefix apps/api test`
- `npm.cmd run typecheck:api`
- `npm.cmd run typecheck:web`
- `.\node_modules\.bin\tsc.cmd -p packages/contracts/tsconfig.json`
- `npm.cmd --prefix apps/web run build`
- `git diff --check`
- touched-file mojibake scan

## Risks
- Storage upload failure must not prevent report generation or DB summary persistence.
- Artifact manifest paths must stay consistent with the exported filenames.
- Existing compare/report endpoints must continue to read persisted summaries even if Storage is temporarily unavailable.
