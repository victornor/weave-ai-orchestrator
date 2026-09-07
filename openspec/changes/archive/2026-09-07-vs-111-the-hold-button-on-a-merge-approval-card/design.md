## Context

`packages/ui/src/components/DecisionCard.tsx` renders four decision kinds (`plan_approval`,
`merge_approval`, `hire_approval`, `discard_approval`) as "named variants" with purpose-built buttons,
rather than the generic option-list UI (`human-decisions/option-cards`). Each button's `onClick` calls
`answer(<literal key>)` written by hand, independently of the options `packages/core` actually attaches
when it creates that decision (`tickets/service.ts` for `plan_approval`/`merge_approval`,
`roles/index.ts` for `hire_approval`/`discard_approval`). `decisions.answer` (`decisions/service.ts:334`)
throws `OcError('validation', 'unknown option "<key>"')` for any key not among `d.options`.

Established behavior today, confirmed by reading the code (no live CLI needed — this is pure
TypeScript control flow, no runtime credential involved):

- **Hold** on a merge-approval card calls `answer('hold')`. `merge_approval`'s real options are
  `approve`/`changes` only, so the daemon rejects it with the `unknown option "hold"` validation
  error. `Chat.tsx`'s `answerDecision` and `NeedsYou.tsx`'s `onAnswer` both catch this as a non-network
  error and show a toast ("Could not record that answer" / "Not sent") naming that message; the
  decision stays open, `busy` clears, and the same Hold button is offered again. Nothing is silently
  dropped — but the toast is easy to miss, and the button's label promises something it cannot do.
- **Discard** on a discard-approval card calls `answer('discard')`. `discard_approval`'s real options
  are `approve`/`reject`, so this fails exactly the same way and has never worked.

## Goals / Non-Goals

**Goals:**
- Make every hard-coded card action send a key its decision actually accepts.
- Make that class of bug mechanically detectable in the future, not just fixed for these two cases.

**Non-Goals:**
- Redesigning `DecisionCard` to render `NAMED_VARIANTS` generically from `decision.options` (labels,
  icons and layout are bespoke per kind by design — see `option-cards` vs. named variants split).
- Any change to `plan_approval`'s or `hire_approval`'s buttons — both already match their decision's
  real options; the audit found no drift there.
- Adding a decision status or lifecycle concept for "answered but still actionable later" — see the
  Hold decision below.

## Decisions

### Hold: remove it, don't make it a real option

Two ways to make Hold not lie: give merge approvals a real `hold` option, or remove the button.

Making `hold` real would require `decisions.answer` to record an answer that does *not* close the
decision the way every other answer does (`inert = decision.status !== 'open'` in `DecisionCard.tsx`;
`applyMergeApproval` currently treats anything that isn't `approve` as "send it back to `in_progress`").
The ticket's own acceptance criteria describe this as leaving the ticket "in review without landing or
sending back" — i.e. a decision that is answered, yet still open, still pinned, still actionable. That
is a new decision-lifecycle state, not a new option, and it duplicates what hiding a card already does:
VS-72's hide/dismiss takes the card out of the pinned region without answering it, the decision stays
open and unanswered, and it is still reachable from `Needs you`. Hiding is "think about this later"
already shipped and already tested; inventing parallel semantics for the same intent adds a second,
inconsistent path to the same outcome for real risk (an `answered`-but-still-open decision is a state
the rest of the decisions code, and every consumer of `decision.status`, does not expect).

**Decision:** remove the Hold button. No new decision state, no core change to `applyMergeApproval` or
`decisions.answer` needed for this.

### Discard: fix the key, not the option

`discard_approval`'s options (`approve` / `reject`) already express exactly what the card needs
("go ahead" vs. "keep it") and `applyDiscardApproval` already branches on `key === 'approve'`. The
fix is a one-line change to what the Discard button sends, not a new option.

### A canonical, shared key list closes the drift path

Add one map of decision kind → the option keys its hard-coded card is allowed to send, in
`packages/shared` (already a dependency of both `packages/core` and `packages/ui`, per the repo's
boundary rules — `core` may not import `ui` or vice versa, but both may import `shared`). `packages/core`
cites this map's keys instead of free-floating string literals when constructing `plan_approval`,
`merge_approval`, `hire_approval` and `discard_approval` decisions (there are two call sites for
`merge_approval`: `tickets/service.ts`'s `in_review` transition and its `repairApprovals` re-raise —
both already duplicate the same literal array and both move to the shared map).

This does not make the UI *read* `decision.options` at render time (Non-Goals), but it does mean the
one place a card's literal keys are written (`DecisionCard.tsx`) and the one place a decision's real
options are declared (`packages/core`) cite the same constant, so a future edit to one that isn't
mirrored in the other is a type/test failure, not a silent drift caught only by a human clicking the
button in production.

### Test strategy

- `packages/core`: existing tests already assert `decisions.create` is called with
  `kind: 'merge_approval'` / `'plan_approval'` / `'hire_approval'` / `'discard_approval'`
  (`tickets/tickets.test.ts`, `roles/roles.test.ts`). Extend those assertions to check the created
  decision's `options.map(o => o.key)` against the shared map for that kind — this is what AC 5 means
  by "a real merge-approval decision's options": the actual decision the ticket transition produces,
  not a hand-rolled fixture.
- `packages/ui`: a new test in `components.test.tsx` renders each `NAMED_VARIANTS` card kind with a
  `decision()` fixture carrying that kind's real options (sourced from the same shared map, not
  duplicated by hand), fires every rendered action button, and asserts the key `onAnswer` receives is
  a member of that map's list for the kind under test. This is the general rule from AC 3: it fails
  for any current or future named-variant card whose button sends a key the map does not list for that
  kind — which is exactly what would have caught both the Hold and the Discard bugs before they shipped.

## Risks / Trade-offs

- **A future named-variant card kind forgets to add itself to the shared map** → the new test only
  covers kinds present in the map; nothing forces a new kind to be added. Mitigated by keeping the map
  and the `NAMED_VARIANTS` array next to each other in intent (the design doc and the code comment
  both point at one another), but this is a documentation-level guard, not a compiler-level one — an
  acceptable trade-off given the alternative (deriving buttons from `decision.options` generically) is
  explicitly out of scope.
- **Removing Hold changes a button captain has been clicking** → captain has been told, in the PR
  description, exactly what the button did before (silently failed) and that hiding the card is the
  replacement gesture for "not now."
