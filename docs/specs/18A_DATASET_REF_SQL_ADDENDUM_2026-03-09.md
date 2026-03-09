# 18A_DATASET_REF_SQL_ADDENDUM_2026-03-09.md

## Purpose
- Record the SQL-side expectations for `dataset_ref` without rewriting the older draft file that currently has encoding damage.

## `text_runs.dataset_ref`
- Column type: `jsonb`
- Storage rule: one snapshot per `run_id`
- Minimal shape:

```json
{
  "key": "UPBIT|REPLAY_BACKTEST|KRW-XRP|15m|candle:15m|2026-02|||exact",
  "source": "UPBIT",
  "profile": "REPLAY_BACKTEST",
  "market": "KRW-XRP",
  "timeframes": ["15m"],
  "feeds": ["candle:15m"],
  "dateRangeLabel": "2026-02",
  "exact": true
}
```

## Write Paths
- `safeInsertRunEvent()` may seed `dataset_ref` from event payload metadata.
- `PATCH /runs/:runId/control` may update `dataset_ref`.
- `syncRunArtifacts()` backfills `dataset_ref` from generated `run_report.json`.

## Compatibility Rule
- Some deployed environments may still lack the `dataset_ref` column.
- API persistence must therefore fall back to legacy insert/select/patch flows when Supabase reports `PGRST204` for `dataset_ref`.

## Validation Rule
- `/reports/benchmark-compare` treats `dataset_ref` as exact only when:
  - `market` matches
  - ordered `timeframes` match
  - ordered `feeds` match
  - `dateRangeLabel` matches
  - `exact=true`
- `MATCHED` may still be provisional when the compatible dataset is known but exact equality is not provable.
