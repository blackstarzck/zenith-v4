# 35_STRATEGY_REBUILD_PLAN_2026-03-08.md
# Multi-Strategy Rebuild Plan

## Goal
- Rebuild the runtime so `STRAT_A`, `STRAT_B`, and `STRAT_C` execute from the attached strategy documents instead of a shared simplified evaluator.
- Prevent cross-strategy logic entanglement by separating strategy code, runtime state, and execution policy.
- Keep one program that runs all three strategies while preserving independent state, timing, risk, and reporting.

## Scope
- Strategy logic
- Execution sequence and fill model handling
- Realtime data handling
- Network/resilience boundaries
- Persistence/contracts/reporting
- Live UI runtime visibility

## Non-Goals
- No destructive rewrite of unrelated modules.
- No hidden strategy-specific branching in shared runtime helpers.
- No completion claim for real live order placement unless the exchange order path is actually implemented and verified.

## Inputs / Outputs
### Inputs
- Strategy source docs:
  - `C:\Users\chanki\Downloads\strat_a_win_rate_90.txt`
  - attached STRAT_B screenshots and current repo strategy notes
  - `C:\Users\chanki\Downloads\strat_c_win_rate_56.txt`
- Gap analysis:
  - `C:\Users\chanki\Downloads\codex_analysis_on_dfference_between_start_docs_and_real_codes.txt`

### Outputs
- Updated strategy specs and parameter registry
- Shared runtime contract and per-strategy runtime state
- Shared market aggregation modules
- Per-strategy evaluators/state machines
- Runs/reporting artifacts aligned to real fills/exits
- Tests for strategy behavior and execution ordering

## Architecture Direction
### 1. Strategy isolation
- Strategy code must live under `apps/api/src/modules/execution/engine/strategies/<strategyId>/`.
- Shared indicators, candle utilities, fill helpers, and runtime interfaces must live under `apps/api/src/modules/execution/engine/shared/`.
- Strategy modules must not import from each other.

### 2. Shared runtime core
- One runtime orchestrator owns:
  - websocket and transport recovery
  - market data fan-out
  - multi-timeframe candle aggregation
  - event sequencing
  - risk block application
  - persistence / gateway emission
- Strategy modules own:
  - signal detection
  - pending entry / pending exit state
  - stop / TP / trailing / timeout rules
  - strategy-specific entry policy metadata

### 3. Multi-timeframe market pipeline
- Base source of truth: Upbit trade stream.
- Derived streams:
  - 1m candle + trade bucket features for `STRAT_C`
  - 15m candle for `STRAT_A` and `STRAT_B`
  - 1h structural candle for `STRAT_B`
- Additional realtime feeds:
  - ticker for fast TP/SL checks
  - orderbook for simulated/realistic best bid/ask selection

### 4. Runtime state partition
- Shared runtime state keeps:
  - run metadata
  - risk state
  - transport/persistence status
  - open position ledger
  - pending exchange intents
- Strategy runtime state keeps only strategy-local fields.
- Shared runtime must never infer strategy-local meaning from generic booleans like `inPosition` alone.

## Strategy Runtime Model
### STRAT_A
- Timeframe: 15m
- Required states:
  - `FLAT`
  - `WAIT_CONFIRM`
  - `WAIT_ENTRY`
  - `IN_POSITION`
  - `IN_TRAIL`
- Required behaviors:
  - BB reclaim trigger
  - bullish confirm on next 15m candle
  - next-open or on-close policy without lookahead violation
  - ATR-regime stop
  - 50% partial exit
  - trailing stop after partial
  - 10-bar time exit

### STRAT_B
- Timeframes: 15m and 1h
- Required states:
  - `FLAT`
  - `WAIT_POI`
  - `WAIT_CONFIRM`
  - `WAIT_APPROVAL`
  - `WAIT_ENTRY`
  - `IN_POSITION`
- Required behaviors:
  - 1h bull-mode gating
  - 15m FVG / order-block / trend-line structure capture
  - POI validity window
  - AUTO and SEMI_AUTO fill timing split
  - SL from order-block low + buffer
  - TP from prior high or RR fallback
  - bull-off exit

### STRAT_C
- Timeframe: 1m plus tick/ticker/orderbook monitoring
- Required states:
  - `IDLE`
  - `ENTRY_PENDING`
  - `IN_POSITION`
  - `EXIT_PENDING`
  - `COOLDOWN`
  - `PAUSED`
- Required behaviors:
  - trade-value and buy-value bucket aggregation from live trades
  - next-minute-open entry reservation
  - fixed notional entry sizing
  - TP1 70%, TP2 30%, SL, time stop
  - cooldown / consecutive-stop pause
  - timeout-based reprice / cancel flow

## Anti-Entanglement Rules
- Shared modules may define interfaces, event types, and helpers, but not strategy branching tables with hidden behavior.
- Strategy-specific parameters must be namespaced and resolved by strategy module factories.
- Shared execution code can size and emit orders, but exit reason semantics come from strategy modules.
- Reporting must use emitted fill/exit data, never synthetic rows.
- UI labels must be derived from contract payloads, not hardcoded strategy assumptions.

## Module Plan
### Backend
- `apps/api/src/modules/execution/engine/shared/`
  - runtime event types
  - market snapshot types
  - indicators
  - math/time helpers
  - execution helpers
- `apps/api/src/modules/execution/engine/strategies/strat-a/`
  - config
  - state
  - evaluator
  - tests
- `apps/api/src/modules/execution/engine/strategies/strat-b/`
  - config
  - state
  - structure detectors
  - evaluator
  - tests
- `apps/api/src/modules/execution/engine/strategies/strat-c/`
  - config
  - state
  - trade bucket aggregator
  - evaluator
  - tests

### Docs / Contracts
- `docs/specs/08_STRATEGIES.md`
- `docs/specs/09_PARAMETER_REGISTRY.md`
- `docs/specs/10_EXPERIMENT_PROTOCOL.md`
- `docs/specs/12_PROJECT_STRUCTURE.md`
- `docs/specs/14_CONTRACTS_SPEC.md`
- `docs/specs/13_SCREEN_SPEC.md` if runtime payloads change on the live page

## Change Order
1. Lock the rebuild plan and update strategy/parameter/contract specs.
2. Introduce shared runtime interfaces and strategy module boundaries.
3. Replace the monolithic evaluator/runtime state with strategy-specific state machines.
4. Rebuild market aggregation for 1m, 15m, and 1h feeds.
5. Rework execution sequencing so partial fills/exits and pending orders are first-class runtime events.
6. Rebuild reporting from actual fills, exit reasons, and fees/slippage metadata.
7. Update live UI bindings and debug overlays.
8. Refresh tests and run verification.

## Verification
- Unit tests:
  - indicator helpers
  - timeframe aggregation
  - each strategy state machine
  - runtime execution transitions
  - reporting/account summary derivation
- Integration tests:
  - runtime processor + runs service + gateway sequencing
  - approval flow for `STRAT_B`
  - persistence merge / fill ledger behavior
- Commands:
  - `npm.cmd test -- --test-reporter=spec`
  - `npm.cmd run typecheck:api`
  - `npm.cmd run typecheck:web`
- Manual diff review:
  - confirm no mojibake in markdown or Korean strings
  - confirm strategy docs and code references match

## Risks
- STRAT_B source material is partly image-based, so exact structural rules must be fixed in repo docs while coding.
- Shared runtime refactor can break existing tests that encode current simplified behavior.
- Multi-timeframe aggregation and pending-order states increase event-order complexity; `runId + seq` discipline must remain intact.
- Fee/slippage corrections will change account summary and may invalidate existing snapshots/tests.

## Success Criteria
- Each strategy has its own evaluator/state with no cross-imports.
- Runtime can process all three strategies simultaneously without shared mutable strategy logic.
- Strategy docs, parameter registry, experiment protocol, contracts, and runtime code describe the same execution model.
- Fill/exit/report outputs are derived from actual runtime decisions rather than placeholders.
