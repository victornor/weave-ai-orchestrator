## 1. Policy and strategy

- [x] 1.1 Add `promotionMode` (`auto` | `pull-request` | `direct-push`, default `auto`) and `promotionPrTitle` (optional) to `ProjectPoliciesSchema` in `packages/shared/src/config.ts`, and verify with a unit test in `config.test.ts` that an absent policy parses to `auto` and an unknown value is refused
- [x] 1.2 Add a pure `promotionStrategyOf(project, forgeCanOpenPullRequests)` helper and verify with unit tests covering `auto` + forge available → `pull-request`, `auto` + no forge → `direct-push`, explicit `pull-request`, and explicit `direct-push`

## 2. Repository merge methods

- [x] 2.1 Add optional `ForgeAdapter.repoMergeSettings?(cwd)` to `packages/plugin-sdk/src/index.ts`, implement it in `GhForge` from `gh api repos/{owner}/{repo}` (`allow_merge_commit`/`allow_squash_merge`/`allow_rebase_merge`) with a pure exported `mergeSettingsFromGh`, and verify the parser against recorded `gh` JSON in `gh.test.ts`
- [x] 2.2 Add a pure merge-method resolution helper (configured method when the repository allows it, else squash → merge → rebase, `null` settings → configured method) and verify it with unit tests for each branch, including none allowed

## 3. Honest promotion content

- [x] 3.1 Change `promotion.status` to compute the content being promoted from `git diff --numstat <default>...<landing>` (files, insertions, deletions) and to derive `canPromote` from a non-empty content diff, holding `behind` only for the direct-push strategy; verify with a scratch-repository test that a simulated squash (default tree equal to landing tree) reports nothing to promote while the commit count is non-zero
- [x] 3.2 Keep the commit list in the status payload and card as labelled detail, and verify `tickets` are listed (still filtered by `delivery.promotedAt`) regardless of the commit count

## 4. Promotion pull-request body

- [x] 4.1 Add `packages/core/src/promotion/pr-body.ts`: template discovery (`.github/PULL_REQUEST_TEMPLATE.md`, `.github/pull_request_template.md`, `.github/PULL_REQUEST_TEMPLATE/*.md`, `docs/PULL_REQUEST_TEMPLATE.md`, `PULL_REQUEST_TEMPLATE.md`), deterministic section filling with a human-confirmation marker for unfillable sections, and a generated fallback body; verify with pure unit tests over a representative template fixture (a required section, a safety section, an unknown section) and a no-template case, asserting no section is blank and no claim is asserted for the safety section
- [x] 4.2 Use the policy title (`promotionPrTitle` or `Promote <landing> to <default>`) and the built body when opening a promotion pull request; verify in `promotion.test.ts` with a fake forge that the created title and body contain the tickets and the changed-file summary

## 5. Promotion execute

- [x] 5.1 Resolve the strategy in `execute`, reuse an open landing-to-default pull request or open one non-draft, resolve the merge method, and merge when required checks are green (or the repository has no CI); verify with a fake forge asserting the `base`/`head`, the method passed to `mergePr`, and the recorded promotion
- [x] 5.2 When required checks are still pending, persist an in-flight promotion record in the decision's `target_json.promotion` and do not merge; verify with a fake forge that `mergePr` is not called and the record carries the pull-request URL, method and heads
- [x] 5.3 Keep the direct-push path for a project with no forge or an explicit `direct-push` policy, keep every existing `promotion.test.ts` case passing, and verify a rejected push appends a reason naming the pull-request path

## 6. Advancing an in-flight promotion

- [x] 6.1 Add `promotion.advance()` and call it from the supervisor's existing cadence: merge an in-flight promotion once its checks are green, hold it with the reason when a check failed, the merge was refused, or the landing head moved past the reviewed one; verify with fake-forge transition tests for each outcome
- [x] 6.2 On completion, stamp every included ticket with `promotedAt` and the forge's merge commit as `promotedSha` and verify tickets then read "in production", stay done, and are absent from a freshly computed status

## 7. Surface and API

- [x] 7.1 Extend `PromotionStatus` with the content summary (`changedFiles`, `additions`, `deletions`) and an in-flight/held promotion record; expose it unchanged through `GET /projects/:id/promotion` and verify the route test
- [x] 7.2 Update the UI Promote control (`ProjectPage.tsx`) to show the changed-file count and tickets instead of the commit count, the pull-request link and state while in flight, and the held reason; verify with the component render test `packages/ui/src/v2/project/promoteControl.test.tsx` and the UI suite

## 8. Copy and documentation

- [x] 8.1 Update the weaver and worker promotion copy in `packages/core/src/prompts/defaults.ts` and the relevant `skills/` text so the daemon opens and merges the promotion pull request and no one asks the human for `gh pr merge`; verify `packages/shared/src/tools.test.ts` and the prompt tests pass
- [x] 8.2 Update `docs/PLAN.md` (§ landing rules) and `docs/adr/0014-project-landing-branch.md` to describe the promotion pull-request path and the new policy, and update the `promotionNotes` policy description

## 9. Verification

- [x] 9.1 Run `pnpm lint` and `pnpm typecheck` and verify both are clean
- [x] 9.2 Run the changed test files while iterating, then one full `pnpm test` with `--maxWorkers=4` and paste **both** suite blocks verbatim in the PR; state which parts could not be verified against real GitHub and give captain the manual steps to run on the next Fernwood promotion
