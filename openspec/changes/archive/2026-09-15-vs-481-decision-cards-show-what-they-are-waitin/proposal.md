## Why

A merge approval held because runner CI is still running looks identical to one nobody has looked
at: captain has twice asked why cards were not reviewed while the weaver was, in fact, waiting on
CI. The information exists — the supervisor records `ciState`, `ciHead`, `prChecks` and `mergeState`
on the ticket's delivery — but no card renders it, and the weaver has no way to record what it is
waiting on other than leaving the card unmarked.

## What Changes

- **Live CI status on every `merge_approval` card.** A compact chip derived from the ticket's
  recorded check rollup, rendered wherever the card renders (Needs you, the chat pane, the ticket
  page) and updated from existing ticket events, with no new GitHub polling from the UI:
  - `Waiting for CI · 2/4` while checks are queued or running, naming the pending checks on expand;
  - `CI passed` when every check succeeded;
  - `CI failed · lint` when any check failed, naming it;
  - `CI skipped` when every check was skipped — all-skipped is explicitly not a pass;
  - `CI on an older commit` when the recorded CI head differs from the head the card approves.
- **Per-check detail on the delivery record.** The forge read that already produces the tally also
  produces the individual checks (name + state) and the pull request head, so the chip can name what
  is pending or failed without asking GitHub again.
- **An optional `waitingOn` on the weaver's review mark.** `weave_decision_review` accepts a short
  `waitingOn` (≤120 chars) for both `looked` and `concerns`; the card renders it as its own line
  ("Weaver: waiting for runner CI on 414b329d"). It clears when the weaver marks again, or when the
  card's head or plan revision changes.
- **Unseen cards keep their wording** and additionally show the CI chip when checks are still
  pending, so "nobody looked" and "we are waiting on CI" are distinguishable.

## Capabilities

### New Capabilities
(none — this change only extends existing behavior)

### Modified Capabilities
- `human-decisions/conductor-review`: the review mark gains an optional `waitingOn` statement, with
  its clearing rules.
- `web-v2/decision-card`: the card gains the live CI chip and the weaver's `waitingOn` line.

## Impact

- **Forge read** — `packages/core/src/forge/gh.ts` `prState` returns per-check detail; `ForgeAdapter`
  in `packages/core/src/forge/index.ts` and its fake grow the same field.
- **Supervisor** — `packages/core/src/supervisor/index.ts` writes the per-check detail and current
  head into `delivery_json` on both refresh paths.
- **Shared** — a pure CI-chip derivation (`ciChipCopy`) and the review-copy `waitingOn` field
  (`packages/shared/src/weaver-review.ts`); `Decision` and `WeaverReviewCopy` types.
- **DB** — migration adding `decisions.weaver_review_waiting_on`.
- **Core services** — `decisions.review` persists/clears `waitingOn`; the delivery-head reconciliation
  clears it when the head moves.
- **MCP** — `weave_decision_review` accepts `waitingOn` (`packages/server/src/tools.ts`).
- **Render/UI** — `CardModel` and `decisionToCard` carry the chip and the line; V2
  `packages/ui/src/v2/DecisionCard.tsx` (Needs you, chat) and the ticket page's
  `packages/ui/src/components/DecisionCard.tsx` render them; callers pass the ticket's delivery.
- **Docs/skills** — `skills/weave-ai-weaver/SKILL.md`, `templates/weaver.AGENTS.md.tmpl`,
  `docs/PLAN.md`, `docs/API.md`, `skills/weave-ai-worker/references/tools.md`.
