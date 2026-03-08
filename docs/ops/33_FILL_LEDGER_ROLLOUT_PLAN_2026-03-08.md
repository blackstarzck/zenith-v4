# 33_FILL_LEDGER_ROLLOUT_PLAN_2026-03-08

## Goal
- Prepare the repository-side rollout assets needed to apply the `text_fills` ledger safely in an existing Supabase project.

## Scope
- add an official Supabase migration under `supabase/migrations`
- document the exact rollout order: schema, backfill, verification, then app deployment
- keep the current code fallback intact because the remote DB is not being changed in this workspace

## Acceptance
1. `supabase/migrations` contains a dedicated migration for `text_fills` and historical backfill.
2. `docs/specs/19_SUPABASE_SQL_RUNBOOK.md` includes the fill-ledger rollout and verification steps.
3. The repo contains enough instructions to apply the change later without re-deriving SQL from source code.
