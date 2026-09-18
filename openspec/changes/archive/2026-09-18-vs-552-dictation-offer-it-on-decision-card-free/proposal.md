# Offer dictation on decision-card free-text answers, and discard only below three words

Tracker change for [VS-552](weave://tickets/VS-552). A `change` ticket.

## Why

Two related dictation items from captain's UI polish #2 roadmap block (2026-09-17/18):

1. **A decision card cannot be answered by voice.** The V2 chat composer offers dictation, but the
   free-text answer on a card with options, a `text`/`multiline` input and a `single_choice` input
   with `allowOther` in the V2 decision card do not. Answering a card in his own words should offer
   dictation exactly as the chat composer does, in the chat and on Needs you.
2. **The short-dictation discard is too aggressive.** `DICTATION_MIN_WORDS = 6` discards "yes do
   that" along with a cough. Captain wants a transcript discarded only below three words, so a
   two-word utterance is still treated as noise but three words survive.

## What Changes

- **Every free-text surface on the V2 decision card offers dictation** — the free-text answer on a
  card with options, a `text` input, a `multiline` input, and the written answer of a
  `single_choice` with `allowOther`. It is the same control and the same behaviour as the V2 chat
  composer: same start/stop affordance, same in-progress state, same insertion into whatever is
  already typed. A `secret` input stays keyboard-only and offers none.
- **The discard threshold drops from six words to three.** `DICTATION_MIN_WORDS` becomes `3`, so
  "yes do that" is inserted and a two-word utterance is still discarded with the existing notice.
  One constant governs both composers and the new card dictation; no second threshold is added and
  no test or user-facing string still asserts the old number.

## Capabilities

### New Capabilities

- `web-dictation/short-dictations`: the one shared minimum-word rule for voice dictation — a
  transcript below three words is discarded and the field restored, three or more words are
  inserted — applied by every dictation surface (V1 composer, V2 composer, decision cards).

### Modified Capabilities

- `web-v2/decision-card`: adds the requirement that the card's free-text surfaces (the free-text
  answer, `text`/`multiline` inputs, and the `allowOther` answer of a `single_choice`) offer the
  same dictation control and behaviour as the V2 chat composer, while a `secret` input does not.

## Impact

- `packages/ui/src/v2/DecisionCard.tsx` — the free-text answer textarea and the `InputControl`
  free-text branches gain a dictation control; `secret` excluded.
- `packages/ui/src/v2/ChatComposer.tsx` — its inline dictation control is extracted and reused, not
  reimplemented, so the card and the composer cannot drift.
- `packages/ui/src/v2/DictationSession.tsx` — unchanged in behaviour; the card uses a local
  dictation session, as the Plan modal already does (VS-450), because a card field is not a thread
  draft.
- `packages/ui/src/lib/dictation.ts` — `DICTATION_MIN_WORDS` `6` → `3`; the doc comment follows.
- Tests and comments that state the old number in words (`dictationRule.test.ts`,
  `dictation.test.tsx`, `v2chatcomposer.test.tsx`, `lib/dictationController.ts`,
  `components/Composer.tsx`, `lib/dictation.ts`) are brought in line; the card's new surfaces get
  coverage in the V2 decision-card suite.
- No server, API, schema or draft-store change.
