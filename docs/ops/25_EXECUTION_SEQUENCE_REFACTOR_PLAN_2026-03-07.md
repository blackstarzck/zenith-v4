# Execution Sequence Refactor Plan (2026-03-07)

## Goal
- Make execution event order a single source of truth for strategy entry, exit, and semi-auto approval flow.
- Reduce the spread of sequence rules across strategy evaluation and the realtime engine.

## Why
- Entry/exit event order is currently assembled in multiple places.
- STRAT_B semi-auto approval flow manually emits events in the realtime engine.
- Sequence changes are high-risk because strategy logic, engine behavior, persistence, and UI all depend on event order.

## Scope
- Backend execution engine
- Strategy evaluation
- Realtime execution path
- Backend tests
- Architecture and project-structure docs

## Non-Goals
- No UI refactor in this step
- No table/schema redesign in this step
- No strategy parameter redesign in this step

## Affected Files
- `apps/api/src/modules/execution/engine/strategy-evaluator.ts`
- `apps/api/src/modules/execution/engine/simple-momentum.strategy.ts`
- `apps/api/src/modules/execution/engine/upbit-realtime-engine.ts`
- new shared execution-sequence module under `apps/api/src/modules/execution/engine/`
- `apps/api/test/strategy-evaluator.spec.ts`
- `apps/api/test/upbit-realtime-engine.spec.ts`
- related markdown docs

## Planned Changes
1. Add a shared execution-sequence builder module.
2. Move normal entry/exit event ordering into the shared builder.
3. Route semi-auto approval entry through the same sequencing model.
4. Add tests that assert event order, not just event existence.
5. Update docs so the sequence source of truth is explicit.

## Verification
- Backend test suite for strategy evaluator and realtime engine
- Manual code review for exact event order:
  - entry: `SIGNAL_EMIT -> ORDER_INTENT -> FILL -> POSITION_UPDATE`
  - exit: `EXIT -> ORDER_INTENT -> FILL -> POSITION_UPDATE`
  - semi-auto approval: `SIGNAL_EMIT -> APPROVE_ENTER`, approval execution `ORDER_INTENT -> FILL -> POSITION_UPDATE`

## Risks
- Changing sequence assembly can break KPI/readiness/persistence assumptions.
- Semi-auto approval behavior can regress if state update timing changes.
- Event order changes can affect live UI tables and downstream consumers.
