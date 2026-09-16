# Send button submits typed text in the V2 weaver chat

Tracker change for [VS-484](weave://tickets/VS-484). A `change` ticket.

## Why

In the V2 weaver chat, pressing Send with typed text does nothing at all: no request, no error, no
message. Voice dictation still sends, so the thread is reachable only by voice. This is a
regression from VS-450, which moved the dictation session above the outlet and made `ChatComposer`
read its send path from the shell-level session.

## What changes

- The composer's Send control submits the **composer's own draft** for a plain typed send. It no
  longer routes a typed send through the shared dictation session, whose draft is empty until a
  dictation has targeted the thread (VS-450), which is why the press was silently a no-op.
- When a dictation is listening or transcribing **for this composer's thread**, Send keeps its
  VS-282/VS-416 meaning: finish the dictation and submit the transcript through the same queued
  path.
- A dictation targeting a **different** thread no longer captures this composer's Send: a typed
  send goes to the thread being typed in.
- No server, API, schema or draft-store change.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `web-v2/chat-composer`: adds the requirement that a typed send reads the composer's own draft and
  is never coupled to the shared dictation session's (possibly untargeted) draft, while a dictation
  active in this thread keeps its finish-and-send meaning. The existing "Three identical controls
  send, attach and dictate" requirement already states that Send posts the typed text; this change
  makes the shared-session case explicit and testable.

## Impact

- `packages/ui/src/v2/ChatComposer.tsx` — the send control's handler and the local/shared controller
  selection.
- `packages/ui/src/test/v2dictationsession.test.tsx` — a regression test rendering the real
  `ChatComposer` inside the `DictationSessionProvider` and asserting a typed send posts.
- No change to `DictationSession.tsx`'s behaviour or the floating bar; the local path (V1-style
  bare composer, the Plan modal) is unchanged.
