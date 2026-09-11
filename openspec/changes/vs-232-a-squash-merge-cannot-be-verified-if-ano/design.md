## Context

See proposal.md - Why. `landDelivery` (`packages/core/src/tickets/land.ts`) in `pr` mode fetches `origin`, fast-forwards the primary clone, then calls `verifyContained(clone, branchHead, origin/<landing>)`. That helper tries, in order: branch-head ancestry, identical trees, patch-id of `git diff <merge-base> <branchHead>` against each commit gained on the landing branch since that merge-base, then `git cherry`. It never receives `mergeCommit`. `mergeDone` (`packages/core/src/tickets/service.ts`) already takes `{ mergeCommit?, method? }` from `ac_ticket_merge_done` and records it as a work product *after* `landDelivery` returns; the SHA is unused for the check. The `merge_unverified` throw at the end of `landDelivery` has no `details` argument, which is why VS-227's error was a single sentence blaming an unmerged PR.

The existing land tests already cover last-to-land squash, squash-then-later-commits (the patch-id path), ordinary merge, cherry-pick, local-branch ff, and VS-119 landing-branch targeting. They do not cover "another commit on the landing branch *before* the squash", which is the VS-227 topology: merge-base stays the old tip, GitHub squashes against the newer tip, patch-ids differ.

`worktrees/landed.ts` is a separate "may we discard this worktree" check and is not on the `mergeDone` path. Supervisor reconciliation (`packages/core/src/supervisor/index.ts`) already calls `mergeDone(..., { mergeCommit: pr.mergeCommit, method: 'forge' })` from `prState`.

## Goals / Non-Goals

**Goals:**
- A squash whose parent is not the ticket branch's merge-base verifies when the caller (or the forge) names that squash commit and it is on the landing branch.
- `land.ts` stays a git-only helper: it proves a SHA is an ancestor, or falls back to the four content strategies. Whether a SHA is *this PR's* merge commit is `mergeDone`'s job, because that is where the forge registry and the ticket's PR URL already live.
- Every `merge_unverified` from this path carries comparison `details`. Existing success cases keep passing without a merge commit.

**Non-Goals:**
- Rewriting the patch-id strategy to reconstruct GitHub's squash-against-newer-main diff (`git merge-tree` or similar). The merge-commit path is the proof for that topology; the content strategies stay as they are.
- Requiring a rebase before merge, or changing worker merge-slot instructions to make rebase load-bearing.
- Changing `worktrees/landed.ts`.
- Closing [VS-227](conductor://tickets/VS-227) from this ticket. Captain closed it by hand at 16:22
  on 2026-09-11; [VS-233](conductor://tickets/VS-233) owns the stranded OpenSpec archive. Do not plan
  a retrospective `mergeDone` against it.

## Decisions

**Accept the reported merge commit as proof, do not try to make patch-id survive a newer squash parent.**
The ticket asked for this first. `git merge-base --is-ancestor <mergeCommit> origin/<landing>` is exactly the fact VS-227's clone already had (`839ef93a` is on `origin/main`) and that `verifyContained` never asked. Rebuilding GitHub's squash diff from the branch vs a stale merge-base is possible (`merge-tree`, range-diff) and still false-negatives when two PRs touched the same lines. The forge already named the commit. Use it.

**`landDelivery` is git-only; `mergeDone` decides which SHA is trusted. Both halves of that trust are load-bearing.**
Ancestry of a SHA already on the landing branch is **not** proof that *this* PR merged. A worker can name any ancestor of `main` — an old commit, an unrelated squash — and `merge-base --is-ancestor` would succeed. The two halves that make ancestry proof rather than a formality, neither optional:

1. The SHA passed into `landDelivery` MUST be the merge commit the forge reports for *that PR*. `mergeDone` uses the forge's SHA (the caller's argument is a cross-check when present; omitting it is not a failure). A caller SHA that disagrees with the forge is refused loudly and is never forwarded.
2. When the forge is unreachable, `mergeDone` SHALL NOT fall back to the worker's SHA. Content strategies run instead. Forwarding the worker SHA "because it is on `main`" reopens the hole in (1).

`landDelivery(config, project, ticket, branch, opts?: { mergeCommit?: string })` treats `opts.mergeCommit` as already authenticated. If it is an ancestor of `origin/<landing>`, that is proof. An unresolvable or non-ancestor SHA is a *skipped* or *failed* strategy, not an immediate throw — content strategies still run. This keeps `land.test.ts` a tmp-repo pair with no forge mock, and keeps existing `mergeDone` tests that pass `mergeCommit: 'abc1234'` from breaking when a clone happens to exist: junk SHAs skip the new strategy.

`mergeDone`, in `pr` mode, before calling `landDelivery`:
1. Look up the ticket's newest pull-request work product URL (same query `autoMergeSweep` already uses).
2. If a URL exists, call `forge.prState(clone, url)`.
3. If the forge says `merged` and returns `mergeCommit`: **use that SHA** as `landDelivery`'s `mergeCommit`, whether or not the worker named one. If the worker also named a SHA and they are not the same object, throw `merge_unverified` with details `{ reported, forge, prUrl }` *without* treating the worker's SHA as proof.
4. If the forge says the PR is not merged: throw `merge_unverified` with `{ forgeState, prUrl }` — this is a real "merge the PR first".
5. If there is no PR URL, or `prState` throws / returns null: **do not** forward the worker's `mergeCommit`. Content strategies run.

Why not trust a worker SHA when the forge is down? Ancestry of an arbitrary SHA that is already on `main` would let a confused or malicious report close a ticket that never merged. A forge outage keeps today's content-strategy behaviour plus a useful error, rather than a new spoofing hole.

Alternative considered: pass the worker SHA through and also require a content match. Rejected for the intervening-squash case — content match is exactly what fails, so the SHA would never help without forge confirmation.

Simplification considered (conductor, 2026-09-11): since `mergeDone` asks the forge anyway, use the forge's answer rather than merely comparing against a caller SHA, so omitting `mergeCommit` is not a failure mode for the intervening-squash topology. Taken. The disagree-loudly half stays.

**Error `details` are built inside `verifyContained` / `landDelivery`, not composed later from logs.**
`verifyContained` returns either a passing `detail` string (unchanged for callers that only read `LandResult.detail`) or, on failure, enough structured attempts that `landDelivery` can throw:

```
new OcError('merge_unverified', message, {
  branch, branchHead, landing, landingHead,
  mergeCommit, mergeCommitStatus, // 'ancestor' | 'not_ancestor' | 'unresolvable' | 'omitted'
  strategies: [{ name, outcome }], // tried in order
})
```

Message rules:
- Default remains close to today's text when nothing suggests the PR merged (`origin/${landing} does not contain ${branch} yet; …`).
- When `mergeCommitStatus === 'ancestor'` but the SHA was omitted by `mergeDone` (should not reach land.ts as a pass) — N/A.
- When the forge already reported merged (mergeDone throws before land, or land is given a SHA that is not an ancestor after a fetch race): message names the SHA and the landing head, and does **not** say "merge the PR first".
- local-branch failures already pass `{ stderr }`; keep that and add `{ branch, landing, stderr }`.

`OcError` and MCP `fail()` already serialise `details`; no schema change.

**Intervening-squash fixture lives in `land.test.ts`, not a live clone.**
Reproduce the ordering with the existing origin/clone tmp pair: multi-commit branch on the clone; unrelated commit on origin/main; then `squashMergeOnOrigin` (which merges `--squash` onto current origin HEAD, i.e. after the unrelated commit); pass the origin squash SHA into `landDelivery`. Assert `landed: true` and `detail` mentions that SHA. A sibling test without `mergeCommit` on the same topology asserts today's failure *and* that `details.strategies` includes patch-id / cherry failures — that is the diagnostic contract, and it documents that the content path still cannot prove this topology, which is intended.

**local-branch mode ignores `mergeCommit`.** Fast-forward remains the proof. No forge.

## Risks / Trade-offs

- **Forge unreachable on a genuine intervening squash.** → Ticket stays `merging` (same as today) but the error now lists strategies and `forge: 'unreachable'` instead of "merge the PR first". Mitigation: supervisor reconciliation already retries `prState` and calls `mergeDone` with the forge SHA once GitHub answers.
- **Worker-reported SHA disagrees with the forge on a merged PR.** → Hard fail, even if content strategies would pass. Mitigation: this is the confused-worker case the ticket describes; the details give both SHAs so the next call can pass the forge's.
- **`mergeDone` tests with a dummy SHA and a PR URL `'u'`.** If the harness github forge's `prState` starts being invoked, a throw or a `merged`+junk SHA could change those tests. Mitigation: treat `prState` failure / non-github-url the same as unreachable (omit SHA); add explicit forge-agree/disagree tests rather than relying on `'u'`.
- **Fetch race: forge says merged, clone has not fetched the SHA yet.** `landDelivery` already `git fetch origin` before checking. If the SHA is still missing, `mergeCommitStatus: 'unresolvable'` and content strategies run; the error details say the SHA was not in the clone after fetch, which is the "wait for the forge" case with something to check.

## Migration Plan

None. Additive argument, additive error field. Existing callers that omit `mergeCommit` keep the four content strategies. After deploy, a `merging` ticket whose PR is already on the landing branch verifies on the next `ac_ticket_merge_done` / supervisor reconciliation without a rebase.

## Open Questions

None. The ticket's merge-commit approach is accepted; the untrusted-SHA rule is the reason it can be trusted.
