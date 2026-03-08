# Runtime Mode State Machine Plan (2026-03-07)

## Goal
- Make `PAPER`, `AUTO`, `SEMI_AUTO`, and `LIVE` entry handling explicit through a dedicated runtime mode state machine.
- Remove mode-specific branching from `strategy-runtime-processor.ts` where possible without changing runtime behavior.

## Why
- The current processor still embeds mode branches inline.
- Approval waiting, approval execution, and direct entry handling are high-risk realtime behaviors and should be readable as explicit transitions.
- The project priority is sequence correctness first, then realtime-safe modularization.

## Scope
- Backend execution engine
- Runtime strategy state
- Closed-candle runtime transition logic
- Backend tests
- Architecture and experiment docs

## Non-Goals
- No websocket recovery refactor in this step
- No DB or persistence redesign in this step
- No strategy algorithm change in this step
- No UI change in this step

## Inputs / Outputs
- Inputs:
  - runtime mode
  - current runtime lifecycle state
  - approval availability
  - strategy evaluation result
- Outputs:
  - explicit lifecycle transition
  - approval request vs direct entry routing
  - unchanged canonical execution event emission

## Affected Files
- `apps/api/src/modules/execution/engine/strategy-runtime-state.ts`
- new mode-machine helper under `apps/api/src/modules/execution/engine/`
- `apps/api/src/modules/execution/engine/strategy-runtime-processor.ts`
- backend tests for runtime processor and new mode-machine helper
- related markdown docs

## Planned Changes
1. Add a runtime lifecycle state model for `FLAT`, `WAITING_APPROVAL`, and `IN_POSITION`.
2. Add a pure mode-machine module that resolves mode-specific transitions.
3. Route `SEMI_AUTO` approval wait/execute and direct-entry modes through the new state machine.
4. Add tests for explicit transitions and update processor tests to assert lifecycle behavior.
5. Update docs so the mode-transition source of truth is explicit.

## Verification
- `npm.cmd --workspace @zenith/api run typecheck`
- `npm.cmd --workspace @zenith/api test`
- Manual review of these mode paths:
  - `SEMI_AUTO` signal -> approval wait -> approved next-open entry
  - `PAPER/AUTO/LIVE` entry intent -> direct guarded execution
  - lifecycle sync after exit and after pending approval changes

## Risks
- Lifecycle state can drift from `strategyState` if sync logic is incomplete.
- `SEMI_AUTO` approval requests can double-fire if transition guards are wrong.
- `LIVE` and `AUTO` direct-entry behavior can regress if mode grouping changes accidentally.
