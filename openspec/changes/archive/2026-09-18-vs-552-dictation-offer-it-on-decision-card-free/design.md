## Context

See `proposal.md` — Why.

Current state that shapes the approach:

- V2 has exactly one orchestration hook for dictation, `useDictationController`
  (`packages/ui/src/lib/dictationController.ts`), built on `useDictation`
  (`packages/ui/src/lib/dictation.ts`). It owns start/stop/cancel, the reveal, the queued send and
  the "too short" discard, so any surface that uses it shares the rule by construction.
- The V2 chat composer (`packages/ui/src/v2/ChatComposer.tsx`) renders the control inline: a mic
  button, a listening slot that replaces the textarea (voice meter, elapsed timer), a transcribing
  slot (VS-441) and error/notice lines. In the chat it drives the shared session from
  `DictationSessionProvider`; away from it (the Plan modal, tests) it drives a local one.
- The V2 decision card (`packages/ui/src/v2/DecisionCard.tsx`) renders its free-text surfaces as
  plain `<textarea>`/`<input>` elements in `InputControl` and in the "write your own" answer; none
  has dictation. `secret` is already special-cased everywhere.
- `DICTATION_MIN_WORDS` (`packages/ui/src/lib/dictation.ts`) is `6`; both composers consume
  `isDictationTooShort`, and the VS-439 work pinned it in `packages/ui/src/test/dictationRule.test.ts`
  and in prose in several tests and comments.

## Goals / Non-Goals

**Goals:**

- Every free-text surface on the V2 decision card offers the same dictation control and behaviour as
  the V2 chat composer, in the chat and on Needs you.
- One implementation of that control, reused by the composer and the card, so it cannot drift.
- One minimum-word constant, `3`, shared by the V1 composer, the V2 composer and the card.

**Non-Goals:**

- The V1 `DecisionCard` still rendered on the ticket page is unchanged. The ticket names the chat
  and Needs you, and both render the V2 card; V1's free-text answer, revise and override already
  route through the shared V1 `Composer`, which has dictation, and Part 2's single constant still
  governs it. Adding a second control to the V1 card would create exactly the drift this ticket
  warns about.
- `secret` inputs are keyboard-only by design and are not touched.
- The card's control-chrome textareas — the override reason, the revise request, the merge
  "request changes" text and the discard confirmation — are unchanged. The ticket enumerates the
  card's answer-bearing free-text surfaces (the free-text answer, `text`/`multiline` inputs and the
  `allowOther` answer), and those are the scope.
- The speech backend, the VS-425 reveal timing, the VS-489 cancel semantics and the VS-494
  stop/auto-send split are unchanged.
- No server, API, schema or draft-store change.

## Decisions

### Extract one shared V2 dictation control, do not write a card-specific one

Add `packages/ui/src/v2/DictationControl.tsx` holding the presentational pieces the composer already
has — a mic button (`aria-label`/`aria-pressed`/disabled states, V2 sizing) and an in-progress/notice
renderer (listening meter or "Listening…", the transcribing indicator, error and notice lines) —
plus a `useFieldDictation` hook that wraps `useDictationController` for a field with no send
(`submit` a no-op, `canSubmit` false, `hasFiles` false). `ChatComposer` swaps its inline markup for
these pieces without changing behaviour; `DecisionCard` uses them for each free-text surface.

Alternative considered: give the card its own small dictation implementation. Rejected — the ticket
requires the same control and behaviour, and a parallel implementation is what drifts.

Alternative considered: use the shared thread session from `DictationSessionProvider` for card
fields. Rejected — that session writes into a thread's draft store (`lib/drafts`) and is targeted at
a thread; a card field is not a thread draft. The card takes a local session, exactly as the Plan
modal already does (VS-450).

### Card fields use a local session, and the field swaps to the shared in-progress state

Each card free-text surface owns a local `useFieldDictation` session. While it listens or
transcribes, the field renders the shared in-progress indicator in its place and returns with the
transcript, mirroring the composer's slot for the same start/stop affordance and in-progress state.
The transcript inserts after existing text through the controller's existing append behaviour, and a
transcript below the threshold restores the field, as on every other surface.

### The threshold is one constant

`DICTATION_MIN_WORDS` becomes `3` in `packages/ui/src/lib/dictation.ts`. Both composers call
`isDictationTooShort`, and the card's controller does too, so no second threshold is introduced. The
existing too-short notice already names no number and is unchanged; comments and tests that state
"five words or fewer" or pin `6` are updated to the new rule.

## Risks / Trade-offs

- [Extracting the composer's control changes composer behaviour] → move only the presentational
  pieces and the health/controller plumbing; the existing `v2chatcomposer`, `dictation`,
  `v2dictationsession` suites must pass with no changes other than the VS-439 threshold updates.
- [Several card fields, each a local session, each probing `/api/health`] → the same probe the Plan
  modal already makes; sessions are cheap and only one microphone is open at a time because a
  start comes only from that field's own control.
- [A card field inside the shared session provider could pick up the global chord] → the card's
  session is local and never registers as the provider's target, so the chord continues to target
  the composer; no shared target changes.
- [Lowering the threshold lets a two-word message through where it used to be dropped] → that is the
  requested behaviour: "yes do that" survives while a single stray word is still discarded.

## Migration Plan

None — a UI-only change with no persisted state. It ships with the normal web build.

## Open Questions

None.
