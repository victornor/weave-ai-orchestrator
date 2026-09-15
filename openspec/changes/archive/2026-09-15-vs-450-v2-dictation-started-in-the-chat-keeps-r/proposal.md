# Keep dictation running across V2 page navigation, with a floating dictation bar

Tracker change for [VS-450](weave://tickets/VS-450). A `task` ticket, so this change carries tasks
only — `skip_specs: true`.

## Why

Captain, 2026-09-14: start dictating in the weaver chat, move to another page (Work, to check a
ticket that is part of what they are explaining) and **keep dictating**. On the other page a voice
animation stays visible at the bottom, and they can press **Send** from wherever they are, which
sends to the weaver. Today leaving the chat unmounts `ChatComposer`, and `useDictation` stops the
session on unmount, so captain opens a second tab to look something up.

Blocked on **VS-441** (keyboard stop and the transcribing state) and **VS-439** (≤5-word discard);
both have landed, so this builds directly on their behaviour.

## What changes

- **The session moves above the outlet.** A `DictationSessionProvider` mounted in `V2Shell` owns the
  one `useDictation` instance, its meter, timer, transcribe state, the session `base` draft, the
  VS-439 discard and the VS-425 reveal. It survives route changes because it is no longer inside a
  page. A session remembers its **target** — workspace, weaver-chat thread, project scope and reply
  target — captured when it starts.
- **The transcript lands in the target thread's draft.** `lib/drafts` becomes a shared store
  (`useSyncExternalStore`), so a write from the provider reaches a mounted `ChatComposer` and a
  later mount reads it back. Interim words, the reveal and the discard all write there.
- **`ChatComposer` becomes a view onto the session** when its thread is the target: the listening /
  transcribing slot, the reveal and the queued send come from the provider. Outside a provider (the
  Plan modal, tests, V1) it keeps today's local session unchanged.
- **A floating dictation bar** shows on every V2 page except the target chat while the session is
  listening or transcribing: the meter or the transcribing animation, an elapsed timer, Stop, Send
  and "Back to chat". It clears the mobile bottom nav and safe area, is keyboard accessible and
  respects reduced motion.
- **Send from anywhere** submits the target thread's draft through the same rules as the chat's send
  arrow: stop and wait for transcription, honour auto-send, never send a discarded short result,
  queue offline, keep the project scope and reply target, confirm briefly and clear on success.
- **The Ctrl/⌘+Shift+Space chord works from any V2 page** and controls the same session.

## Attachments

Staged files are component state, not persisted in the draft store, so they cannot survive leaving
the chat. The bar's Send therefore warns that staged attachments will be dropped and offers "Back to
chat" instead of sending silently.

## Scope

- Weaver chat only. A dictation started in the Plan modal keeps today's behaviour (it ends with the
  modal), because that composer opts out of the shared session.
- V2 only. Closing the tab or reloading still ends the session — nothing is persisted across a
  reload.
- V1's `Composer` is untouched.

## Out of scope

Dictation in the Plan modal, ticket comments or other composers; background dictation after closing
the tab.
