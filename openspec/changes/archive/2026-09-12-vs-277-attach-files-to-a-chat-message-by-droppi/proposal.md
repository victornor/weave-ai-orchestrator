# Attach files to a chat message by dropping them, not only by pasting

## Why

A human can attach a file to a conductor chat message by pasting it or by using the browse control,
but dragging a screenshot or a log file onto the chat does nothing. Dropping is the most natural of
the three gestures, and today it is the only one missing. In its place, the browser's default drop
handling takes over and navigates away from the app to the file — losing whatever was typed in the
composer.

## What Changes

- The conductor chat composer becomes a drop target for files. A drop calls the same `addFiles`
  funnel that browse and paste already call, so the accepted type list, the per-message cap and both
  error messages are identical by construction rather than by a second copy being kept in step.
- Drop is gated by the same `allowAttachments` prop that gates browse and paste.
- While a file drag is over the composer it shows the existing active-border treatment (`border-accent`,
  the same idiom the open mic uses); a drag that is not a file, or a drop where attachments are not
  allowed, shows nothing and is left entirely to the browser.
- Two levels do two separate jobs. A **window-level** `dragover`/`drop` listener, registered only
  while `allowAttachments` is true, calls `preventDefault()` for file drags wherever they land so the
  browser never navigates away to the file and the app never unloads. The **composer** is the only
  place that actually attaches a file. A drop that misses the composer therefore does nothing at all
  — no navigation, no attach — which is what makes accepting the composer's small target safe.
  Non-file drags are left untouched at both levels.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `conductor-chat/message-attachments`: the requirement that an attachment can be added by browsing
  or pasting gains dropping as a third input path, with the same attached state and the same
  rejection/limit feedback. No new capability — this is one more path into the existing requirement.

## Impact

- `packages/ui/src/components/Composer.tsx` — drag handlers and a drag-over highlight on the
  composer's bordered container.
- `packages/ui/src/test/components.test.tsx` — new coverage for the drop path beside the existing
  paste coverage.
- No server, storage, schema, API or dependency changes: the file still travels through the same
  `onSubmit` and the existing attachment pipeline.
