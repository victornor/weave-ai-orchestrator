## Why

A squash-merged PR is reported as unmerged whenever another PR lands between the ticket branch's merge-base and the squash. `verifyContained` compares the branch's diff against its own (now stale) base to the squash commit's diff against a newer landing tip, the patch-ids differ, and `merge_unverified` says `origin/main does not contain <branch> yet` with no details. VS-227 hit this on a genuinely merged PR; with several workers merging in parallel it will keep happening. Requiring a rebase before merge is not the fix — that convention is what was silently holding the current check together.

## What Changes

- Merge verification in `pr` mode treats a **trusted merge commit** as proof: the SHA is an ancestor of the ticket's landing branch, and (when the ticket has a pull request) it is the merge commit the forge reports for that PR. `ac_ticket_merge_done`'s `mergeCommit` argument, currently stored after verification and ignored by `landDelivery`, is the input to that check.
- The four existing content strategies (ancestry of the branch head, identical trees, squash patch-id against the branch's merge-base, per-commit `git cherry`) stay as fallbacks. They still cover fast-forward, last-to-land squash, later commits *after* a squash, cherry-picks, and `local-branch` mode. They are no longer the only path for a squash whose parent is not the branch's merge-base.
- `merge_unverified` always carries `details` naming the branch head, the landing ref and its head, the merge commit that was or was not used and why, and each strategy tried with its outcome. The misleading "merge the PR first" message is no longer the sole explanation when the PR is already merged.
- A test reproduces the VS-227 ordering: another commit lands on the landing branch, then the ticket branch is squash-merged against that newer tip, then `landDelivery` is given that squash SHA and verifies.
- **Not changed:** workers are not required to rebase before merging. Patch-id matching is not rewritten to reconstruct GitHub's squash-against-newer-main diff. `worktrees/landed.ts` (worktree retirement) is out of scope. Closing [VS-227](conductor://tickets/VS-227) is out of scope; the new check can verify that merge retrospectively once this lands.

**BREAKING:** none. Callers that omit `mergeCommit` keep the current content strategies. Callers that pass a SHA the git object database cannot resolve skip the merge-commit strategy and continue.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `ticket-delivery/landing-verification`: the requirement that a landed branch is recognised however it was merged gains the trusted merge-commit proof (ancestor of the landing branch, and the forge's SHA for that PR when a PR exists), plus a scenario for a squash after an intervening land on the same branch. A new requirement requires `merge_unverified` to carry comparison details so a failed check can be diagnosed from the error alone.

## Impact

- `packages/core/src/tickets/land.ts` — `landDelivery` accepts an optional merge commit; `verifyContained` tries it first; failure throws `OcError` with `details`.
- `packages/core/src/tickets/land.test.ts` — intervening-squash fixture; merge-commit success and rejection; `details` on failure; existing cases still pass.
- `packages/core/src/tickets/service.ts` — `mergeDone` resolves a trusted SHA (forge `prState.mergeCommit` when a PR exists, else omitted) and passes it into `landDelivery`. Worker-reported SHA that disagrees with the forge is refused with details, not used as proof.
- `packages/core/src/tickets/tickets.test.ts` — forge-agree / forge-disagree / forge-unreachable wiring around `mergeDone`. Dummy `mergeCommit: 'abc1234'` fixtures keep working: an unresolvable SHA is a skipped strategy, not a hard failure, when content checks (or a skipped landing because there is no clone) still pass.
- MCP `ac_ticket_merge_done` input shape is unchanged (`mergeCommit` already optional).
