# 29_RUNTIME_RESILIENCE_COMPLETION_PLAN_2026-03-07

## Goal
- Finish the remaining mandatory realtime resilience work without leaving partial recovery paths.
- Keep the canonical runtime engine flow stable while adding visibility for snapshot delay, websocket recovery, and persistence backlog.

## Scope
- complete `RunsService` realtime status derivation
- reflect websocket lifecycle state into runtime status
- keep snapshot bootstrap timeout/backfill recovery visible to runtime status
- buffer DB write failures and flush queued events in order after recovery
- add regression tests for the new recovery paths
- sync architecture, contracts, experiment protocol, and project structure docs

## Non-goals
- UI refactor
- fill-table normalization or new database tables
- report-page changes

## Acceptance
1. `GET /runs/:runId` exposes a stable `realtimeStatus` object for runtime runs.
2. Startup snapshot timeout keeps the run in delayed state until the first valid live trade is processed.
3. Websocket reconnect transitions are visible as runtime status changes.
4. DB write failures do not drop runtime events; buffered events are retried and published in order after persistence recovers.
5. `npm.cmd --workspace @zenith/api run typecheck` passes.
6. `npm.cmd --workspace @zenith/api test` passes.

## Planned Changes
1. Finish realtime status helpers in `apps/api/src/modules/runs/runs.service.ts`.
2. Add websocket state callback support in `apps/api/src/modules/execution/engine/upbit-realtime-connection.ts`.
3. Wire snapshot delay and transport state updates in `apps/api/src/modules/execution/engine/upbit-realtime-engine.ts`.
4. Add ordered persistence buffering in `apps/api/src/modules/ws/gateways/`.
5. Add regression coverage and update docs.
