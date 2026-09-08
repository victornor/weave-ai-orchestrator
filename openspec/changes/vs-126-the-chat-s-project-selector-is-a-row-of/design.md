## Context

See `proposal.md` for motivation. `ProjectPicker` (`packages/ui/src/routes/Chat.tsx:791-819`) is
a native `<select>` today; its selection logic (`choosable`, `orphan`) stays as-is — only its
rendering changes. Existing chip components in `packages/ui/src/components/Chips.tsx`
(`WorkerChip`, `TicketChip`) and `packages/ui/src/components/DispatchLabel.tsx` share one visual
shell: `inline-flex items-center gap-1.5 rounded-r4 border border-line-2 bg-bg-2 px-2 py-1`. None
of them has a "selected" state, since none is a toggle. The closest existing selected/unselected
pill pattern is `StatusPill` (`packages/ui/src/routes/Board.tsx:267-280`): inactive `border-line-2
text-text-3`, active `border-accent-edge bg-accent-tint text-accent-link`. The closest existing
single-select accessibility pattern is `Segmented` (`packages/ui/src/components/Tabs.tsx:50-88`):
`role="radiogroup"` wrapping `role="radio"` buttons with `aria-checked`.

## Goals / Non-Goals

**Goals:**
- One new small presentational piece — a selectable tag — built from the existing chip shell plus
  the existing selected/unselected colour pair, so the strip reads as "one of the chat's tags",
  not a new visual language.
- Reuse `Segmented`'s accessibility shape (`radiogroup`/`radio`/`aria-checked`) rather than
  inventing a new one.

**Non-Goals:**
- No change to what a project reference does once sent, to the composer's other controls, or to
  the `<select>`'s underlying selection logic (`choosable`/`orphan`), which is already correct and
  is being kept, per the ticket.

## Decisions

- **New component, not a `WorkerChip` variant.** `WorkerChip`/`TicketChip` render a `StatusGlyph`
  and are not toggles. A new `ProjectTag` (in `Chips.tsx`, beside its siblings) takes the same
  shell classes plus an `active` boolean, styled with the `StatusPill` active/inactive pair. This
  satisfies "reuse the component or its classes" without bolting an unrelated `active` prop onto
  chips that are never selectable.
- **`role="radiogroup"` / `role="radio"` / `aria-checked`**, mirroring `Segmented`, with
  `aria-label="Project for this message"` on the group — the exact string the `<select>` carries
  today, so nothing about the accessible name changes for a screen-reader user. Each tag is a
  native `<button type="button">`, so it is keyboard-focusable and operable without extra key
  handling; no roving-tabindex arrow-key navigation is added, matching `Segmented`'s existing
  precedent in this codebase.
- **Overflow via `overflow-x-auto` on the strip, `flex-none` / `shrink-0` on each tag**, the same
  recipe `Tabs` already uses for its own horizontal scroll (`Tabs.tsx:22`). The strip does not
  wrap (`flex-nowrap` implicit from not opting into wrap) and sits beside the composer, not inside
  its growable area, so it cannot push the send control down.
- **Scroll-into-view via a ref + `scrollIntoView({ block: 'nearest', inline: 'nearest' })`** on the
  active tag, run in a `useEffect` keyed on mount (and on the strip's identity changing, i.e. a
  thread switch), matching the existing `scrollIntoView` usage in `stickToBottom.ts` and
  `WorkerPage.tsx`. `block`/`inline: 'nearest'` avoids scrolling the whole page when the strip
  itself already has the tag in view. Tests stub `HTMLElement.prototype.scrollIntoView` exactly as
  `chat.test.tsx` already does for its transcript-autoscroll assertions.
- **Auto is a tag, not a special case in the strip's markup** — it is simply the first entry with
  `value: null`, so overflow, scroll-into-view and keyboard behaviour apply to it uniformly.

- **Reset-to-Auto lands in `Chat.tsx`'s `send()`, not in `ProjectPicker`.** `send()` already does
  the analogous unconditional `patch({ replyToId: null })` on both the offline-queue branch and the
  normal-post branch (`Chat.tsx:507-538`); the project reset is `patch({ projectId: null })` at the
  same two call sites, so it shares the exact "resets whether or not the send has resolved yet"
  semantics `replyToId` already has, rather than waiting on the mutation's success. `projectId:
  null` (not `undefined`) is required — `undefined` on the draft means "no explicit choice, fall
  back to the thread's last-used project" (`Chat.tsx:219`), which would resurrect the very
  selection this is supposed to clear; `null` pins it to Auto unconditionally.
- **No new scroll call on reset.** The mount-only `useEffect(() => {...}, [])` in `ProjectPicker`
  already does not re-run when `value` changes after a reset, so nothing further was needed to keep
  the reset from moving the strip.

## Risks / Trade-offs

- [A very long project name could dominate a tag's width] → truncate with `ac-truncate` /
  `max-w-[…]` the way `WorkerChip`'s name span already does, so one long name does not blow out
  the strip.
- [No roving-tabindex means every tag is a separate Tab stop, unlike a native `<select>`'s single
  stop] → accepted: `Segmented` already ships this trade-off elsewhere in the app; consistency
  with that precedent outweighs adding new keyboard-navigation code for this one control.
