## Context

See proposal.md — Why. VS-568 (`packages/core/src/promotion/index.ts`) computes the promotion range,
raises a project-scoped `promotion_approval`, and on a human answer pushes the landing head straight to
the default branch with `git push origin <head>:refs/heads/<default>`.

The forge adapter (`packages/plugin-sdk/src/index.ts`'s `ForgeAdapter`, implemented by
`packages/core/src/forge/gh.ts`'s `GhForge`) already knows how to find an open pull request for a
branch (`pullRequestForBranch`), open one (`createPullRequest`, used non-draft), read its state and
checks (`prState`), and merge it (`mergePr` with `--merge`/`--squash`/`--rebase`). The ticket landing
path (`attemptArchiveThenMerge`, `packages/core/src/tickets/archive-before-merge.ts`) already encodes the
required-checks wait, the no-CI grace and the merge, but it is entangled with OpenSpec archiving, which a
promotion has none of.

`decisions.service.ts` calls `promotion.execute` *before* recording the human's answer, so a refusal
leaves the card open. `PromotionStatus` (`packages/core/src/api.ts`) carries the range and the project's
notes; `waitingTickets` already skips a ticket whose `delivery.promotedAt` is set.

## Goals / Non-Goals

- Goal: a promotion lands through a pull request when the repository requires one, with no route that
  bypasses a repository rule.
- Goal: safe by default — no project silently gets a direct push where a forge is available.
- Goal: honest content — the tree diff and the tickets, not a commit count that squash invalidates.
- Non-goal: automating the promotion (the human's approval is still the only trigger), and the
  back-merge (`main` → `edge`), which stays the project's own workflow.
- Non-goal: reading or changing repository rulesets, environments or protections.

## Decisions

1. **Strategy is a project policy, resolved safe by default.** `ProjectPoliciesSchema` gains
   `promotionMode: 'auto' | 'pull-request' | 'direct-push'` (default `auto`) and `promotionPrTitle`
   (optional). `auto` resolves to `pull-request` when a forge adapter that can `createPullRequest` is
   registered and `detect(clonePath)` resolves true, otherwise `direct-push`. `direct-push` is an
   explicit opt-in for a project whose policy allows it, and is the behaviour of the VS-568 tests and of
   a project with no forge remote. Rationale: GitHub branch protection is the reason this ticket exists,
   so the forge path must be the default wherever a forge can act; a scratch repository (tests) has no
   forge and keeps the old path. Alternative considered — keying only on the origin URL host — rejected
   because it cannot be exercised by a scratch repository and would misclassify a self-hosted forge.

2. **A rejected direct push names the pull-request path.** The direct-push branch keeps its synchronous
   push and, when the remote refuses, the held reason appends "this repository requires promotion
   through a pull request" (or, when no forge is available, that the forge must be reachable). The card
   stays open with the remote's own reason, as today, but is no longer a dead end.

3. **Open or reuse one pull request.** The promotion reuses `forge.pullRequestForBranch(clonePath,
   landing)`; if none, `fork.createPullRequest({ branch: landing, base: defaultBranch, title, body })`
   non-draft (a draft would not run or merge). The ticket list is the same `waitingTickets` set the card
   shows. A promotion never opens a second pull request for the same landing branch.

4. **The body fills the repository's template honestly.** A new pure module
   `packages/core/src/promotion/pr-body.ts` reads the first template it finds in the clone from
   `.github/PULL_REQUEST_TEMPLATE.md`, `.github/pull_request_template.md`, `.github/PULL_REQUEST_TEMPLATE/*.md`,
   `docs/PULL_REQUEST_TEMPLATE.md`, `PULL_REQUEST_TEMPLATE.md`, and builds the body from:
   the template's own headings and guidance, the promotion's tickets (identifier, title), the tree-diff
   summary, the project's `promotionNotes`, and the commit list labelled detail. Section handling is
   deterministic: a known heading (change/summary/description, testing/verification, safety/db/migration)
   receives the daemon's facts; every other section keeps its template text but has unfilled guidance
   replaced by `_Requires human confirmation._`; a section the daemon cannot fill is never left blank and
   no claim is ever invented. With no template, a generated body is used. Alternative considered — posting
   the facts as a comment and leaving the template untouched — rejected: the required section stays blank,
   which is exactly what the ticket forbids.

5. **Merge method comes from policy, checked against the repository.** Add optional
   `ForgeAdapter.repoMergeSettings?(cwd)` returning `{ merge; squash; rebase } | null`; `GhForge`
   implements it from `gh api repos/{owner}/{repo}` (`allow_merge_commit`/`allow_squash_merge`/
   `allow_rebase_merge`) through a pure exported parser. The promotion uses the project's `mergeMethod`
   when the repository allows it, otherwise the first allowed in squash → merge → rebase order, and
   records which it used on the card and the promotion record. `null` (the forge cannot say) uses the
   configured method and surfaces any merge refusal as a hold. No method is ever forced through.

6. **Checks are awaited by the daemon, and an in-flight promotion is recorded.** `execute` validates the
   reviewed head, opens/reuses the pull request and resolves the method. If required checks are already
   green (or the repository has no CI), it merges and finalises. If checks are pending, it persists an
   in-flight promotion (`state`, `prUrl`, `mergeMethod`, landing/default heads, `updatedAt`) into the
   decision's existing `target_json.promotion` and returns — the human's answer is then recorded as the
   authorization. A supervisor sweep, `promotion.advance()`, runs on the same tick as the merge-slot
   poll: for each answered `promotion_approval` whose record is in flight it re-reads the pull request
   and, when checks are green, merges and finalises; on a failed check, a refused merge, or a landing
   head that moved past the reviewed one it marks the record held with the reason. Rationale: the
   merge-slot path already returns `checks_pending` and waits across sweeps rather than holding an HTTP
   answer; reusing that pattern keeps the human's tap from blocking for minutes. Alternative considered —
   leaving the card open and re-running `execute` on later sweeps — rejected: without a recorded answer
   the daemon has no authorization to act, and the human would have to tap again. Alternative — a new
   `promotions` table — deferred: `target_json` already holds the promotion target and needs no migration.

7. **Content is the tree diff, and closure is squash-aware.** `status` computes the promotion content as
   `git diff --numstat <defaultRef> <landingRef>` (the tree difference between the two heads), summing
   files, insertions and deletions. The bare tree diff rather than the merge-base three-dot is used
   because it is empty once landing's content is on the default — a squash that rewrote the commits —
   whether or not the project back-merges, so "nothing to promote" reads correctly even when
   `rev-list --count` is still non-zero. `ahead`/`commits` stay in the payload as labelled detail.
   `canPromote` requires a non-empty content diff and, for `direct-push` only, a fast-forward (`behind`
   zero); a pending pull request can carry `behind` without being held. On finalise, the included tickets
   are stamped with `promotedAt` and the forge's merge commit as `promotedSha`, which is what keeps them
   out of the next card (the ancestry check alone would list a squashed commit again). Ticket statuses
   never change.

8. **The promotion surface reports the in-flight state.** `PromotionStatus` gains the content summary
   (`changedFiles`, `additions`, `deletions`) and an in-flight record (`state`, `prUrl`,
   `mergeMethod`, `heldReason`, heads, `updatedAt`), read from the latest promotion decision for the
   project. The project's Promote control shows the file count and tickets instead of the commit count,
   the pull-request link and state while in flight, and the held reason when held; a new card can be
   raised once a hold is resolved.

## Risks / Trade-offs

- **Real GitHub cannot be exercised from a ticket** → tests use scratch repositories and a fake forge;
  the parts that need the real forge (template path, allowed methods, source guard) are called out in the
  PR with manual verification steps for the next Fernwood promotion.
- **Template heading heuristics vary by repository** → the section map is conservative and unmatched
  sections get an explicit confirmation marker rather than a blank or a claim; a representative template
  is a fixture.
- **`gh` may lack permission to read repository merge settings** → `repoMergeSettings` returns `null` and
  the configured method is used; a refusal at merge time holds with the reason.
- **A supervisor sweep adds queries** → one query for in-flight promotion decisions, on the existing
  merge-slot cadence, and only for projects with a promotion in flight.
- **A hold after approval has no open card** → the project promotion surface carries the state and
  reason; raising a new card supersedes the old one per the existing one-open-per-project rule.

## Migration Plan

No DB migration. The new policies default (`auto` preserves the current direct-push behaviour for a
project with no forge and adds the pull-request path where a forge can act). Rollback is the previous
build; the in-flight field is inert to an older daemon.

## Open Questions

None blocking.
