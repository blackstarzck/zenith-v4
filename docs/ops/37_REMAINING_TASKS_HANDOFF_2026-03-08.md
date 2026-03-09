# 37_REMAINING_TASKS_HANDOFF_2026-03-08.md

## Status
- Required runtime validation work from the 2026-03-08 rebuild is now closed.

## Remaining Work
- No required remaining work at this handoff point.
- Reference evidence: `docs/ops/22A_RUNTIME_E2E_ADDENDUM_2026-03-09.md`

## New Validation Workflow
- Use `docs/ops/36_STRATEGY_DOC_VALIDATION_WORKFLOW_2026-03-08.md` for all future "does the code match the strategy document?" checks.

## What Is Already Done
- STRAT_B benchmark normalization from the user-provided `xrp_ob_fvg_backtest_trades_202602.csv`
- `text_trades` and `text_run_reports` persistence
- `dataset_ref` persistence in `text_runs`, run DTOs, and generated `run_report.json`
- Supabase Storage upload of `run_report.json`, `trades.csv`, and `events.jsonl`
- persisted-report-aware `/reports/compare`
- `/reports/benchmark-compare` with benchmark status classification, exact dataset equality checks, and provisional-match guard
- runtime E2E scenarios A/B/C/D/E executed on March 9, 2026 and recorded in `docs/ops/22A_RUNTIME_E2E_ADDENDUM_2026-03-09.md`
- deterministic STRAT_B SEMI_AUTO forcing and startup run-shell re-sync for fixed run IDs
- shared run-control rules SSOT in `packages/contracts/src/run/run-control-rules.ts`
- regression tests for run artifact sync, Storage upload, dataset_ref fallback, benchmark comparison, and shared run-control rules
