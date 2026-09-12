## 1. Read a message's decision card part

- [x] 1.1 Add `decisionCardPartsOf(parts)` to `packages/render/src/attachments.ts` (or a new
      `packages/render/src/parts.ts` beside it) that returns the well-formed `type: 'card'` parts
      whose `ref.kind === 'decision'`, typed for `title`, `body`, `actions` (`key`, `label`,
      `style`) and `ref.id`, and export it from `packages/render/src/index.ts`. Verify with a unit
      test that it picks a real card part out of a mixed `parts` array, returns its options and ref,
      and drops `null`, non-objects, text/attachment parts and a card with no decision ref.
- [x] 1.2 Verify the whole route through `packages/render`'s test file passes
      (`pnpm vitest run packages/render`) and that `attachmentPartsOf` is untouched.

## 2. Anchor a decision to the message that carried its card

- [x] 2.1 In `packages/ui/src/lib/dispatch.ts`, build a `decision id → message id` map from every
      message's card parts (using 1.1) and consult it before `askedInRunId → run`, so a decision with
      a card message anchors there, a decision without one still anchors to its raising run, and the
      existing ordering rules are unchanged. Verify in `packages/ui/src/lib/dispatch.test.ts`: a
      decision with a card ref anchors under that message; a decision whose `askedInRunId` matches no
      message but whose card message exists still anchors; a card message wins over the raising run's
      message when both exist; the existing run-anchored tests are unchanged.
- [x] 2.2 Remove `unanchoredDecisions` from `ChatEntries` and from `chatEntries`'s return, and update
      the `dispatch.test.ts` cases that asserted it (`'leaves a decision with no matching run
      unanchored'`, `'defaults to no decisions when none are passed'`) to the new shape. Verify
      `pnpm --filter @weave-ai/ui exec tsc -b` reports no reference to `unanchoredDecisions` anywhere
      in `packages/ui`.

## 3. Render a card part inline, answerable

- [x] 3.1 Extract one `ChatDecisionCard` in `packages/ui/src/routes/Chat.tsx` that renders
      `DecisionCard` with the props the pinned cards already pass (`ticketIdentifier`, `projectSlug`,
      `ws`, `asker`, `busy`, `plan`, `ticketFiledByConductor`, `ticketSummary`, `compact`,
      `onAnswer` → `answerDecision`, optional `onHide`), and use it for both the pinned region and the
      inline cards, so the answer path is literally one function. Verify a UI test: answering the
      inline card calls `state.answer` with that decision's id and the chosen key.
- [x] 3.2 In `ChatMessage`, render each card part from 1.1 as a `ChatDecisionCard` driven by the
      matching decision in the `decisions` query, for an open decision as an answerable card and for
      a closed one as the inert record. When a card is shown, suppress the message's
      `text`/`body` fallback so the question is not repeated as prose; when the card's decision is
      not loaded, render the card part's text instead of dropping it; a message with no card part
      renders exactly as today. Verify: a test asserts a card part renders its options and no prose
      copy of the same question, and a card part whose decision is absent still shows its text.
- [x] 3.3 Pass the decisions and helpers down so the inline card can be hidden like a pinned one.
      Verify a test asserts hiding an inline open card removes it, answers nothing, and still counts
      it in the hidden-from-chat line.

## 4. One decision is never two cards at once

- [x] 4.1 Add `packages/ui/src/lib/decisionVisibility.ts` exporting `READABLE_MIN_RATIO` (0.5),
      `READABLE_MIN_PX` (180, enough for the title and the first option), a pure
      `readablyVisible({ ratio, heightPx, visiblePx })` that is true at or above the ratio **or** at
      or above the pixel floor, and a pure `pinnedOpenDecisions(open, hiddenIds, onScreenIds)` that
      returns the open decisions not hidden and not readably on screen, applied to `ChatPage`'s
      `shown`. Verify with unit tests against ratio/height pairs directly: a one-pixel sliver is not
      readably visible; a card at 50% is; a card taller than the viewport with 180+ px showing is;
      an on-screen card is excluded from `pinnedOpenDecisions`; an off-screen one is included; a
      hidden one is excluded; an open decision with no card message is never excluded by the
      on-screen set.
- [x] 4.2 Add the `IntersectionObserver`-backed observer (rooted at the chat's `scrollEl`, with
      `threshold: [0, READABLE_MIN_RATIO]`) that reports each inline open card's on-screen state
      through `readablyVisible` into a `Set`, and degrade to an empty set when `IntersectionObserver`
      is unavailable or the scroll element is not attached. Verify UI tests install a fake
      `IntersectionObserver`: a card reported readably visible is absent from the pinned region, a
      sliver reported at the edge is not, and reporting it off screen puts it back in the pinned
      region.

## 5. Acceptance coverage

- [x] 5.1 Add the real-shape test to `packages/ui/src/test/chat.test.tsx`: a message whose `parts`
      carry a card ref for a decision whose `askedInRunId` matches no message, with the decision
      answered → the answered record renders after that message.
- [x] 5.2 Add a test that a card part renders its actions and that pressing one answers the decision
      its `ref` names (assert `state.answer` receives that id and key), and that answering an inline
      card resolves the same decision so the pinned region drops it.
- [x] 5.3 Add offline/queued coverage from the inline surface: a non-secret answer while offline
      enqueues `/decisions/<id>/answer`, and a secret-carrying answer while offline is never queued
      and toasts that it was not sent.
- [x] 5.4 Update the existing `chat.test.tsx` and `dispatch.test.tsx` cases whose asserted behavior
      this change replaces, and verify `pnpm --filter @weave-ai/ui exec vitest run` is green.

## 6. Verification and review artifacts

- [x] 6.1 Run `pnpm lint`, `pnpm typecheck`, and both suites; paste both suite blocks verbatim in the
      ticket's delivery comment (`pnpm test` runs the core/server suite and the UI suite; do not add
      the two totals together).
- [x] 6.2 Produce the review screenshot the ticket asks for — the chat with one open option card and
      one answered card in the same view — using the throwaway harness in
      `[[ui-screenshot-harness]]`, keep it uncommitted in the worktree, and report the absolute paths
      on the ticket for the human to read locally.
- [x] 6.3 In the same real browser, check the bottom-edge direction the design flags: bring an open
      card to the bottom edge so it suppresses the pin and watch the list and strip settle rather
      than alternate. State in the delivery report that this was looked at and what it did; if it
      oscillates, that is a finding to surface rather than hide.
