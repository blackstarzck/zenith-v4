# 39_DATASET_REF_PLAN_2026-03-09.md

## Goal
- Introduce one durable `dataset_ref` snapshot per run so replay/backtest runs can prove dataset equality and benchmark comparison can distinguish provisional matches from exact matches.

## Scope
- Contracts
- Supabase persistence
- Run report generation
- Benchmark comparison

## Non-Goals
- Implementing a replay/backtest engine
- Normalizing the `STRAT_B` benchmark source
- Executing live runtime E2E

## Inputs / Outputs
- Inputs:
  - run shell metadata in `text_runs`
  - runtime run config and generated `run_report.json`
  - benchmark profile from strategy docs
- Outputs:
  - persisted `text_runs.dataset_ref`
  - `RunConfigDto.datasetRef`
  - `RunReportDto.dataset.datasetRef`
  - benchmark compare `docClaimEligible` based on exact dataset equality

## Sequence
1. Add `DatasetRefDto` to contracts and expose it through run DTOs.
2. Persist/restore `dataset_ref` in `text_runs` with legacy column fallback.
3. Generate default runtime dataset references and allow exact replay/backtest overrides.
4. Use dataset equality checks in `/reports/benchmark-compare`.
5. Update tests and docs.

## Verification
- `npm.cmd --prefix apps/api test`
- `npm.cmd run typecheck:api`
- `.\node_modules\.bin\tsc.cmd -p packages/contracts/tsconfig.json`
- `npm.cmd run typecheck:web`
- `npm.cmd --prefix apps/web run build`
- `git diff --check`
- touched-file mojibake scan

## Risks
- Existing environments may still lack the `dataset_ref` column.
- Default live/runtime dataset refs are inherently non-exact and must not be treated as replay-equivalent.
- Benchmark status must remain readable while `docClaimEligible` becomes stricter.
