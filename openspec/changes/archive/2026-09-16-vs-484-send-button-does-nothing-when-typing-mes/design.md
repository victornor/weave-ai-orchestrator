## Context

See `proposal.md` — Why. The relevant current state:

- `packages/ui/src/v2/ChatComposer.tsx` picks its controller as `const ctl = shared ?? local`, where
  `shared` is the shell-level `DictationSessionProvider`'s controller (VS-450). The Send control's
  handler is `const send = ctl.requestSend`, so in the V2 chat it is the **shared** controller's
  `requestSend`.
- `useDictationController.requestSend` (`packages/ui/src/lib/dictationController.ts`) submits
  `opts.value` — the draft the controller was constructed with. The provider constructs it with
  `value = draft.text` of its **target** thread, and `target` is `null` until a dictation session
  starts (`startSession`). With no target its `useDraft(null)` snapshot is the empty draft.
- So a typed send in the chat calls the shared `requestSend`, whose guard
  `if (!t && !hasFiles.current()) return` sees an empty `t` and returns. No request, no error — the
  reported symptom.
- Dictation still sends because it goes through the provider's `submit`, which routes to the
  registered composer's `doSubmit` (`ChatPage`'s `send`) once a session has set the target.

## Goals / Non-Goals

**Goals:**
- A typed Send in the V2 chat always posts the composer's current draft.
- Keep the VS-282/VS-416 finish-and-send behaviour while a dictation is active for this thread.
- Keep a dictation targeting another thread from capturing this composer's Send.
- A regression test that renders the real composer inside the provider, so this class of bug is
  caught (the existing composer tests render the bare composer with no provider and so never hit the
  shared path).

**Non-Goals:**
- Changing `DictationSessionProvider`'s target semantics, the floating bar, or the off-chat send.
- Persisting attachments across navigation (VS-450's stated gap).
- Changing the server, API, schema or draft store.

## Decisions

### Submit typed text from the composer's own controller

The Send handler is reworked into a small callback on the composer:

- when a dictation is listening or transcribing **for this composer's thread** (`sessionHere` true),
  call the shared controller's `requestSend` so the transcript queues exactly as today;
- otherwise call the **local** controller's `requestSend`, which reads the composer's own `value`
  and `files`.

Alternative considered: make the provider adopt the mounted composer's target whenever one
registers, so the shared draft is never empty. Rejected — VS-450 deliberately freezes a session's
target at start, and adopting the composer's target on registration would let navigation hijack a
running session. The defect is in the send path, not the target lifecycle.

Alternative considered: `const send = sessionHere ? shared.requestSend : local.requestSend`.
Rejected as the primary shape only because it leans on the provider's draft key happening to equal
the composer's; the explicit "dictating here" guard states the intent and is robust if the two draft
sources ever diverge. Both share the same local fallback.

### Keep the button's disabled/enabled logic as-is

The Send button's `disabled` already gates on `value`, staged files, dictation state and the pending
lock. The fix changes only which controller receives the press, so an enabled button can no longer
call a controller that ignores its input.

## Risks / Trade-offs

- [The local `useDictationController` is now actually invoked for sends; its `canSubmit`/`hasFiles`
  are wired to the same props as before, so no behavioural drift] → covered by the existing send,
  attachment and error tests, which exercise the local path.
- [A regression test that mounts the real composer inside the provider needs the router mock the
  session tests already use] → added in `v2dictationsession.test.tsx`, which already mocks
  `@tanstack/react-router`, `../app/link` and `api.ws`.
