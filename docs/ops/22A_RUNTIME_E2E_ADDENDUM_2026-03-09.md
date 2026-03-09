# 22A_RUNTIME_E2E_ADDENDUM_2026-03-09.md

## Purpose
- Record the current runtime E2E findings without rewriting the older checklist file that contains encoding damage.

## Current Run IDs
- `run-strat-a-0001`
- `run-strat-b-0001`
- `run-strat-c-0001`

## Environment Notes
- `.env` contains non-empty values for:
  - `SUPABASE_URL`
  - `SUPABASE_SECRET_KEY`
  - `UPBIT_ACCESS_KEY`
  - `UPBIT_SECRET_KEY`
  - `UPBIT_MARKET`
  - `RUN_MODE`
  - `VITE_API_BASE_URL`
  - `VITE_SOCKET_PATH`

## Executed On March 9, 2026
- Scenario A, live candle/runtime feed: passed
  - verified through a booted API instance
  - `run-strat-c-0001` candles advanced while `marketTicks` increased from `22` to `63`
- Scenario D, runConfig mismatch guard: passed
  - `runConfigMismatches` increased from `0` to `1`
  - mismatch handling emitted `PAUSE`
- Scenario E, reconnect metrics: passed
  - `upbitReconnectAttempts` increased from `0` to `1`
  - `upbitReconnectRecoveries` increased from `0` to `1`
  - observed `upbitAvgRecoveryMs=2042`

## Scenario B: STRAT_B SEMI_AUTO Approval
- Local operator page was reachable at `http://127.0.0.1:5174/runs/live`.
- Restored run shell was re-synced on startup to the current env session:
  - `mode=SEMI_AUTO`
  - `entryPolicy=B_SEMI_AUTO_NEXT_OPEN_AFTER_APPROVAL`
- Before approval, `latestEntryReadiness` for `run-strat-b-0001` showed:
  - `entryReadinessPct=100`
  - `entryReady=true`
  - `entryExecutable=false`
  - `reason=AWAITING_APPROVAL`
- The operator control path used the exact API endpoint behind the live UI approve button:
  - `POST /runs/run-strat-b-0001/actions/approve`
- Confirmed event sequence after approval:
  - `1874 ORDER_INTENT side=BUY price=2000 qty=99.998899 reason=SEMI_AUTO_NEXT_OPEN`
  - `1875 FILL side=BUY fillPrice=2000 qty=99.998899`
  - `1876 POSITION_UPDATE side=LONG qty=99.998899 avgEntry=2000`
  - follow-up `ENTRY_READINESS` moved to `reason=IN_POSITION`
- Result: Scenario B passed on March 9, 2026.

## Scenario C: STRAT_B Risk Block In SEMI_AUTO
- API session was restarted with:
  - `RUN_MODE=SEMI_AUTO`
  - `E2E_FORCE_SEMI_AUTO_SIGNAL=true`
  - `RISK_MAX_DAILY_ORDERS=0`
  - `RUNCONFIG_MISMATCH_BLOCK=false`
- `run-strat-b-0001` config confirmed:
  - `mode=SEMI_AUTO`
  - `riskSnapshot.maxDailyOrders=0`
- The same operator approval path was used:
  - `POST /runs/run-strat-b-0001/actions/approve`
- Confirmed blocking sequence:
  - `1448 RISK_BLOCK reason=MAX_DAILY_ORDERS dailyOrders=0`
  - `1449 PAUSE reason=MAX_DAILY_ORDERS dailyOrders=0`
  - follow-up `ENTRY_READINESS` remained `reason=AWAITING_APPROVAL`
- No `FILL` occurred after the approval attempt.
- Result: Scenario C passed on March 9, 2026.

## Blockers Resolved During This Pass
- `E2E_FORCE_SEMI_AUTO_SIGNAL` was documented but initially unwired in the runtime path. The runtime now emits a deterministic STRAT_B approval request on the next `1m` candle open in `SEMI_AUTO`.
- Fixed run IDs restored older persisted run shells on startup. The engine now re-syncs the restored shell to the current env session so stale `PAPER` mode or stale entry policy does not leak into live E2E.

## Conclusion
- Scenarios A/B/C/D/E are all covered on March 9, 2026.
- Remaining work from the rebuild handoff is closed at the runtime E2E level.
