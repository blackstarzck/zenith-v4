# Zenith v4

Monorepo scaffold for:
- `apps/web` (React + Vite)
- `apps/api` (Nest-like modular backend skeleton)
- `packages/contracts` (shared API/WS contracts)

## Quick start
1. Install dependencies
   - `npm install`
2. Type-check
   - `npm run typecheck`
3. Run web
   - `npm --workspace @zenith/web run dev`
4. Run api
   - `npm --workspace @zenith/api run dev`

## Current focus implemented
- WebSocket UI realtime status state (`LIVE/DELAYED/RECONNECTING/ERROR/PAUSED`)
- Resilience primitives (`try/catch`, timeout, retry with backoff+jitter)
- Sequence safety (`runId + seq` duplicate/out-of-order guard)
- Structured system-event logging contract
- External network client stack with Axios (Upbit + Supabase REST write path)

## Environment
See `.env.example`.
