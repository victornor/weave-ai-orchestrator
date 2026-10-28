## Context

See `proposal.md` — Why. The relevant ground truth, verified on this branch:

- A ticket's pull request is opened in exactly one daemon path: the worker tool
  `weave_ticket_open_pull_request` (`packages/server/src/tools.ts:575`) calls
  `tickets.openPullRequest` (`packages/core/src/tickets/service.ts:1670`), which asks the forge for
  `draft: true` (`service.ts:1688`). The worker delivery skill repeats the instruction —
  `skills/weave-ai-worker/references/delivery.md:20-21` says "Open the PR as a draft" and "Leave the
  PR a draft". Any project's workers read this one skill, which is why a role charter saying the
  opposite changes nothing.
- The draft state is already readable: `ForgeAdapter.prState` returns `isDraft`
  (`packages/plugin-sdk/src/index.ts:45`, `packages/core/src/forge/gh.ts:257-269`) and
  `ForgeAdapter.markPullRequestReady` (`gh.ts:334`) brings a PR out of draft.
- The `merge_approval` is raised on the `in_review` transition itself
  (`service.ts:938-951`) and by `repairApprovals` (`service.ts:2227-2246`). Neither path reads
  `isDraft`; nothing in `tickets/` or `decisions/` does. The only `isDraft` consumers are the
  merge-slot supervisor (`supervisor/index.ts:1300`) and `attemptArchiveThenMerge`
  (`archive-before-merge.ts:352`).
- Approving a merge card transitions the ticket to `merging`
  (`decisions/service.ts:388-389`); the worker's landing marks the PR ready
  (`archive-before-merge.ts:316-318`) and only then reads checks. So the merge itself is not a silent
  no-op — the card is mechanically answerable — but the *review* the card depends on cannot happen:
  the PR is a draft and `.github/workflows/ci.yml` skips every job while
  `github.event.pull_request.draft` is true, so the delivered head has no checks to judge.
- VS-393 chose drafts deliberately to get one CI run per landing; its accepted design assumed the
  weaver reviews the card without needing CI on the delivered head. In practice the weaver does need
  it (it sets `waitingOn` and asks the worker to mark the PR ready), so the single-run premise does
  not hold under review-before-merge.

## Goals / Non-Goals

**Goals:**

- A worker that delivers normally — the tool, the skill's own steps — produces a pull request that
  is ready for review and whose CI has started, with no charter text involved.
- No `merge_approval` is ever raised for a pull request the forge reports as a draft. The daemon
  either corrects it first, or refuses the transition with a reason the worker can act on.
- Keep the landing step's mark-ready as the backstop for pull requests that existed before this
  change and for archive-backfill PRs.

**Non-Goals:**

- Changing the review or approval model. The card is still human-owned, still raised at `in_review`,
  and the weaver still reviews it.
- Retroactively fixing already-open merge cards that point at a draft (the fanflow ones). They are
  corrected when they next land, and the new code prevents new ones.
- Making the archive-before-merge CI wait real, or changing the merge queue.
- Re-running or reordering CI. The head that lands still gets its own run, because archiving changes
  it.

## Decisions

### Decision 1: Open the ticket's pull request ready for review (no `draft` flag)

`tickets.openPullRequest` stops passing `draft: true`; the forge is asked to create a normal pull
request. This is the ticket's stated first preference and the smallest system-level change: the
deterministic opener keeps ownership of the base branch, the idempotency check and the work-product
record, and the draft simply disappears from the request. The skill, the tool description and
`docs/PLAN.md` stop instructing a draft.

- *Alternative — keep `draft: true` and mark it ready on the `in_review` transition only:* rejected
  as the primary mechanism. It keeps a CI run off pre-delivery pushes, but it adds a forge call to
  every delivery and leaves the PR a draft until the transition, so an out-of-band push between
  `openPullRequest` and `in_review` still starts nothing. The opener being non-draft is simpler, and
  the `in_review` correction below still covers the case.
- *Alternative — have the worker run `gh pr ready`:* rejected. That is the charter rule again: advice
  a worker may or may not follow. The daemon owns opening the PR, so the daemon owns the state.

### Decision 2: The `in_review` gate corrects a draft, and refuses the transition when it cannot

Before the `in_review` transition commits and before the `merge_approval` is created, the daemon
resolves the ticket's open pull request and reads `prState`. When the forge reports
`state: 'open'` and `isDraft: true`, it calls `markPullRequestReady`:

- `changed: true` or `changed: false` (already ready) → proceed and raise the card as today.
- no `markPullRequestReady` on the forge, or the call fails, or the PR stays a draft → throw
  `OcError('pull_request_draft')` naming the PR URL and telling the worker to bring it out of draft
  and transition again. The write has not happened, so no card exists and the ticket is not
  `in_review`.

The gate is checked in the pre-write async section of `transition`, next to the existing `done`
unlanded-commits gate, and only when `to === 'in_review'`, the card would be raised
(`!autoMerge`, not quiet), and the ticket has a `pull_request` work product whose project is `pr`
delivery with a forge and a clone on disk. A forge that cannot be reached is not treated as a draft:
the transition proceeds and logs a warning, because refusing delivery on a forge read failure would
strand a worker for a network problem, and the landing path still corrects the draft. `repairApprovals`
runs the same check before re-raising a stranded card; a failure there is logged and no card is
raised that pass, so the next pass retries.

- *Alternative — raise the card but mark it "visibly blocked":* rejected. It would need the decision
  and card model to carry a new blocked reason and a disabled approve action, and the ticket's own
  acceptance allows "cannot raise a merge approval" instead. Refusing before the write keeps the
  invariant at one place and needs no UI change.
- *Alternative — only mark ready, never refuse:* rejected. Then a PR the daemon cannot mark ready
  (no adapter capability, forge error while drafting) still produces the dead card this ticket is
  about.
- *Alternative — gate on the worker's tool call rather than the transition:* rejected. A worker can
  still record a PR work product directly (`weave_ticket_work_product`) or reuse a draft opened out
  of band; the transition is the one point every delivery passes through.

### Decision 3: Keep the landing step's mark-ready and the archive-backfill draft

`attemptArchiveThenMerge` already calls `markPullRequestReady` after its final push and before
reading checks (VS-393). It stays: it is the backstop for PRs opened before this change, for a draft
reused on the branch, and for archive-backfill PRs. Archive backfills stay drafts — the daemon lands
them without raising a human merge card, so no human is shown a draft card for them.

### Decision 4: The forge adapter is unchanged

`prState`'s `isDraft` and `markPullRequestReady` already exist and are already used by the landing
path and the merge-slot supervisor. No new adapter method and no `gh` change is needed; this keeps
the change to the ticket service, the tool description and the delivery docs.

## Risks / Trade-offs

- **Two CI runs per landing instead of one.** → Accepted and stated. Review-before-merge needs
  checks on the delivered head, and the archive commit changes the head that lands, so the floor is
  two. The VS-393 wins that remain: no run on a push that precedes the PR, no run on push to `main`,
  and no run on later drafts. If this cost matters later, the answer is to archive before asking for
  review, which is a separate change.
- **A forge outage during `in_review` does not block delivery.** → Stated boundary: only a positively
  reported draft blocks; an unreachable forge proceeds, and the landing step still marks a draft
  ready. The alternative (block delivery on every forge read failure) would strand workers for
  network problems.
- **`pull_request_draft` is a new rejection a worker must handle.** → The message names the PR URL and
  the exact next step, and the normal opener no longer produces a draft, so it should only appear for
  out-of-band drafts. The worker can retry the transition after marking it ready.
- **Existing cards for draft PRs are not rewritten.** → Accepted; the card is corrected when the
  ticket lands, and the change prevents new ones. No historical rows are touched.
- **A reused draft PR is corrected only at `in_review`, not at open.** → Acceptable: the ticket is
  not yet reviewable at open, and returning the existing PR unchanged is the idempotency contract.

## Migration Plan

No schema, config or API change. Deploy is the existing daemon upgrade. On rollback the tool opens
drafts again; PRs already opened non-draft stay non-draft and land normally.

## Open Questions

None.
