## Why

A left-behind OpenSpec change is backfilled as a pull request on the sweep-owned
`ac/archive-<change>` branch (VS-389). Landing that pull request rebases the branch onto the
current landing tip; when the rebase conflicts because main has since changed the same generated
spec file, every retry conflicts again and the archive can never land. Live case: **#313**
(VS-334), whose branch was cut before VS-385 added `openspec/specs/plugins/web-pages/spec.md`.

## What Changes

- When landing an archive-backfill pull request (`ac/archive-<change>`), a stale branch whose
  rebase onto the current landing tip conflicts is **rebuilt from that tip** instead of retrying
  the rebase: the archive branch is reset to the landing tip, the change directory is restored
  (from the branch's pre-archive parent when the tip no longer carries it), `openspec archive`
  re-merges the change's deltas into the current specs, and the result is force-pushed before the
  existing checks-and-merge path continues.
- A rebuild that `openspec` refuses is returned to the caller as its own outcome carrying
  openspec's reason; the landing records that reason once per standing failure and wakes the weaver
  once, and does not loop.
- A clean stale archive branch still takes the existing rebase path, unchanged. The rebuild is
  scoped to archive-backfill callers only: a normal ticket branch whose rebase conflicts is still
  sent back to its worker, exactly as before.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `ticket-delivery/openspec-archival`: approving an archive-backfill merge card rebuilds a
  conflicting archive from the current landing tip rather than retrying a rebase that can never
  apply; a rebuild openspec refuses is recorded with its reason and does not loop.

## Impact

- `packages/core/src/tickets/archive-before-merge.ts` — new rebuild step and a `rebuild_failed`
  outcome on `attemptArchiveThenMerge`.
- `packages/core/src/tickets/service.ts` — `landArchiveBackfill` opts into the rebuild and reports
  its failure reason; `mergeDone` handles the new outcome for completeness.
- Tests: `packages/core/src/tickets/archive-before-merge.test.ts`,
  `packages/core/src/tickets/archive-backfill.test.ts`.
- No schema, API, CLI or UI change. The live #313 landing still requires the running daemon to be
  upgraded to a release carrying this change, and captain's approval of its merge card.
