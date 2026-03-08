# 07_AGENT.md
# Agent Work Protocol

## Purpose
- This document records standing user rules, core project goals, and the mandatory pre-work planning flow.
- Before substantial implementation work, the agent must review this document, align the task to these goals, and present an execution plan first.
- If the user adds a new standing rule later, update this document in the same task.

## Core Goals
1. Configured strategies must run with correct logic and a correct execution sequence.
2. Runtime logic must operate against real-time coin market data, not a simplified offline assumption.
3. The system structure must fit a real-time network environment, including modularity and recovery behavior.

## Priority Order
1. Strategy correctness
2. Real-time execution sequence
3. Network-aware runtime structure and modularization
4. Data integrity and persistence consistency
5. UI, reporting, and operator convenience

## Interpretation Rules
- When a task affects strategy behavior, the engine contract and event order take priority over UI behavior.
- When a task affects live execution, first verify the data path from market data -> candle/state -> decision -> order/fill -> persistence/publish.
- When a task looks like a display issue, first rule out engine/runtime/data-contract issues before treating it as a pure UI bug.
- Parameter differences between strategies must remain namespaced and must not be solved by strategy-specific schema sprawl.

## Mandatory Pre-Work Flow
1. Restate the user request in terms of goal impact.
2. Classify the change scope:
   - strategy logic
   - execution sequence / fill model
   - real-time data handling
   - network/resilience
   - persistence/contracts
   - UI/reporting
3. Review the affected code, contracts, tests, and markdown docs before editing.
4. Present a concrete execution plan before making substantial code changes.
5. The plan must include:
   - task goal
   - non-goals or constraints
   - affected modules/files
   - change order
   - verification method
   - risks, assumptions, or blockers
6. If the work spans multiple modules or changes architecture-sensitive behavior, record the plan in `docs/ops/` before or during implementation.
7. If new facts invalidate the plan during execution, report the change and re-plan before continuing.

## Planning Template
- Goal: what must become true after the change
- Scope: which layers are affected
- Inputs/Outputs: APIs, events, tables, sockets, and documents involved
- Sequence: ordered implementation steps
- Verification: tests, runtime checks, and manual validation
- Risks: lookahead, race conditions, duplicate events, network failure, persistence mismatch

## Completion Rules
- Completion reports must include:
  1. completed work
  2. incomplete items or limitations
  3. next actions
- Do not declare completion if strategy/execution/realtime acceptance criteria are not actually satisfied.
- If docs and implementation diverge, correct the divergence in the same task or report it explicitly.
