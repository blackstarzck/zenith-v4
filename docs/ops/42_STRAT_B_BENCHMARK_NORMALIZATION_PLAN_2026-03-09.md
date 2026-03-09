# 42_STRAT_B_BENCHMARK_NORMALIZATION_PLAN_2026-03-09.md

## Goal
- Convert the user-provided STRAT_B backtest CSV into a normalized benchmark profile so `/reports/benchmark-compare` can evaluate STRAT_B with KPI targets instead of leaving it blocked.

## Scope
- Benchmark profile source data
- Benchmark compare regression tests
- Ops/spec documentation

## Inputs
- `C:\Users\chanki\Downloads\xrp_ob_fvg_backtest_trades_202602.csv`
- existing STRAT_B rule-intent notes

## Outputs
- `benchmarkAvailable=true` for STRAT_B
- CSV-derived KPI targets:
  - trade count
  - win rate
  - average trade return %
  - MDD %
- updated docs that record the source and remaining operational work

## Sequence
1. Derive KPI values and fee assumption from the CSV.
2. Replace the blocked STRAT_B benchmark profile with the normalized benchmark row.
3. Replace the old `BLOCKED` regression with a real STRAT_B benchmark compare regression.
4. Update handoff/validation docs to show STRAT_B benchmark is unblocked.

## Verification
- `npm.cmd --prefix apps/api test`
- `npm.cmd run typecheck:api`
- `git diff --check`
- touched-file mojibake scan

## Risks
- The CSV does not explicitly encode run mode or fill policy, so execution constraints must stay within the documented STRAT_B implementation envelope.
- The benchmark source is a backtest artifact, so exact document equivalence still requires a replay/backtest run with `dataset_ref.exact=true`.
