## Why

A worker's pull request is opened as a **draft**, and the ticket then moves to `in_review`, where the
system raises a human-owned `merge_approval`. A draft pull request cannot be merged, and — because
this repository's CI only runs on non-draft pull requests — it has no check results to review either,
so the card is raised against work no one can judge or land. The weaver has to spot the draft, put a
`waitingOn` on the card, and ask the worker to mark the pull request ready. This is not a worker
discipline problem: a charter rule has been in force for the role that did it again on 2026-10-28,
and eight pull requests across three roles have arrived as drafts anyway. The draft is a property the
daemon chose (VS-393), so the daemon must stop producing a card it knows cannot be actioned.

## What Changes

- **A ticket's pull request is opened ready for review, not as a draft.** The one daemon path that
  opens it, `weave_ticket_open_pull_request` → `tickets.openPullRequest`, stops asking the forge for
  `draft: true`. The worker delivery skill stops telling workers to leave it a draft, and the tool's
  description stops promising one.
- **The daemon corrects a draft before it raises a merge approval.** When a ticket enters `in_review`
  and its open pull request is still a draft — because a worker opened it out of band, or because an
  existing draft was reused — the daemon asks the forge to mark it ready before the `merge_approval`
  is created.
- **A draft that cannot be corrected blocks the card, not the other way round.** If the forge
  positively reports the pull request is a draft and marking it ready fails, the `in_review`
  transition is refused with an actionable error naming the pull request, so no merge card is ever
  raised for a pull request that cannot be merged. The stranded-card repair path applies the same
  rule before re-raising.
- **The landing step keeps its mark-ready as a backstop.** `attemptArchiveThenMerge` already brings
  the PR out of draft before it reads checks (VS-393); it stays, so pull requests opened before this
  change — and archive-backfill PRs, which have no human card — still land. Archive-backfill PRs stay
  drafts because the daemon lands them without a human card.
- **Docs.** The worker delivery skill, the `weave_ticket_open_pull_request` description and
  `docs/PLAN.md` §11.4 describe the ready-for-review flow and the one CI run it starts.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `ticket-delivery/pull-request`: a ticket's pull request is opened **ready for review**, not as a
  draft; a merge approval is never raised for a pull request the forge reports as a draft — the daemon
  brings it out of draft first, and refuses the transition with a reason when it cannot.

## Impact

- `packages/core/src/tickets/service.ts` — `openPullRequest` stops passing `draft: true`; the
  `in_review` gate and `repairApprovals` ensure the pull request is ready before a merge card exists.
- `packages/core/src/forge/gh.ts` — unchanged API; `markPullRequestReady` and `prState`'s `isDraft`
  are already there.
- `packages/server/src/tools.ts` — the tool description.
- `skills/weave-ai-worker/references/delivery.md`, `docs/PLAN.md` — the delivery procedure.
- `packages/core/src/tickets/tickets.test.ts` — the opening test flips to non-draft; new tests pin the
  correction and the refusal. `packages/server/test/tools-open-pr.test.ts` keeps its forwarding test.
- No schema, config or HTTP API change. Archive-backfill PRs and the CI workflow's draft guards are
  untouched.
