## Why

VS-111 fixed the web `DecisionCard`'s hard-coded Hold/Discard buttons, which sent option keys their
decisions did not accept, and added `NAMED_CARD_OPTION_KEYS` (`packages/shared`) as the one source of
truth for what key each named decision kind's real options use. The same audit found the identical
class of bug, structurally worse, in `packages/render`'s `decisionToCard` — shared by the TUI
(`conductor chat`, `conductor attach`). Its `DEFAULTS` table disagrees with the real options on three
of four named variants, so three of the TUI's primary decision buttons currently fail every time they
are pressed: merge-approval's Hold (never valid to begin with), hire-approval's first-listed "Hire"
button, and both of discard-approval's "Discard" and "Keep" buttons.

## What Changes

- Align `packages/render/src/decision.ts`'s `DEFAULTS` keys for `merge_approval`, `hire_approval` and
  `discard_approval` to `NAMED_CARD_OPTION_KEYS`, the same map `packages/core`'s decision creation and
  `packages/ui`'s buttons already cite, so a decision kind's valid keys have one source across
  `packages/core`, `packages/ui` and `packages/render`.
- Remove the merge-approval card's Hold option outright, with no replacement: it never sent a key any
  merge-approval decision accepts, and a human who wants to defer can simply not act on a pinned
  decision — it stays open and answerable later from the TUI, the web app, or `Needs you`. Hire and
  discard approvals keep both of their buttons; only their keys were wrong, and both options are real,
  working answers, unlike Hold.
- Add a `packages/render` test, mirroring the pattern VS-111 added in `packages/core` and
  `packages/ui`, asserting the corrected `DEFAULTS` keys for every named variant match
  `NAMED_CARD_OPTION_KEYS` exactly — so this class of bug cannot silently return.
- Update `packages/render`'s golden `decision.test.ts` expectations for the three affected variants.

**BREAKING**: none — this only fixes buttons that already failed every time they were pressed; no
currently-working answer path changes key or disappears (Hire and Keep keep working, just with a
corrected key under the hood).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `human-decisions/approval-integrity`: the existing requirement "A decision card never offers an
  action its decision does not accept" gains scenarios covering the TUI's `decisionToCard` — today the
  requirement's scenarios only cover the web card VS-111 fixed, while the TUI card was left with the
  same defect the requirement is meant to rule out.

## Impact

- `packages/render/src/decision.ts` — `DEFAULTS` table and, if needed, `mergeOptions()`.
- `packages/render/src/decision.test.ts` — golden tests for `merge_approval`, `hire_approval`,
  `discard_approval`, plus a new regression test against `NAMED_CARD_OPTION_KEYS`.
- No change to `packages/tui` itself: `Chat.tsx`'s answer path and `DecisionCardView` already render
  whatever `decisionToCard` gives them, so a corrected card model fixes the TUI with no code change
  there. No change to `packages/core` or `packages/ui` — VS-111 already aligned those.
