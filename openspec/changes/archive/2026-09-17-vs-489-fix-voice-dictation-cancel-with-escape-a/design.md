## Context

See `proposal.md` — Why. The current state that shapes the approach:

- V2 owns **one** dictation session in `DictationSessionProvider`, mounted above the shell
  (`packages/ui/src/v2/DictationSession.tsx`), backed by one `useDictationController`
  (`packages/ui/src/lib/dictationController.ts`) and one `useDictation`
  (`packages/ui/src/lib/dictation.ts`). The composer and the off-page `DictationBar` are two views
  of that one session.
- The session's **target** is captured when dictation starts from `composerGetter.current` — the last
  composer to call `registerComposer` (`DictationSession.tsx:138`, `ChatComposer.tsx:184`). With one
  pane this is the only composer; with several panes the most recently mounted wins, not the focused
  one.
- The **off-page bar** is shown by `const onTargetChat = path === /w/<ws>/chat`
  (`DictationSession.tsx:181`); the bar renders everywhere else, including `/chats`, where the target
  chat is actually on screen.
- `stop()` (`dictationController.ts:141`) is also the auto-send armer: with the setting on it sets
  `pendingSend` and the queued-send effect submits once the attempt settles. There is no path that
  ends a session without the possibility of sending.
- Escape today: no handler on the V2 chat composer or the bar. A `Sheet`/dialog closes on Escape
  (`components/Sheet.tsx:51`), `SearchPanel` closes, the Work board search clears, a Plan rename
  cancels, a `PaneSeparator` resets its split. None of them touches dictation, and a shared-session
  Escape handler must not change them when no dictation is active.
- The multi-pane view is `packages/ui/src/v2/chats/ChatsPage.tsx`: it already tracks `focusedWs` and
  passes `focused` down to each `V2ChatPage`; the V2 global-chats spec already requires per-pane
  global listeners to be active only in the focused pane.

## Goals / Non-Goals

**Goals:**

- Escape while a V2 dictation is listening or transcribing ends it with no send, from the composer
  and the bar, restoring the pre-dictation draft.
- Ending a dictation by any of its own gestures (mic control, bar Stop, hotkey release/toggle-off)
  leaves the transcript and submits nothing; only an explicit send submits.
- In the multi-chat view the session targets the focused pane's composer, records in its in-composer
  UI, and never shows a recording state in a non-focused pane or the off-page bar.
- One session, so a second start stops the first.

**Non-Goals:**

- Changing the speech backend or transcription.
- Changing the explicit queued send of VS-282/VS-416: pressing Send while dictating still finishes
  the dictation and submits the settled transcript exactly once.
- V1's composer and the Plan modal's local session (VS-450 gives the Plan modal its own session;
  Escape there may still be the modal's). Their Escape and targeting behaviour stays as it is.
- Persisting a session across a reload.

## Decisions

### A `cancel()` distinct from `stop()`

`stop()` means "finish and possibly send"; Escape means "abandon and send nothing". Add a `cancel()`
to `useDictation` and to `useDictationController` rather than overloading `stop()`:

- `useDictation.cancel()` releases the recognizer or aborts the in-flight `POST /api/transcribe` via
  the existing `abortRef`, then settles the attempt without emitting a further transcript.
- `useDictationController.cancel()` marks the session discarded, clears `pendingSend` /
  `pendingSendRef` and any `pendingNotice`, stops the reveal, calls `dictation.cancel()`, and
  restores `base.current` (the draft captured at `start()`) to the composer.

Alternative considered: make Escape call `stop()` with a flag that suppresses auto-send. Rejected —
`stop()` is also the normal "finish" path everything else routes through; a flag there would leave
two meanings in one function and risk the VS-435 auto-send path.

Alternative considered: reuse the VS-439 "too short" discard. Rejected as the primary mechanism — it
only restores the draft when the transcript is short, so a long cancelled transcript would remain.

### Escape is handled by the shared session, while it is active

The provider installs a `keydown` listener only while the session is listening or transcribing and
cancels on Escape. Scoping it to the shared V2 session:

- the Plan modal (which opts out of the shared session) and V1 are untouched, so a modal's Escape
  cannot be shadowed;
- when no dictation is active, no listener is installed and every existing Escape meaning is
  byte-for-byte unchanged.

The listener does not `preventDefault()`/`stopPropagation()` beyond cancelling, so a surface that
also reacts to Escape keeps its behaviour in the (rare) overlap.

### Target selection follows the focused pane

`ChatsPage` already passes `focused` to `V2ChatPage`; thread it to `ChatConversation` →
`ChatComposer` as "this composer is the focused pane's composer". Then:

- only the focused composer calls `registerComposer`, so the shared session's target is always the
  focused pane;
- a non-focused composer does not expose an active dictate control and never shows the in-composer
  slot, so a second pane cannot start or display a recording;
- while a session is active, a pane that does not own it offers no way to start one either, so a
  second recording is refused rather than restarted (decision below); `startSession` also refuses to
  retarget a running session, which is what would otherwise move its transcript to another pane.

The in-composer dictation slot is gated on the composer being the registered (i.e. focused) target,
not on the old thread-id match alone. Single-chat pages pass `focused` true and are unchanged.

### A second pane's dictate control is refused, not a restarter

The acceptance allows "stops the first" or "refused". **Refused** is chosen: the view already has
"exactly one pane is live", and the dictation session is a single shared object with one target.
Handing a non-target pane's mic a stop action would either paint a second recording indicator in a
pane that does not own the session, or split the session's stop semantics between a pane control and
the bar. Instead, only the owning pane's control acts; anywhere else, Stop lives on the bar, the
global chord or Escape. The alternative (retarget the running session) was rejected because
retargeting mid-session makes the controller's restore of the pre-dictation draft race the target
switch and can write one pane's draft into another's.

### Bar visibility follows the target composer, not the route

Replace `onTargetChat = path === /w/<ws>/chat` with "the session's target composer is currently
registered (focused and on screen)". The registered composer *is* the target when the session has
one, so the bar renders exactly when the target is not present and focused: the same result on the
single-chat page, and on `/chats` it now stays hidden while the target pane is focused (and appears
only if the human moves focus off the target pane, matching VS-450's leaving-the-chat behaviour).

Alternative considered: special-case `/chats` in the path check. Rejected — it keeps two sources of
truth for "is the target on screen" and would not cover the multi-pane focus changes.

### Retire auto-send; Stop is not a send

The steering this change carries requires the only ways a message is submitted to be the send
keybinding and the Send button. As shipped, the controller's single `stop()` both ended a session and
armed the queued send (VS-435), and it is what the mic control, the bar's Stop and the hotkey all
call. The arming is removed: `stop()` only ends the session, and the transcript that already streams
into the draft stays there for the human to send or edit.

With no dictation-ending path taking it any more, the "Send automatically when dictation ends"
preference has no reachable trigger — a dictation that ends by itself (the recognizer ending on
silence) either restarts or reports that it heard no speech, so it never yields a transcript to
send. It is therefore **retired**: `lib/dictationAutoSend.ts`, its Settings switch and its tests are
removed, rather than leaving a switch that does nothing. Escape remains the discard path; Stop is
the keep-the-transcript path.

Alternatives considered: keep auto-send for the push-to-talk release only (rejected — the steering
allows only the send keybinding or the Send button to send, and a second send path is exactly the
surprise being removed); keep the switch for a self-terminating dictation (rejected — that case
cannot produce a transcript, so the switch would be inert and misleading).

## Risks / Trade-offs

- [A shared Escape listener could shadow a modal's Escape] → it is installed only while a shared V2
  dictation is active; the Plan modal has its own session and does not install it, and no listener
  exists when idle.
- [Cancelling races the VS-439 discard and the queued send] → both now check the same
  `discarded`/cancelled marker, and `cancel()` clears `pendingSend` before `dictation.cancel()`;
  tests assert no submit happened, not merely that a handler fired.
- [Disabling the dictate control in non-focused panes surprises someone expecting per-pane mics] →
  matches the view's existing "one pane is live" rule and the spec's per-pane-listener gate; the
  human focuses the pane first, as with typing.
- [Bar visibility now depends on composer registration lifetime] → the existing unregister cleanup
  already runs on unmount; the rules are the same one the target already used when a session starts.

## Open Questions

None.
