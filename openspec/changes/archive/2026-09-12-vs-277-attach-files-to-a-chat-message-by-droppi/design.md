# Design — dropping files onto the conductor chat composer

See `proposal.md` for motivation and `specs/conductor-chat/message-attachments/spec.md` for the
behavior contract. This document records the technical choices.

## Context

`packages/ui/src/components/Composer.tsx` is the single composer used by chat, ticket comments,
decision notes and revise-plan notes. Attachments are gated by its `allowAttachments` prop and only
enabled on the conductor chat composer (`Chat.tsx:888`). Every attachment path funnels through one
`addFiles(incoming: File[])` callback (`Composer.tsx:113`), which filters by
`ACCEPTED_ATTACHMENT_TYPES`, applies `ATTACHMENT_MAX_PER_MESSAGE`, and sets the two `attachError`
messages. Browse and paste call it; the file input calls it; nothing else does.

The composer's bordered container already swaps to `border-accent` while the mic is open
(`Composer.tsx:265`). That is the only temporary active-border language in the component.

## Goals / Non-Goals

**Goals:**

- Dropping files is just a third call site of `addFiles`, so the acceptance rules, the cap and both
  error messages cannot drift from browse/paste.
- No browser navigation and no loss of typed text on any drop.
- Non-file drags (selected text, links, text dragged within the textarea) are untouched.
- A visible, in-vocabulary indication while a file drag is over the target.

**Non-Goals:**

- Changing the accepted types, the per-message cap, or the upload pipeline.
- Accepting drops anywhere outside the composer (the message list, ticket cards, the knowledge
  explorer). Out of scope per the ticket.
- Any server or storage change.

## Decisions

### The drop target is the composer, not the whole chat pane

Rejected: making the whole chat/conversation region the drop zone, which would give a larger target.
That option puts drag-enter/leave state in `Chat.tsx` (or another host) and makes it responsible for
the visual highlight while the highlight has to be painted on a different element — the composer —
because the composer's `border-accent` is the only active-border treatment in the design vocabulary.
It would also have to be re-implemented per host (chat, and any future attachment-enabled composer),
and would make a drop on the message area ambiguous about which composer receives the file.

Chosen: the composer's own bordered container is the drop target. It is full-width within the
`max-w-3xl` column, it already owns the active-border language, and the whole change stays inside one
component that already owns attachment state. The target is smaller than the whole pane, but dropping
precisely on the input is the deliberate gesture and the highlight makes it unambiguous.

### A window-level guard refuses the browser default; only the composer attaches

The composer is a small target, and a miss must be harmless. If the only `preventDefault()` calls sat
on the composer, a file dropped anywhere else would be handled by the browser, which navigates to the
file and unloads the app — losing whatever was typed. That is the worst outcome in the feature and it
is exactly what acceptance criterion 4 forbids. So the work splits in two, cleanly:

- **Window guard**: a `useEffect` registered while `allowAttachments` is true adds `dragover` and
  `drop` listeners on `window` that call `preventDefault()` when `dataTransfer.types` includes
  `Files`, and do nothing otherwise. Removed on cleanup. No highlight, no attaching, no state — its
  only job is to refuse to let the browser open a dropped file anywhere in the app. A miss becomes a
  no-op.
- **Composer**: the only place that attaches, exactly as designed — the highlight and the `addFiles`
  call live there.

The window drop handler also resets `dragDepth` and clears `dragActive`, so a drag that leaves the
window without a matching `dragleave` (which is possible, since `dragleave` does not always fire for a
window exit) cannot strand the highlight. Non-file drags fall through at both levels, so a dragged
link still works everywhere.

Rejected: relying on the composer's handlers alone. It is fewer listeners but makes a miss
catastrophic, and the conductor's review caught the proposal already claiming a window-level guard
that the design did not have.

### File-only detection via `dataTransfer.types`

`dragover`/`dragenter`/`dragleave`/`drop` handlers treat the drag as an attachment drag only when
`Array.from(e.dataTransfer.types).includes('Files')`. A text/link drag carries `text/plain` and
`text/uri-list` but not `Files`, so it falls through untouched and the browser's normal behavior —
including dragging text inside the textarea — keeps working. `types` is available on
`dragover`/`dragenter` in browsers; the drop handler also uses it so a non-file drop is not swallowed.

### `preventDefault` on both `dragover` and `drop`

`dragover` must `preventDefault()` or the browser never fires `drop` and, worse, may navigate to the
file. `drop` `preventDefault()` stops the navigation. Both happen only for file drags, so a text/link
drop is left entirely to the browser.

### Depth counter, not `relatedTarget`, for the highlight

`dragenter`/`dragleave` fire as the pointer crosses each child of the container. A naive
`onDragLeave` that clears the highlight flickers whenever the pointer moves between the chips, the
textarea and the buttons. The composer keeps a `dragDepth` ref: `dragenter` increments and sets the
highlight; `dragleave` decrements and clears it only at zero; `drop` — on the composer or the window
guard — resets it to zero and clears the highlight. `relatedTarget` was rejected because it is null for drags leaving the window and does not
reliably identify containment across the chip/input boundary here; the counter is self-correcting and
survives entering/exiting children.

### Highlight reuses `border-accent`

The container's `className` becomes `dragActive || dictating || transcribing ? 'border-accent' : 'border-line-2'`.
No new visual element, no dashed overlay, no new token.

### The existing requirement name stays

The spec delta modifies `### Requirement: An attachment can be added by browsing or by pasting` in
place and keeps that exact name, because OpenSpec matches a MODIFIED requirement (and its scenarios)
to the target spec by name; renaming it would fail `openspec validate --strict` as a lost
requirement. The requirement's body and scenarios are expanded to cover dropping.

## Risks / Trade-offs

- [The composer's collapsed height is a small target] → Accepted, because the window guard makes a
  miss a harmless no-op: no navigation, no unload, nothing attached. The highlight shows the file
  will land on the composer when the pointer is over it, and the container's width is the full input
  column. Widening beyond the composer was rejected above.
- [A drag that leaves the window without a matching `dragleave` could leave the highlight stuck] →
  Reset the depth counter on `drop`, and only ever render the highlight while `dragActive` and
  `allowAttachments` are both true. A subsequent `dragenter`/`dragleave` pair self-corrects.
- [jsdom's `DragEvent` support is partial] → Drive the handlers with `fireEvent.dragEnter/dragOver/
  dragLeave/drop` and an explicit `dataTransfer` object carrying `types` and `files`; assert the
  resulting attached state and highlight, not the raw DOM event.

## Migration Plan

None. A UI-only, additive change; no data or route migration, no feature flag. Rollback is reverting
the commit.
