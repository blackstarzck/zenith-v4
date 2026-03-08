# Fill Message/Table Sync Note (2026-03-07)

## Symptom
- A fill toast message appeared, but the fill row did not immediately appear in the strategy fill table.

## Cause
- Fill toast was driven by live websocket `FILL` events.
- Fill table data source was page-based API response and did not append live `FILL` events immediately.

## Fix
- On websocket `FILL` event, update `fillEventsByStrategy` in-place (dedupe + sort + page-size trim).
- Increment visible pagination `total` in UI state so users see immediate count change.

## Operational note
- If DB is manually purged while engine is still running, in-memory strategy position state can temporarily diverge from DB history until restart.
