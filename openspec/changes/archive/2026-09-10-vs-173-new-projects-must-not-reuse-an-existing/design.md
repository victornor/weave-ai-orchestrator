## Context

See proposal.md for motivation. VS-149 (`packages/ui/src/lib/projectColor.ts`) maps
`PALETTE[hash(id) % 5]` with a five-entry hand-picked palette (`--project-1` … `--project-5`)
and no storage. Call sites pass only the id: `WorkspaceNav.tsx`, `Chat.tsx` (dispatch labels,
worker chips, `ProjectPicker`). `DispatchLabel` / `WorkerChip` / `ProjectTag` already take a
resolved CSS variable; they do not hash.

Project ids are ULIDs, so lexicographic order is creation order. Projects are archived on
remove, not deleted (`projects.test.ts`).

## Goals / Non-Goals

**Goals:**

- Uniqueness among a workspace's project ids whenever a palette slot is free.
- Existing colours stay put when a later-id project is added.
- Same helper everywhere the web app shows a project colour, so sidebar / tags / chips agree.
- Existing colliding pair resolved by the same function (later id takes a free slot). Cheap,
  no migration.

**Non-Goals:**

- No stored colour column, no `POST /projects` change, no API/CLI.
- Not expanding the palette (hand-picked to miss status/accent hues; new entries need a visual
  pass this ticket does not own).
- Not Telegram / TUI.
- Not a human-editable colour.

## Decisions

### Client-side uniqueness, still no storage

VS-149 rejected a stored field. Uniqueness is `projectColorVar(id, siblingIds)` over the
workspace's project ids (including archived — they still occupy a slot, so un-archive cannot
collide). Alternatives considered:

- Persist a colour index at create: uniqueness is a server invariant, but needs a migration,
  a default for existing rows, and an API the ticket does not ask for. Rejected.
- Expand the palette: new tokens must stay clear of status/accent in both themes; that is a
  design task, not a uniqueness fix. Rejected; least-used instead.

### Greedy in ULID order, prefer hash, else first free, else least-used

Walk sibling ids sorted lexicographically (creation order). For each id:

1. Preferred slot = `hash(id) % PALETTE.length` (same FNV-1a as today).
2. If that slot is unused among already-assigned siblings, take it.
3. Else take the lowest-index unused slot.
4. Else take a least-used slot; if the preferred slot is among the least-used, keep it,
   otherwise the lowest index among the least-used.

A newly added project has a later ULID, so it is assigned last and cannot steal an earlier
project's colour. A lone id (empty sibling list) still hashes as today.

When two existing ids already share a hash slot, the earlier keeps it and the later is
reassigned to a free slot — the cheap recolour of the already-colliding pair.

### Every call site passes the workspace's full project-id list

A subset (active-only, choosable-only, or `[id]`) would assign a different colour than the
sidebar. `ProjectPicker` already has `projects`; Chat already has the workspace project query
for the picker — dispatch labels and worker chips use that same list. Archived ids stay in
the list even when the picker hides them.

Signature: `projectColorVar(id: string, siblingIds: readonly string[] = [])`. The default
keeps isolated tests (`projectColorVar('p1')`) on the hash path; production call sites pass
the list.

### Tests live in `projectColor.test.ts`

Pure cases, no daemon:

- Two ids that hash to the same slot get different colours when the other is in `siblingIds`
  and a free slot exists.
- A third id added after two distinct colours does not reuse either while a slot is free.
- Adding a later id does not change an earlier id's colour.
- When every slot is taken, the next id gets a least-used colour (count increases by one on
  a min-count slot).
- Same `(id, sibling set)` is stable; no `Math.random` / `Date` / storage.

`workspacenav.test.tsx` / `chat.test.tsx` update expected values to
`projectColorVar(id, allIds)`.

## Risks / Trade-offs

- [Deleting/archiving could shift later colours if archived ids were dropped] → Keep archived
  ids in the sibling set. Colour occupancy is the workspace's project rows, not the picker.
- [A call site that forgets siblings reintroduces collisions] → Type the second argument as
  required at production call sites; default `[]` is only for the hash-only unit tests. Review
  the four Chat/Nav call sites in the same change.
- [More projects than palette entries must share] → Accepted; least-used is the contract.
  Expanding the palette is a later visual ticket.
- [Existing colliding pair changes colour for the later project] → Intended and cheap. The
  earlier project keeps the hash colour.

## Migration Plan

None. Deploy is the usual UI rebuild. Rollback is revert. Existing collisions resolve on first
render of the new helper; no backfill.

## Open Questions

None.
