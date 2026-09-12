## Why

captain wants the chat's open decisions to be optional: today's strip pinned above the composer, or
a split view with the conversation on the left and open decisions in a column on the right. Today
there is no choice — `packages/ui/src/routes/Chat.tsx` always renders the open cards in a `<section>`
between the transcript and the composer, so on a wide screen the stack takes height from the
conversation and there is nowhere else to put it. `packages/ui/src/lib/diffLayout.ts` already
establishes the pattern for a device-local view choice; this change gives the chat the same kind of
choice.

## What Changes

- Add a device-local layout choice for the chat's open-decision area: `bottom` (today's behavior, the
  default) or `split` (a right-hand rail). The choice is stored in `localStorage` and survives a
  reload.
- Add a discoverable control on the chat screen to switch layouts, presented the way the pull-request
  diff's Unified / Side-by-side toggle is.
- In `split`, render the open decision cards in a right-hand column beside the transcript and
  composer; the conversation and composer keep the left pane, and the composer is not narrowed to the
  point its controls wrap badly.
- Below the `md` breakpoint the layout is `bottom` regardless of the stored choice, and the control
  does not offer `split` there.
- Keep answered decisions inline in the transcript in both layouts, and keep the hidden-from-chat
  count and its "show them again" action working in both.
- Give both panes independent scrolling (`min-h-0` / `min-w-0` / `ac-scroll`), and collapse the rail
  entirely when nothing is open so `split` never leaves a dead column.
- Keep the bottom layout's existing resizable pinned area intact; the rail is full-height and carries
  no resize handle.

## Capabilities

### New Capabilities
- `conductor-chat/decision-layout`: the chat screen's device-local choice of where open decisions
  render (bottom strip or right-hand rail), the control that changes it, the narrow-viewport fallback,
  independent pane scrolling, the empty-rail behavior, and the guarantee that answered decisions stay
  in the transcript.

### Modified Capabilities
(none)

## Impact

- `packages/ui/src/routes/Chat.tsx`: the frame becomes a horizontal flex — a left column holding the
  transcript, the bottom pinned area when applicable, and the composer; an optional right rail for
  open decisions. The layout toggle is added to the header actions. Answering, hiding, attachments and
  the live-turn stream are unchanged.
- `packages/ui/src/lib/decisionLayout.ts`: new device-local preference mirroring `lib/diffLayout.ts`
  (key, absence-as-default, `try`/`catch`).
- `packages/ui/src/test/chat.test.tsx`, a new `packages/ui/src/lib/decisionLayout.test.ts`, and the
  screenshot harness: coverage for the toggle, persistence, the split DOM, the narrow fallback and the
  empty rail.
- No server, API, DB, CLI or Settings change. The choice is deliberately not workspace or account
  state and is not synced across devices.
