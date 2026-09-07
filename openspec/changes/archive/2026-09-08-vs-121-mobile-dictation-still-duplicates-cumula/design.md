## Context

See proposal.md for why this ships as instrumentation now and a fix later. This document covers
the capture's design, and records the answer to the one structural question this change *can*
settle without captain's data: where `mergeTranscript` belongs.

Ground truth already established by reading the code (ambient, not to be re-derived later):

- `onresult` rebuilds `text` by folding `mergeTranscript` across `e.results[0..length]` every event,
  then folds `mergeTranscript(committed.current, text)` before calling back. `onend` folds a finished
  session's text into `committed.current` the same way before restarting.
- `mergeTranscript(acc, next)` replaces `acc` with `next` only when every word of `acc` is an exact,
  in-order prefix of `next`'s words; anything else appends.
- `useDictation.start()` has no guard against being called while a session is already active or
  wanted — a separate, already-verified defect, unaffected by anything in this document, still to be
  closed in the follow-up regardless of what captain's capture shows.

## Goals / Non-Goals

**Goals:**
- Capture, from one real dictation session, everything needed to settle both open questions at
  once: whether the within-event index loop should plainly join, and whether a restarted session
  ever restates already-committed audio.
- Make the capture safe to ship and to leave in the codebase indefinitely: off by default, no
  network exposure, explicit opt-in and explicit copy-out.
- Leave dictation's actual behavior bit-for-bit unchanged — this change observes, it does not alter.

**Non-Goals:**
- Implementing the merge/duplication fix, or changing `mergeTranscript`'s behavior at all.
- A general-purpose event logger for other parts of the app — this is scoped to one hook.

## Decisions

**Where `mergeTranscript` belongs, decided from the API contract, not a device guess.** The
within-event index loop should plainly concatenate each index's current transcript
(trim, filter empty, join with a single space) rather than run them through `mergeTranscript`. Per
the Web Speech API, `SpeechRecognitionResultList` entries at different indices are distinct,
sequential, non-overlapping segments; an interim entry is updated in place at its own index across
events until it turns final, so a fresh read of the array each event already reflects any revision
without needing a diff. Word-diffing across indices adds a real, demonstrated risk instead: a later,
genuinely unrelated segment that happens to begin with the same word(s) as an earlier one is
misread as a restatement and the earlier segment is silently dropped — the conductor's finding, and
the reason the earlier tail-tolerance proposal (which would have made this strictly more likely, not
less) was withdrawn rather than refined.

*Confidence:* the API contract makes this true regardless of device. What is genuinely unconfirmed —
because it depends on undocumented, implementation-specific restart/audio-capture behavior — is
whether the **committed-prefix boundary** (`mergeTranscript(committed.current, text)` in `onresult`,
and the equivalent fold in `onend`) needs to stay a diff or can also become a plain join. Nothing in
the spec, this codebase, or its existing tests settles that; the existing restart test only ever
exercises purely additive restart content ("the different" → "the different services"), never
overlapping content. This change does not decide it. It is exactly what the capture is for: a
restart boundary is visible in the raw log as an `onend` immediately followed by a fresh
`resultIndex` `0`, and comparing what that fresh session first reports against what was already
committed will show directly whether restatement across a restart is real.

**Capture data shape.** Per dictation session, an ordered, capped (e.g. last 500 entries) in-memory
log of:
- `{ kind: 'result', resultIndex, entries: [{ isFinal, transcript }], sessionTextAfter, composerTextAfter }`
- `{ kind: 'end', restarted: boolean, committedAfter }`
- `{ kind: 'start' }`

This is enough to reconstruct, event by event, exactly what the recognizer sent and what the
composer showed after each step — both open questions from one recording.

**Surfacing it.** Off by default; a settings- or debug-level toggle turns it on for the session; a
copy-to-clipboard control appears once there is something captured. No toggle means no recording at
all, not merely a hidden one, so there is no always-on cost or privacy surface for anyone who never
turns it on. Nothing is written to a server or sent over the network by this feature; the only way
data leaves the device is captain pasting what they copied.

*Alternative considered and rejected:* auto-upload the capture to the daemon on stop. Rejected —
unnecessary network surface and persistence for a debug tool captain already has to be present to
trigger; clipboard keeps the human deliberately in the loop for what leaves the device, matching how
the rest of the app treats dictation audio (never sent anywhere without an explicit provider).

## Risks / Trade-offs

- [Capture code sits inside a hook that already has real, unrelated bugs] → Mitigated by keeping it
  a passive recorder that only reads state already being computed and never changes control flow;
  every existing dictation test must pass unchanged, proving behavior is untouched.
- [Unbounded memory if a session runs a long time] → The log is capped; oldest entries drop first.
- [This still does not fix anything captain will notice on their next dictation] → Deliberate,
  stated plainly in the proposal and the PR: this ships ground truth, not relief, and the follow-up
  is scoped the moment the capture exists.

## Migration Plan

None — client-only, additive, opt-in. Nothing to roll back beyond reverting the commit.
