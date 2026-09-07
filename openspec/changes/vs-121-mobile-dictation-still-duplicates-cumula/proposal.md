## Why

Tracker change for [VS-121](conductor://tickets/VS-121). Captain's phone still produces cumulative,
interleaved duplication after VS-70 (PR #58) shipped a fix for the same symptom, reasoned out from a
sequence a worker reconstructed by guessing, never run against a real device. Reasoning out a
second fix the same way — from another reconstructed sequence — is a second guess, not a
diagnosis; that is exactly how the first attempt failed and it is not a mistake worth repeating.

No worker can dictate on a real Android phone (only captain can), so this change stops guessing and
instruments instead. It ships in two steps, with captain in the middle:

1. **This change**: a dictation diagnostics capture. While it is turned on, every raw recognizer
   event (each `result` event's `resultIndex` and every entry's `isFinal`/`transcript`), every
   `onend`/restart boundary, and the composer's text after each one is recorded, and captain can
   copy the whole log to the clipboard as text — nothing leaves the device except by captain
   deliberately pasting it back. This is a complete, useful deliverable on its own: it is the first
   time this class of bug can be diagnosed from ground truth instead of a guess, and this is the
   second time we have been blind on exactly this, so it is worth keeping afterward, not stripped
   out once used.
2. **A follow-up**, scoped once captain dictates one sentence with diagnostics on and pastes back
   the raw log: diagnose the actual cause from that recording, implement the fix, and write a
   regression test that replays captain's real recorded events verbatim — not an invented sequence.
   Whether that follow-up reopens this ticket or is filed as a new one is the conductor's call, made
   when the data exists to scope it.

**The one part of the fix that is settled without needing captain's data**, because it follows from
the Web Speech API contract rather than from a guess about what a specific device does:
`useDictation`'s `onresult` currently rebuilds its per-event text by running `mergeTranscript` — a
word-level replace-or-append heuristic — across the indices of `event.results` within a single
event. Per the API, `results[0]`, `results[1]`, … are distinct, non-overlapping recognized segments
of the same session; an interim result is revised in place at its own index across events, and a new
index never restates an earlier one. Word-diffing across indices is therefore solving a problem the
API does not describe: it can only ever do one of two things — correctly re-derive what plain
concatenation already gives for free, or (its actual risk) silently drop content when a later,
genuinely distinct segment happens to begin with the same words as an earlier one. The original
VS-70 report ("we we we also we also need…") is fully explained without any restatement theory: a
pre-VS-70 handler that appended each event's read onto a persisted accumulator instead of rebuilding
fresh would reproduce it from a single, ordinarily-revised interim result at index 0. VS-70's actual
fix — rebuild from index 0 every event — was correct and sufficient by itself; the merge/diff layered
on top of it was not required, is not supported by the spec, and is not exercised by any test that
reflects genuinely distinct, non-restating segments (the one existing test that does — two unrelated
phrases arriving at different indices — already passes with plain concatenation and needs no
change). The one place a real ambiguity survives is the committed-prefix boundary: whether a
recognizer restarted mid-utterance (Android does this after nearly every phrase, established by
VS-70's own proposal) ever re-hears and restates audio already committed. That is not answered by
the spec, the code, or any existing test, and captain's capture is exactly what will show it,
because a restart boundary is directly visible in the raw log as an `onend` followed by a fresh
`resultIndex` `0`.

## What Changes

- A dictation diagnostics capture in `packages/ui/src/lib/dictation.ts`: an in-memory, per-session
  log of every recognizer event (index, `isFinal`, transcript per entry) and restart boundary, plus
  the composer text after each one.
- A way to turn it on and get the log out: off by default, a settings- or debug-level toggle to
  enable it, and a copy-to-clipboard control once a session has recorded something. No network
  call, no server persistence, no capture at all while the toggle is off.
- **No change to dictation's merge/duplication behavior in this change.** `mergeTranscript` and the
  within-event loop are untouched here; the reasoning above is recorded so the follow-up starts from
  it rather than re-deriving it, but it is not implemented until captain's capture confirms or
  refutes it.

## Capabilities

### New Capabilities

- `conductor-chat/dictation-diagnostics`: a captain-triggered capture of the raw dictation event
  stream, off by default, copyable to the clipboard, never sent anywhere on its own.

### Modified Capabilities

(none)

## Impact

- `packages/ui/src/lib/dictation.ts`: adds capture recording around the existing `onresult`/`onend`
  handlers, without changing their behavior.
- A settings- or debug-level toggle and a copy-to-clipboard control in the web app.
- `packages/ui/src/test/dictation.test.tsx`: new tests for the capture; all existing tests must stay
  green, unchanged, because nothing about dictation's actual behavior changes in this PR.
- The dictation merge/duplication fix itself, and its regression test, are out of scope for this
  change and follow once captain's capture exists.

## Verification

`pnpm typecheck`, `pnpm lint`, `pnpm test` green. The PR states plainly that this ships
instrumentation, not the fix, and asks captain to enable diagnostics, dictate the same reported
sentence, and paste back the exported log so the actual fix can be scoped from evidence.
