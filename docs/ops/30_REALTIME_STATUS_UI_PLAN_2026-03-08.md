# 30_REALTIME_STATUS_UI_PLAN_2026-03-08

## Goal
- Expose runtime `realtimeStatus` details in the live dashboard so operators can see backlog and retry state without inspecting logs.

## Scope
- wire backend `realtimeStatus` into the live page state
- show `queueDepth`, `retryCount`, and `nextRetryInMs` in the status badge
- keep the control-target badge responsive to local socket reconnect/pending state
- sync relevant UI documentation

## Acceptance
1. `runs-live.page.tsx` reads `realtimeStatus` from `GET /runs/:runId`.
2. `RealtimeStatusBadge` renders backlog and retry metadata when present.
3. Control-target status reflects both local socket transitions and server-side backlog data.
4. docs for the live screen mention the new badge behavior.
