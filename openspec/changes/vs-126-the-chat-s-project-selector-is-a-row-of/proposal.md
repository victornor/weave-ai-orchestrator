## Why

Captain (2026-09-08): the chat's project picker is a native `<select>` (`ProjectPicker` in
`packages/ui/src/routes/Chat.tsx:791-819`) and it looks out of place next to the chat's other
controls, which are all pill-shaped tags (worker chips, dispatch labels). It should read as a row
of selectable tags — one per project, plus an **Auto** tag carrying today's "all projects"
behaviour — with the active choice obvious at a glance, not hidden inside a closed dropdown.

## What Changes

- `ProjectPicker` becomes a horizontal, single-select strip of tags: an **Auto** tag (today's "all
  projects" — no project reference sent) always first, then one tag per selectable project.
  Visual shell matches the existing chat chips (`WorkerChip`/`TicketChip` in
  `packages/ui/src/components/Chips.tsx`) rather than introducing a second tag style; the selected
  tag is distinguished by more than a subtle border (accent fill/border, not colour alone).
- Exposed as a single-select group for assistive technology (`role="radiogroup"` +
  `role="radio"`/`aria-checked`, matching the existing `Segmented` control's pattern in
  `packages/ui/src/components/Tabs.tsx`), with the same accessible label the `<select>` carries
  today ("Project for this message"). Each tag is reachable and operable by keyboard.
  Activating the already-selected project tag returns to Auto.
- The strip scrolls horizontally instead of wrapping, so it never grows the composer's height or
  displaces the send control, and the selected tag is scrolled into view whenever the strip mounts
  with a selection already made (reopening a thread, restoring a draft).
  Verified against a phone-width viewport with enough projects to overflow.
- Keeps every behaviour the current `<select>` already gets right: archived projects are omitted
  except one the thread already used (the `orphan` case), and a workspace with no other projects
  still renders sensibly (Auto alone).
- Existing tests at `packages/ui/src/test/chat.test.tsx:564-657` that assert on `<option>` elements
  are rewritten to assert the same behaviour against the new tag markup.
- **Added after plan approval (captain, 2026-09-08, ticket comment):** sending a message resets the
  strip's selection to Auto unconditionally — on an immediate send and on an offline-queued one
  alike — because a stale wrong project is more costly than one re-pick. The reset is written into
  the persisted draft (VS-48) so a reload after sending does not resurrect the cleared choice, and
  it does not trigger the mount-only scroll-into-view.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `conductor-chat/message-project-context`: the "conductor chat offers a project selector beside
  its input" requirement changes from a dropdown-shaped control to a horizontal single-select tag
  strip, and gains explicit requirements for horizontal-scroll overflow (no wrap, no composer
  growth), scrolling the current selection into view on mount, and single-select accessibility
  semantics. The archived-project-orphan behaviour, previously only in code, is made an explicit
  scenario of the requirement it already lived under.

## Impact

- `packages/ui/src/routes/Chat.tsx` — `ProjectPicker` rewritten as a tag strip; likely a new small
  component (or an addition to `packages/ui/src/components/Chips.tsx`) for the selectable/active
  tag shell, reused by the strip.
- `packages/ui/src/test/chat.test.tsx:564-657` — project-context tests rewritten against the new
  markup.
- No server, API, or storage changes: the message's project reference and its wire behaviour are
  unchanged (out of scope per the ticket).
