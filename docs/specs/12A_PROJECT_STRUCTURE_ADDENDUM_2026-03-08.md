# 12A_PROJECT_STRUCTURE_ADDENDUM_2026-03-08.md

## Purpose
- Capture the project-structure delta added during the 2026-03-08 multi-strategy rebuild without rewriting the legacy `12_PROJECT_STRUCTURE.md` body.

## Added Shared Module Boundary
- `packages/contracts/src/run/run-control-rules.ts`

## Why This Exists
- The live control panel now shares one tested SSOT for:
  - allowed modes by strategy
  - allowed requested/applied fill models by strategy/mode
  - derived `entryPolicy`
  - strategy-specific control-note text
  - strategy-specific overlay payload extraction

## Boundary Rule
- UI pages should consume these rules from the shared contracts-side module instead of re-declaring strategy-specific control logic inline.
- Strategy runtime logic still belongs in `apps/api/src/modules/execution/engine/**`.
- UI-only rendering concerns still belong in `apps/web/**`.

## Files Using This Boundary
- `packages/contracts/src/run/run-control-rules.ts`
- `apps/web/src/features/runs/pages/runs-live.page.tsx`
- `apps/api/test/run-control-rules.spec.ts`
