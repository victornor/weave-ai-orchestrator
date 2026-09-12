## Context

See `proposal.md` — Why. Two facts from the code shape everything below.

**The card is already on the message.** `decisionCard` (`packages/server/src/channels.ts:420`) builds
one `CanonicalPart` of `type: 'card'` carrying `title`, `body`, `actions` (each option's `key`, its
`label` and whether it is `primary`), and `ref: { kind: 'decision', id }`, then writes it as the
message's `parts` (`threads.outbound(SYSTEM, thread.id, message.text, { parts })`). The web chat has
exactly one consumer of `message.parts` today — `AttachmentGallery` — so nothing reads the card and
the message falls through to its `text` fallback. The channel manager pushes this message for **every
human-owned decision** on `decision.created`, before it is answered, and the message is never
removed, so the card message is the decision's own durable home in the thread.

**The anchoring is by run, and most decisions have no run message.** `chatEntries`
(`packages/ui/src/lib/dispatch.ts`) maps a decision to a message through `askedInRunId` →
`anchors(messages)`, which is the last outbound message of that run. Conductor turns usually post a
message, but worker runs post none; anything unmatched lands in `unanchoredDecisions`, which is
declared, populated, returned, and consumed nowhere. `ChatPage` builds its pinned list from the
decisions query directly, so `unanchoredDecisions` has no effect at all — including on answered
decisions, which is why captain sees four open cards and no record of the ones he answered.

## Goals / Non-Goals

**Goals:**

- An open decision with options renders in the chat where it was asked, answerable, recommendation
  marked, resolving the same decision everywhere.
- One decision never reads as two cards at once, and an open card is never out of reach.
- An answered decision is visible in the transcript whether or not its raising run left a message.
- `unanchoredDecisions` is gone, with the card's own `ref` named as what replaces it.
- Answering from the inline card takes the one existing answer path (offline queue and
  secret-carrying refusal included).

**Non-Goals:**

- The `Needs you` route and its cards (out of scope in the ticket; they work).
- Telegram's rendering of the same `parts`.
- Changing which decisions are pushed to the thread, or the copy `decisionCard` builds.
- Whether the weaver may close a card answered in prose (its own ticket).

## Decisions

### Decision 1 — Anchor a decision by the message that carries its card; delete `unanchoredDecisions`

`chatEntries` reads every message's `parts` for a `card` part and builds a `decision id → message id`
map from `ref.id`, consulted before the existing `askedInRunId → run` map. A decision with a card
message anchors there; a decision without one (a message shape from before the push existed, or a
decision never pushed) still anchors to its raising run exactly as today; a decision with neither is
simply not part of the conversation.

`unanchoredDecisions` is removed from `ChatEntries`. What replaces it is the card's `ref`: the
decision's own message is the durable home, so no decision that was pushed to the thread is ever
homeless, and the dead array stops pretending otherwise. This is deliberately not a "render the
leftovers in a fallback group" change: the existing requirement already says a decision attributable
to no message SHALL NOT be rendered in the conversation, and inventing a floating group to satisfy a
dead field would be new surface the ticket did not ask for.

*Alternative considered:* keep `askedInRunId` as the only anchor and render `unanchoredDecisions` in
a group at the end. Rejected — it treats the symptom (decisions are homeless) rather than the cause
(the decision has a message; the code looked at the wrong one), and it would render worker decisions
in chronological limbo between unrelated messages.

### Decision 2 — Inline is the answerable card; the pin keeps what is not on screen (Option 3)

The ticket's three options, weighed:

1. **Inline becomes the card, the pin goes away for that card.** Closest to captain's words, but a
   card raised twenty messages back scrolls out of reach — exactly what the pin comment
   (`Chat.tsx:321-329`) exists to prevent. Rejected on that risk.
2. **Both, pinned and inline, answering either resolves both.** Two full cards for one decision is
   the one thing the acceptance forbids ("One decision never reads as two"); the mobile screenshot
   would show the same question twice. Rejected.
3. **Inline renders answerable, and the pin suppresses any card currently on screen.** Chosen. The
   inline card is the only *visible* rendering while it is on screen; scroll it away and the pinned
   card reappears, so nothing is ever both duplicated and out of reach.

An open decision with a card message is rendered inline, answerable. `shown` (the pinned list)
becomes all open decisions minus the hidden ones minus those whose inline card is on screen; open
decisions with no inline card are never in that last set and so stay pinned exactly as today. An
answered carded decision renders inline as the inert record.

*How "one, not two" is guaranteed:* at most one of a decision's two possible renderings is visible
at a time — the pinned one renders only when the inline one is not intersecting the scroll viewport
— and the selection is a pure function of the open decisions, the hidden set and the on-screen set,
so it is the same on any device and after a reload.

### Decision 3 — Visibility via `IntersectionObserver` rooted at the chat's scroll container

`ChatPage` already owns the scrolling element (`scrollEl`, from `PageBody`). An observer created
with `root: scrollEl` watches each inline open card; a card reports `onScreen` on every intersection
change. A single wrapper component (`ChatDecisionCard`) owns the observer for its own card, so no
ref-identity churn leaks into the message list; the parent keeps a `Set<string>` of on-screen ids.

The selection is split so the harness cannot decide the behavior (the project convention: test the
underlying model as a pure function, verify the rest visually). `lib/decisionVisibility.ts` exports
`pinnedOpenDecisions(open, hiddenIds, onScreenIds): Decision[]` — a pure function with unit tests —
and the observer only supplies `onScreenIds`. When `IntersectionObserver` is unavailable, or the
scroll element is not yet attached, the set stays empty and the pin shows every open decision; that
is the safe direction (a card may be duplicated for a frame, but a waiting card is never hidden).

**"On screen" is "readably visible", not "intersecting at all."** A card with one pixel showing at
the edge of the viewport must not suppress the pinned copy, or the human has neither a readable
inline card nor the pinned one. The observer is created with `threshold: [0, READABLE_MIN_RATIO]`
and maps each entry through a pure `readablyVisible({ ratio, heightPx, visiblePx })`, which is true
when the card is at least `READABLE_MIN_RATIO` (0.5) visible **or** at least `READABLE_MIN_PX` (180,
enough for the title and the first option) of it is. That second clause keeps a card taller than the
viewport usable: the ratio can never reach 0.5 there, but a readable slice of it is enough to
suppress the pin. Both constants live in `lib/decisionVisibility.ts` with the reason in a comment,
and both `readablyVisible` and `pinnedOpenDecisions` are unit-tested against the ratio/height pairs
directly, so the threshold is behavior the tests own, not something only the browser decides.

*Why not track scroll geometry by hand:* the existing scroll listeners record reading position, not
per-card visibility, and a `getBoundingClientRect`-per-scroll computation in a list that can grow
mid-scroll is the kind of thing the convention says not to build to fit jsdom.

*Feedback note:* the suppression is stable in both directions because the viewport change is
monotone in the same direction as the visibility state. A card scrolling out at the top cannot be
pulled back by shrinking the list from the bottom. A card at the bottom edge is either readably
visible (suppressed) and stays so as the list grows, or not (pinned), and the strip appearing
shrinks the list from the same edge the card is already beyond, so it cannot flip into visibility.
The observer is rooted at the container, not the window, so the pinned region's own height change is
not itself a scroll. The bottom-edge direction is verified in the real browser during apply (task
6.3), since jsdom cannot stage it; the finding is stated in the delivery report either way.

### Decision 4 — `ChatMessage` renders card parts; the text fallback is suppressed only when a card is shown

`ChatMessage` gets the message's card parts (`decisionCardPartsOf`, added to `packages/render`
beside `attachmentPartsOf`) and the matching loaded decisions. For each card part it renders
`DecisionCard` with the decision's live state; the message's `text`/`body` is rendered only when no
card was shown, so the question never appears as a card and again as the `title\nbody` fallback. A
card whose decision is not in the loaded set (outside the query limit, or filtered out) renders the
card part's text instead, so nothing is lost. Text messages are unchanged: their `parts` are `[]`
and they render through `MessageBody` as today.

The part is used **only to find the decision** it refers to. Everything the card renders — options
with their descriptions, `allowFreeText`, `inputs`, `target`, recommendation — comes from the loaded
`Decision`, never from the part's `actions`, which carry only `key`, `label` and `style`. Building
options from the part would silently drop the per-option descriptions the asker wrote.

The same `ChatDecisionCard` wrapper and the same `answerDecision` callback are used by the pinned
cards and the inline cards, so the answer path (offline queue, secret refusal, stale handling) is
literally one function and cannot drift.

## Risks / Trade-offs

- **An `IntersectionObserver` per open inline card.** Bounded by the number of open decisions on
  screen (a handful); each disconnects on unmount. → Acceptable; the pin is capped at 200 decisions
  but only rendered cards observe.
- **jsdom has no `IntersectionObserver`.** The default suites would see an empty on-screen set and
  render both copies. → The pure `pinnedOpenDecisions` carries the behavior tests; the wiring tests
  install a fake observer; the visual claim is checked with a real-browser screenshot, per the
  project convention.
- **A stale/edited decision's inline card.** It is driven by the same live `decisions` query as the
  pin, so it updates with the pinned card; the observer follows the mounted element.
- **Two renderings in the DOM while one is off screen.** A screen reader or a DOM-diffing test can
  see both. → The requirement and the screenshot are about what reads on screen; the pin is inert
  while suppressed and the inline card is the answerable one.

## Migration Plan

UI-only; no data migration and nothing to roll back beyond the commit. The card message format is
unchanged, so old threads render correctly with the new code and the deleted `unanchoredDecisions`
field was never consumed.

## Open Questions

None. The layout choice (Decision 2) and the anchoring change (Decision 1) are made here; the ticket
explicitly delegates them.
