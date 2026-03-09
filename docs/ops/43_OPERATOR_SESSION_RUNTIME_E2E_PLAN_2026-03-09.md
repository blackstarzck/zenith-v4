# 43_OPERATOR_SESSION_RUNTIME_E2E_PLAN_2026-03-09.md

## Goal
- Close the remaining runtime E2E work by validating:
  - Scenario B: STRAT_B SEMI_AUTO approval in an operator session
  - Scenario C: operator-visible risk block or live guard block flow

## Scope
- Runtime engine behavior under real Upbit data
- Operator control path from `/runs/live` to `POST /runs/:runId/actions/approve`
- Observability and persistence proof via `/ops/metrics`, `/runs/:runId`, `events.jsonl`

## Non-Goals
- No strategy logic redesign
- No benchmark/KPI recalibration
- No persistence schema change unless a blocker is found during the live session

## Inputs And Outputs
- Inputs:
  - root `.env`
  - `RUN_MODE`, `ALLOW_LIVE_TRADING`, `RISK_*`, optional `E2E_FORCE_SEMI_AUTO_SIGNAL`
  - Upbit websocket feed
- Outputs:
  - updated runtime E2E findings in `docs/ops/22A_RUNTIME_E2E_ADDENDUM_2026-03-09.md`
  - updated remaining-work note if B/C close

## Execution Order
1. Reconfirm env loading and the current operator control path.
2. Start API/Web in a SEMI_AUTO session and attempt Scenario B with the live UI or the exact approval API path used by the UI.
3. Start a risk-constrained session for Scenario C and capture the first confirmed block event plus the resulting `PAUSE`.
4. If the documented E2E forcing path is not wired in code, stop, report the mismatch, and re-plan before editing.
5. Record concrete evidence: run IDs, seq deltas, event types, metrics deltas, timestamps.

## Verification
- `/ops/metrics`
- `/runs/run-strat-b-0001`
- `/runs/run-strat-c-0001`
- `/runs/:runId/events.jsonl`
- local `/runs/live` session

## Risks
- `E2E_FORCE_SEMI_AUTO_SIGNAL` was initially unwired and had to be fixed before Scenario B/C could be closed.
- Fixed run IDs may restore previous persisted events, so scenario checks must use before/after deltas.
- Live market timing can delay signal formation, especially for STRAT_B.

## Outcome
- Completed on `2026-03-09`.
- Scenario B passed after wiring the deterministic STRAT_B force path and re-syncing restored run shells to the current env session.
- Scenario C passed with `RISK_MAX_DAILY_ORDERS=0`, producing `RISK_BLOCK -> PAUSE` and no fill after operator approval.
