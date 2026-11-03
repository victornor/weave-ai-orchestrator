## 1. The recorded-merge proof

- [x] 1.1 Add `recordedLandingProof` to `packages/core/src/worktrees/landed.ts` (design D1/D2): PR-head ancestry from the checkout's HEAD, then merge-commit ancestry or per-path content containment excluding `openspec/changes/<change>/` and `openspec/specs/`, returning landed / unlanded(n) / unverified(reason) / none. Verify with new cases in `landed.test.ts` built on real temp git repos: PR head equal; HEAD ancestor of PR head (daemon archive commit on top); three-commit squash with no PR head; squash plus archive move; detached HEAD with the branch deleted from clone and remote; a commit after the merge (unlanded, n=1); merge commit missing from the clone (unverified); no record (none).
- [x] 1.2 Wire the proof into `landedWorkTest` through optional `delivery` and `changeName` inputs, after the uncommitted check and before the branch lookup, with `proof: 'recorded_merge'` evidence and `unverified: true` on the verdict. Verify that the existing `landed.test.ts` cases pass unchanged, plus new cases: edge-landing ticket whose merge is on `edge` and not `main` is landed; cancelled ticket with commits on no remote and no record is still not landed.

## 2. Callers

- [ ] 2.1 `retireIfLanded` passes `ticket.delivery` and `ticket.openspecChangeName`. Verify with a workers test: a `done` ticket whose PR squash-merged a three-commit branch, remote branch deleted, PR work product still `open`, retires and removes its worktree.
- [ ] 2.2 `reclaimFinishedHomes` passes the delivery and change name, and removes a proven copy whose recorded branch is missing from the clone by path (`git worktree remove` + `prune`, no force, no branch deletion) (D4). Verify with sweep tests: a branch-deleted merged copy past the window is reclaimed; a detached-HEAD, branch-gone proven copy is reclaimed by path; a `landing_unverified` copy is skipped with that reason; genuinely unlanded copies are still skipped.
- [ ] 2.3 `retained.inspect` uses the same proof (D3): landed → not a retained copy even when the branch is gone; unverified → reason and class `landing_unverified`; unlanded(n) → `finished_unlanded` with n. Add `landing_unverified` to `RETAINED_COPY_CLASSES` and `RETAINED_COPY_REASONS` in `packages/shared/src/enums.ts`. Verify with `retained.test.ts` cases for each, including that a squash-merged, branch-deleted clean copy is absent from the report.

## 3. Surfaces and docs

- [ ] 3.1 Label `landing_unverified` in the Storage view (`packages/ui/src/v2/settings/sections/Storage.tsx`) and `weave worker retained` (`packages/cli/src/commands/worker.ts`). Verify with the existing Storage and CLI tests extended to the new class.
- [ ] 3.2 Update `docs/OPERATIONS.md` → "Disk fills up" with the recorded-merge proof and the `landing_unverified` class. Verify by reading the rendered section.

## 4. Verification and the workspace measurement

- [ ] 4.1 Run `pnpm lint`, `pnpm typecheck` and the changed test directories, with both suite blocks pasted verbatim in the PR. Where the worker's memory limit prevents the full suite, say which directories ran and leave the full suite to CI.
- [ ] 4.2 Measure the corrected classification over v-services read-only (D5): per copy, the proof's verdict and `du -sk`. Use `weave_ticket_get` deliveries for agent-conductor tickets and the `edge` squash-commit proxy for FanStack tickets. Report in the PR how many of the 153 copies become reclaimable and how many GB against the 181 GB measured, which stay and why, and whether the 18 "branch not found" copies are recoverable.
