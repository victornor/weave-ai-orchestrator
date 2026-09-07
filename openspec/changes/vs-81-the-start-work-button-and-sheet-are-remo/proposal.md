# Start Work is removed; the conductor chat is the one place to ask for work

Tracker change for [VS-81](conductor://tickets/VS-81). A `task` ticket, so this change carries
tasks only — `skip_specs: true`. No live requirement describes Start Work: `workspace-navigation/
sidebar-workspaces` specifies the five phone tabs and the More menu, neither of which the floating
button is part of, and nothing in `conductor-chat` mentions it.

## Why

`StartWorkSheet` is a second composer over the same thread. It opens from the desktop rail's accent
button (`⌘⇧Space`), from the phone bar's floating action, and from the command palette's
"Create ticket"; it posts to the first conductor thread exactly as `ChatRoute` does.

The chat's own composer has since grown past it: per-thread drafts in sessionStorage (VS-48), the
project picker that tags the message, reply-to quoting, the offline queue with its count, and the
same `Composer` mic — the sheet's push-to-talk on `⌘⇧M` is a `Composer` behaviour, not the sheet's.
So the sheet offers strictly less, at the cost of the phone bar carrying a floating button that five
equal tabs have to be laid out around.

## What changes

- `StartWorkSheet.tsx` is deleted, with the rail button, the phone floating button, the `⌘⇧Space`
  hotkey and the palette's sheet-opening command.
- The palette's "Create ticket" navigates to the chat instead of opening a sheet, which is what the
  board's empty state already does.
- `BottomBar` loses `onStartWork` and the button; `barGeometry` loses `fabSize`, `fabTop`,
  `fabRect` and `intersects`. The 28px the tab row was pushed down by — the half-sunk button's
  reach — becomes the bar's own 8px top padding, and each tab centres its glyph and label in the
  chrome that is left. `--bar-height` is untouched: VS-80 is changing it.
- The chat's empty state keeps the sheet's opening pitch, with the sheet's second example and its
  mic hint folded in.
- `docs/design/DESIGN-CONTRACT.md`, `docs/PLAN.md` and `docs/SCENARIOS.md` are updated where they
  describe the button.

## Dropped rather than moved

Nothing. The sheet's example prompts move to the chat's empty state, the project selector and the
mic are already on the chat composer, and `⌘⇧Space` had no destination left once the sheet was
gone — the chat is `1` on the rail.

## Out of scope

The chat composer itself, beyond the empty-state copy. `--bar-height` and the bar's compaction,
which are VS-80.
