# Realtime Engine Modularization Plan (2026-03-07)

## Goal
- Split `UpbitRealtimeEngine` so the realtime data path and the strategy execution path are no longer mixed in one file.
- Make the live sequence easier to verify end-to-end:
  - market data ingest
  - minute candle state update
  - closed-candle strategy transition
  - event publish

## Why
- `upbit-realtime-engine.ts` currently owns websocket connection lifecycle, message decoding, candle aggregation, snapshot bootstrap, strategy transition, and risk-driven event emission.
- This concentration makes realtime regressions harder to isolate.
- The current project priorities require sequence correctness and realtime structure to take precedence over UI or reporting work.

## Scope
- Backend execution engine
- Realtime candle state handling
- Strategy runtime transition handling
- Backend tests
- Architecture and project-structure documentation

## Non-Goals
- No DB schema redesign in this step
- No UI refactor in this step
- No Nest module boundary expansion in this step
- No strategy algorithm change in this step

## Inputs / Outputs
- Inputs:
  - Upbit websocket trade messages
  - Upbit minute snapshot candles
  - per-strategy runtime state
- Outputs:
  - `MARKET_TICK`
  - canonical execution sequence events from `execution-sequence.ts`
  - readiness / risk / pause events

## Affected Files
- `apps/api/src/modules/execution/engine/upbit-realtime-engine.ts`
- new candle-state helper under `apps/api/src/modules/execution/engine/`
- new strategy-runtime helper under `apps/api/src/modules/execution/engine/`
- `apps/api/test/upbit-realtime-engine.spec.ts`
- related markdown docs

## Planned Changes
1. Extract pure candle-state operations from `UpbitRealtimeEngine`.
2. Extract strategy runtime state creation and closed-candle transition logic.
3. Keep websocket connection and high-level orchestration in `UpbitRealtimeEngine`.
4. Extend tests to assert the new helper boundaries without changing runtime behavior.
5. Update docs so the new source-of-truth module boundaries are explicit.

## Verification
- `npm.cmd --workspace @zenith/api test`
- `npm.cmd --workspace @zenith/api run typecheck`
- Manual code review of the realtime path:
  - websocket trade -> candle state update
  - closed candle -> strategy transition
  - strategy decisions -> canonical event emission

## Risks
- Realtime candle state can regress if snapshot/live update semantics change.
- SEMI_AUTO approval flow can regress if state transition extraction changes side effects.
- Event sequence or run sequencing can regress if helper boundaries accidentally reorder emission.
