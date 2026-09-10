# Parallel changes to one requirement collide silently until archive fails

## Why

VS-204 and VS-205 both modified `conductor-chat/turn-work-trace` in parallel. Git merged both
cleanly — each change writes into its own `openspec/changes/<name>/` folder, so there was never a
conflict — but VS-205's MODIFIED block predates the four scenarios VS-204 added, and a MODIFIED
requirement replaces the whole block. OpenSpec correctly refused to archive VS-205 rather than
silently drop VS-204's scenarios.

That refusal reached nobody usefully: `openspec archive`'s failure detail comes back as a JSON
`status` array on stdout, but `packages/core/src/openspec/cli.ts`'s `archive()` runs without
`allowFailure` and builds its error from `stderr` alone — which is empty for this failure — so the
ticket's `unblock_json` and system comment read as `openspec archive failed: openspec archive
<name> --yes --json exited 1: ` with nothing after the colon. The only way to see the real reason
was to run `openspec validate --strict` by hand, which is what this investigation did.

Separately, `openspec/changes/` on `main` already held `vs-30-allow-changing-a-hired-role-s-max-
worker`, fully merged and fully valid, never archived. The supervisor's hourly reconciliation
sweep (`reconcileOpenSpecArchives`) exists precisely to catch a change a merged ticket left behind
— but its query restricts to `kind = 'change'`, and VS-30 is a `task` ticket with a tracker change
(`skip_specs: true`, per `agent-conductor-openspec`'s own rule for task tickets in OpenSpec
projects). The sweep was never going to pick it up.

## What Changes

- `cli.archive()` surfaces the validator's actual message on failure (the `status` array on
  stdout), instead of an empty `stderr`-only message. This fixes the "empty error" for both the
  merge-time failure (`tickets.mergeDone`) and the hourly reconciliation retry.
- `reconcileOpenSpecArchives`'s query drops the `kind = 'change'` restriction, so a `task` ticket's
  tracker change is archived by the same backfill a `change` ticket's already is. This is what
  actually resolves the VS-30 residue — no manual archive, no data repair, just letting the
  existing sweep see it. `scout`/`question` tickets never get an `openspec_change_name`, so
  widening the query does not pull in anything unintended.
- A reconciliation-triggered archive failure now leaves a system comment on the ticket and wakes
  the conductor once (idempotency-keyed per ticket), instead of only a `log.warn` nobody but a log
  reader would ever see. Today VS-205 has likely been retried and silently failing on every hourly
  sweep since it merged.
- VS-205's stale spec delta (`openspec/changes/vs-205-.../specs/conductor-chat/turn-work-trace/
  spec.md`) is repaired by hand: its MODIFIED block is brought up to the requirement text and all
  eight scenarios currently in `openspec/specs/conductor-chat/turn-work-trace/spec.md` (VS-204's
  four plus its own pre-existing four), plus VS-205's own new scenario about a duplicate companion
  event. This is a content-only fix to a change directory already on `main`; no application code
  changes. Once it lands, the (now-fixed) reconciliation sweep archives it on its own next pass —
  this ticket does not run `openspec archive` itself, per the standing rule that only the daemon
  archives.
- Nothing changes about *when* the daemon attempts to archive (still after landing) — see
  `design.md` for why catching the collision earlier belongs to the worker's own pre-merge
  checklist rather than a new daemon gate, and what changes there.

## Capabilities

### New Capabilities

- `ticket-delivery/openspec-archival`: archive-after-merge now always carries a real failure
  reason, and the reconciliation backfill covers every ticket kind that can own an OpenSpec change,
  not just `change` tickets, and it no longer fails silently either.

### Modified Capabilities
(none — no existing capability documented archive-after-merge or the reconciliation backfill; see
`design.md` for why this is filed as an ADDED capability rather than a gap-filling MODIFIED one)

## Impact

- Code: `packages/core/src/openspec/cli.ts`, `packages/core/src/supervisor/index.ts`.
- Content only: `openspec/changes/vs-205-empty-rows-pad-the-transcript-one-per-re/specs/
  conductor-chat/turn-work-trace/spec.md`.
- Docs: `skills/agent-conductor-worker/references/delivery.md` gets one added pre-merge step (see
  `design.md`).
- No database migration, no API surface change, no UI change.
