# 34. Realtime Account Summary Mark Price Plan (2026-03-08)

## Goal
- Make live strategy summary rows react to current market price for price-sensitive fields.
- Keep fill-driven and exit-driven metrics updating according to their own event types.

## Scope
- Backend `RunsService.getStrategyAccountSummary()`
- Web live page strategy summary/account summary update path
- Relevant contracts/screen documentation

## Acceptance
- `totalPnlKrw` and `totalPnlPct` use the latest available market price, not the last fill price.
- `positionQty` and `avgEntryPriceKrw` update immediately on `FILL`.
- `winRate`, `sumReturnPct`, `avgWinPct`, `avgLossPct`, and daily realized PnL remain event-driven.
- Live table rows move on market ticks without requiring a manual refresh.

## Plan
1. Resolve latest strategy mark price from runtime candle state in the API.
2. Recompute backend account summary mark-to-market fields with that mark price.
3. Patch frontend local account summary state on `FILL` and market tick events.
4. Update docs for realtime account metric behavior.
5. Verify with API/web tests and diff checks.
