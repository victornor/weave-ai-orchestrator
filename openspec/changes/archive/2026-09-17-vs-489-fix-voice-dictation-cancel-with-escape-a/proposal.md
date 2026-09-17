# Cancel dictation with Escape and target the focused pane in the multi-chat view

Tracker change for [VS-489](weave://tickets/VS-489). A `change` ticket.

## Why

Two defects in V2 voice dictation, the same feature and the same files.

1. **A dictation cannot be aborted.** With the opt-in "Send automatically when dictation ends"
   setting on (VS-435), finishing a dictation is the same act as pressing Send, so a
   mistranscribed or mistaken recording can only be sent. There is no way to stop the microphone
   and send nothing.
2. **Ending a dictation could send it.** With the opt-in "Send automatically when dictation ends"
   setting (VS-435) on, the on-screen Stop, the chord release and the mic button all submitted the
   finished transcript. Pressing Stop to correct a mistake sent it instead. The send must be a
   deliberate act: only the send keybinding or the Send button.
3. **In the all-weaver-chats view (`/chats`) dictation does not know which chat it belongs to.**
   The shared session picks its target from the last composer to register rather than the focused
   pane (VS-450), so the chord can dictate into a pane the human is not using and the recording
   indicator can appear in the wrong pane. Because the off-page floating bar is chosen by comparing
   the route to `/w/<ws>/chat`, it also opens over `/chats`, even though the target chat is on
   screen — the "off-page" UI for a page the human is looking at.

## What Changes

- **Escape cancels an active dictation**: the microphone is released, an in-flight transcription
  request is abandoned, the dictated text is discarded, the draft is restored to what it held
  before dictation, and nothing is sent — including with auto-send on. It works from the
  in-composer dictation UI and from the off-page bar. Escape keeps its other meanings when no
  dictation is active.
- **In the multi-chat view, dictation belongs to the focused pane**: only the focused pane's
  composer can start dictation or show the recording state, the transcript lands in that composer,
  and it uses the same in-composer dictation UI as the single-chat page.
- **A second pane's dictate control is refused while a session is active** (one shared session, so
  two panes are never recording): stop the running session from its own pane, the bar, the chord or
  Escape, then start in the other pane.
- **The off-page dictation bar no longer opens from the multi-chat view** while its target composer
  is the focused, on-screen composer: bar visibility follows whether the target composer is
  present and focused, not whether the path equals the single-chat route.
- **Ending a dictation never sends it.** The mic button, the off-page bar's Stop, and the chord's
  release or toggle-off all end the session and leave the transcript in the composer; only the send
  keybinding or the Send button submits. The optional "Send automatically when dictation ends"
  setting (VS-435) is **retired** with this: no dictation-end path remains to trigger it, so its
  switch and preference are removed rather than left inert.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `web-v2/chat-composer`: adds the requirement that Escape cancels an active dictation without
  sending and restores the pre-dictation draft (Escape's other meanings unchanged when no dictation
  is active), and that ending a dictation by any of its own gestures leaves the transcript and never
  sends — only an explicit send submits.
- `web-v2/global-chats`: adds the requirement that dictation in the multi-pane view is owned by the
  focused pane — targeted there, shown with the in-composer UI rather than the off-page bar, and
  never recording in two panes at once.

## Impact

- `packages/ui/src/lib/dictation.ts` — a `cancel()` that ends a session without delivering a
  transcript (stops the recognizer, aborts an in-flight upload, settles).
- `packages/ui/src/lib/dictationController.ts` — a controller `cancel()` that discards the session,
  clears any queued send, and restores the pre-dictation draft.
- `packages/ui/src/v2/DictationSession.tsx` — an Escape handler while a session is active; target
  selection from the focused composer; bar visibility by target presence rather than route equality.
- `packages/ui/src/v2/ChatComposer.tsx`, `ChatPage.tsx`, `chats/ChatsPage.tsx` — thread the
  focused-pane flag to composer registration and to the in-composer dictation slot.
- `packages/ui/src/v2/DictationBar.tsx` — the cancel affordance follows the same Escape path.
- Tests: `v2dictationsession.test.tsx`, `v2chats.test.tsx`, `v2chatcomposer.test.tsx`,
  `dictation.test.tsx`.
- No server, API, schema or draft-store change. V1's composer and the Plan modal's local dictation
  keep their current Escape and targeting behaviour.
