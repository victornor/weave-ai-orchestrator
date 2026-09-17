## Why

The VS-492 health sweep produces false positives from short boilerplate fragments, intentional hub
indexes, and deliberate redirect documents. Those issues inflate the health count and wake the
conductor for work that needs no curation, making a later real alert easier to ignore.

## What Changes

- Make duplicate detection precision-aware: compare only entries with at least two words and at
  least 12 non-whitespace characters, and remove the containment shortcut for the sweep so a short
  common fragment cannot score as a near-duplicate of unrelated prose. Keep the existing 0.8
  threshold for qualifying pairs and document the floor's compatibility with the real two-word
  near-duplicate.
- Exclude hub-file section-pointer lines (a `[[slug]] — summary` entry repeated in `Landmines` and
  `Documents`) from duplicate candidates while leaving ordinary hub entries eligible.
- Treat a linked document whose non-heading body is a single redirect pointer to another document
  slug as intentional, so it is not listed as an orphan. Keep ordinary zero-backlink documents
  orphaned.
- Ensure the health signature and conductor wake payload use only the filtered duplicate and orphan
  results. A sweep with no surviving issue SHALL remain silent.
- Add regression tests using the reported `**Status:**` content, the real `PROJECT.md` section
  pointer pattern, the `design-contract` redirect, and the existing real near-duplicate entries.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `knowledge/health`: health reporting and health-wake issue sets exclude non-actionable duplicate
  pairs and intentional redirect or hub-index entries.
- `knowledge/scheduled-curation`: the bounded duplicate sweep applies minimum-content and hub-pointer
  filtering before reporting likely duplicates.

## Impact

- `packages/core/src/knowledge/files.ts` and `packages/core/src/knowledge/service.ts` will expose
  the candidate filters and apply redirect-aware orphan classification.
- `packages/core/src/supervisor/index.ts` will consume the filtered health results without changing
  the existing periodic cadence, signature persistence, cooldown, or payload shape.
- `packages/core/src/knowledge/{files,knowledge}.test.ts` and
  `packages/core/src/supervisor/supervisor.test.ts` will cover the three real false-positive cases
  and preserve genuine duplicate detection.
- No new dependency, route, setting, migration, or knowledge-file edit is required.
