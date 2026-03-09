# 36_STRATEGY_DOC_VALIDATION_WORKFLOW_2026-03-08.md

## Purpose
- Lock one repeatable validation path from the user-provided strategy documents to replay/backtest artifacts.
- Prevent future "doc win rate" claims from being compared against runs that used different fill timing, fee rules, or datasets.

## Source Documents
- `C:\Users\chanki\Downloads\strat_a_win_rate_90.txt`
- `C:\Users\chanki\Downloads\strat_c_win_rate_56.txt`
- `C:\Users\chanki\Downloads\xrp_ob_fvg_backtest_trades_202602.csv`
- `C:\Users\chanki\Downloads\codex_analysis_on_dfference_between_start_docs_and_real_codes.txt`

## Benchmarks To Preserve
- `STRAT_A`
  - Source text states: `KRW-XRP`, `15m`, `2026-02`, fee `0.05%/side`
  - Source text states: win rate `90%`
  - Source text states: average profit `+1.009%`
  - Source text states: MDD `-0.405%`
- `STRAT_C`
  - Source text states: `KRW-XRP`, `2026-02`
  - Source text states: win rate `56.25%`
  - The OCR text appears to mention `32` trades; treat that as an inference until the original source is normalized.
- `STRAT_B`
  - Source CSV covers `KRW-XRP`, `2026-02`, and the OB+FVG trend pullback benchmark run used for the STRAT_B profile.
  - Derived benchmark row: `11` trades, win rate `54.5455%`, average trade return `+0.5685%`, MDD `-4.697%`.
  - Fee assumption is `0.05%/side` with `0%` slippage, inferred from the CSV's consistent `0.1%` round-trip gap between gross and net return columns.

## Required Validation Inputs
- Exact `runConfig` snapshot:
  - `strategyId`
  - `strategyVersion`
  - `mode`
  - `entryPolicy`
  - `fillModelRequested`
  - `fillModelApplied`
  - fee/slippage/risk inputs
- Exact dataset identity:
  - market
  - timeframe set
  - start/end time
  - persisted `dataset_ref`
- Exact output artifacts:
  - `run_report.json`
  - `trades.csv`
  - `events.jsonl`
  - persisted `text_trades`
  - persisted `text_run_reports`

## Validation Loop
1. Normalize the target document into one benchmark row per strategy/version/dataset.
2. Run replay/backtest with the same market, timeframe, date window, fill policy, and fee/slippage assumptions.
3. Persist the resulting `run_report.json`, `trades.csv`, and `events.jsonl`.
4. Compare the generated run against the benchmark row.
5. Record the gap as one of:
   - `MATCHED`
   - `DATASET_MISMATCH`
   - `EXECUTION_POLICY_MISMATCH`
   - `PARAMETER_MISMATCH`
   - `RULE_IMPLEMENTATION_GAP`
6. Only claim "matched the document" when steps 2-5 all pass on the same dataset and execution policy.

## Strategy-Specific Gates
- `STRAT_A`
  - Confirmed entry must remain `next-open` or `on-close` exactly as the benchmark run used.
  - Fee/slippage-adjusted round-trip KPI must be used for the comparison.
- `STRAT_B`
  - Validation must keep the `KRW-XRP`, `15m+1h`, `2026-02` dataset profile that produced the benchmark CSV.
  - Benchmark runs must keep `fee=0.05%/side`, `slippage=0%`, and one of the documented confirm-entry policies (`B_POI_TOUCH_CONFIRM_NEXT_OPEN` or `B_POI_TOUCH_CONFIRM_ON_CLOSE`).
  - Runtime regression coverage is still required for bull mode, zone lifetime, approval path, and exit sequencing.
- `STRAT_C`
  - Validation must use `trade + ticker + orderbook`-derived signals when benchmarking the document profile.
  - Fixed `ORDER_KRW`, next-minute open entry, cooldown, and pause rules must match the benchmark config.

## Current Repo Status On 2026-03-09
- `text_trades` and `text_run_reports` are now persisted from generated run reports.
- `run_report.json`, `trades.csv`, and `events.jsonl` are now uploaded best-effort into `run-artifacts/<runId>/...`.
- `/reports/compare` now prefers persisted run-report KPI when available.
- `/reports/benchmark-compare` now emits per-strategy `MATCHED|...|BLOCKED` status using persisted run reports plus benchmark-profile checks.
- Shared run-control rules and overlay payload extraction now live in `packages/contracts/src/run/run-control-rules.ts`.
- `dataset_ref` is now persisted through `text_runs`, run DTOs, and `run_report.json`.
- Benchmark comparison now separates provisional `MATCHED` from exact `docClaimEligible=true` using `dataset_ref`.

## Next Validation Tasks
1. Complete the remaining operator-session runtime E2E scenarios using `docs/ops/22A_RUNTIME_E2E_ADDENDUM_2026-03-09.md`.
