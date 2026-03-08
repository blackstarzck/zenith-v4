# Realtime Network Recovery Plan (2026-03-07)

## Goal
- Extract websocket connection lifecycle and recovery behavior from `UpbitRealtimeEngine`.
- Make reconnect scheduling, health monitoring, and trade-stream subscription explicit in a dedicated helper.

## Why
- The engine still owns both runtime message processing and network recovery behavior.
- This makes realtime failures harder to isolate and verify.
- The current priority is network-aware runtime structure after strategy and execution sequence stabilization.

## Scope
- Backend execution engine
- Upbit websocket lifecycle and recovery path
- Backend tests
- Architecture and experiment docs

## Non-Goals
- No strategy algorithm change in this step
- No runtime mode state machine change in this step
- No DB/persistence redesign in this step
- No UI change in this step

## Inputs / Outputs
- Inputs:
  - websocket open/message/error/close callbacks
  - reconnect timer state
  - health-check timer state
- Outputs:
  - trade-stream subscription payload
  - reconnect attempts and recovery metrics
  - health-check logs
  - delegated raw message callback back into the engine

## Affected Files
- `apps/api/src/modules/execution/engine/upbit-realtime-engine.ts`
- new websocket/recovery helper under `apps/api/src/modules/execution/engine/`
- backend tests for the helper and engine wiring
- related markdown docs

## Planned Changes
1. Add a dedicated Upbit realtime connection helper.
2. Move websocket open/error/close/message wiring, reconnect scheduling, and health monitoring into that helper.
3. Let `UpbitRealtimeEngine` delegate network lifecycle to the helper and keep only market message processing/orchestration.
4. Add unit tests for reconnect scheduling and subscription behavior.
5. Update docs so the network recovery source of truth is explicit.

## Verification
- `npm.cmd --workspace @zenith/api run typecheck`
- `npm.cmd --workspace @zenith/api test`
- Manual review of these behaviors:
  - open -> subscribe trade stream
  - close -> schedule reconnect
  - reconnect open -> recovery metric
  - stop/destroy -> no further reconnect scheduling

## Risks
- Close handling can double-schedule reconnects if state flags drift.
- Helper extraction can accidentally stop message fan-out if event wiring is wrong.
- Health monitoring can duplicate timers if lifecycle ownership is unclear.
