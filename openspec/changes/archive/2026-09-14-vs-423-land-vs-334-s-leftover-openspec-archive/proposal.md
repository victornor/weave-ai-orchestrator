# Land VS-334's leftover OpenSpec archive by hand

Tracker change for [VS-423](weave://tickets/VS-423). A `task` ticket, so this change carries
tasks only — `skip_specs: true`.

## Why

VS-334 merged before archiving moved into the merge itself, leaving
`openspec/changes/vs-334-plugins-can-add-agent-tools-their-own-st/` on `main` and its five new
plugin capabilities absent from `openspec/specs/plugins/`. The daemon's archive-backfill (PR #313)
was approved and its VS-408 rebuild ran `openspec archive` from the landing tip, which refused: the
`plugins/web-pages` delta's five ADDED requirements already exist on `main` in VS-385's newer
`plugins/web-pages` spec. The refusal is recorded once and does not loop; the archive needs a person
to reconcile the specs.

## What changes

- **Drop the duplicate web-pages delta.** VS-385's `openspec/specs/plugins/web-pages/spec.md` is the
  authoritative, newer text; every VS-334 web-pages requirement and scenario is a superset-covered
  subset of it, so no `MODIFIED` delta is needed and nothing is lost.
- **Archive VS-334's change.** Move the change folder under `openspec/changes/archive/` and create
  the five new capability specs under `openspec/specs/plugins/` — `agent-tools`, `events`,
  `http-routes`, `lifecycle` and `storage` — from VS-334's deltas.
- **Close #313.** The daemon's archive-backfill pull request is superseded by this one.

Spec and OpenSpec files only; no code changes.

## Non-goals

No change to any plugin's behaviour, no new capability, and no edit to VS-385's `web-pages` spec.
