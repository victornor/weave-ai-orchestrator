# V2 chat shows edit/write diffs open by default

Tracker change for [VS-413](weave://tickets/VS-413). A `task` ticket, so this change carries
tasks only — `skip_specs: true`.

## Why

Captain: "There's no edit previews in the chat in V2. Like the added and removed… the nice
previews we have in V1."

The V2 chat renderer already has the diff, it is just hidden twice over:

- `packages/ui/src/v2/ChatTrace.tsx`'s `ToolRow` starts `open` as `useState(false)`, so an
  edit/write call renders its `EditPayloadBody` only after a click.
- `ToolGroup` starts closed too, for any run of same-name calls VS-370 folded together.

V1's `packages/ui/src/components/Transcript.tsx` is the opposite: `TranscriptLine` starts an
edit-type row expanded (`useState(() => … Boolean(block.editPayload))`), so a diff is visible on
first render.

## What changes

- **Edit and write rows start expanded.** `ToolRow` initialises `open` from `block.editPayload`,
  exactly as V1's `TranscriptLine` does. Every other tool row keeps starting collapsed, as VS-370
  intended.
- **The card is tall enough to read a typical edit.** The edit body's scroll container grows from
  `max-h-40` (160px) to `max-h-96` (384px); a long diff still scrolls inside the card and the chat
  below it stays usable.
- **An edit is never hidden inside a collapsed group.** `groupConsecutiveTools` already refuses to
  fold an `editPayload` block, so each edit is its own row; a regression test pins that a run of
  three consecutive edits renders three expanded diffs, not an `Edit ×3` line.
- **Collapsing still works.** Clicking an edit's own header toggles it shut, and that choice holds
  while the turn streams (the row keeps its component identity across new events).
- **Tests** in `packages/ui/src/test/v2chattrace.test.tsx`: an edit and a write diff are visible
  with no click; three consecutive edits are three expanded diffs; clicking an edit header collapses
  it and a later event leaves it collapsed; a `Bash ×N` group still starts collapsed.

## Out of scope

- The Watch preview and Roles panes (VS-409).
- Chat status chips (VS-412).
- The pull request diff view.
- V1. V1 already renders every edit expanded; this change does not touch it.
- `file.changed`-only rows (no diff payload): this change concerns edit/write calls carrying an
  `EditPayload`.
