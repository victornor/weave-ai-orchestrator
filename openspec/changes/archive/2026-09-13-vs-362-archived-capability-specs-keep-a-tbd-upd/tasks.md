# Tasks — vs-362-archived-capability-specs-keep-a-tbd-upd

## 1. The purpose helper

- [x] 1.1 Add `packages/core/src/openspec/purpose.ts`: `findPlaceholderPurposeSpecs(specsRoot)`, `extractWhyParagraph(proposalText)`, `fillArchivedCapabilityPurposes(clonePath, changeName)`. The fill throws `OcError('openspec_archive_blocked', …)` naming the capability spec when a placeholder exists and the archived proposal has no usable "Why".
- [x] 1.2 Unit-test the helper in `packages/core/src/openspec/purpose.test.ts` with temporary trees: placeholder recognised, a near-miss "TBD" not recognised, "Why" paragraph extraction, fill writes the Purpose, and the throw when there is no usable "Why".

## 2. Fill on archive-then-merge

- [x] 2.1 Call the fill in `archiveOnBranch` (`packages/core/src/tickets/archive-before-merge.ts`) after `openspec archive` and before `git add`/commit, so the merge carries a written Purpose.
- [x] 2.2 Extend `packages/core/src/tickets/archive-before-merge.test.ts`: archiving a change that creates a capability leaves no placeholder, and a placeholder-creating change whose proposal has no "Why" throws without committing.

## 3. Fill on the reconciliation backfill

- [x] 3.1 Call the fill in `archiveAfterMerge` (`packages/core/src/openspec/index.ts`) on the local-branch path and on the pull-request scratch-branch path, before the commit and push.
- [x] 3.2 Cover both backfill paths in tests: the committed spec has a real Purpose, and a missing "Why" surfaces as a recorded failure rather than a placeholder.

## 4. Backfill the 24 specs

- [x] 4.1 Replace the placeholder Purpose in each of the 24 specs found by `git grep "Update Purpose after archive" -- openspec/specs` with a real 1–3 sentence Purpose from its own requirements and the originating archived proposal's "Why".

## 5. Guard

- [x] 5.1 Add the repository guard test under `packages/core/src/openspec/`: the scan of the real `openspec/specs` tree finds no placeholder, and a fixture spec containing the placeholder is reported.

## 6. Propose guidance

- [x] 6.1 Add to `skills/weave-ai-openspec/SKILL.md` that a change creating a capability must give it a `## Purpose` in the delta, which `openspec archive` carries into the main spec.

## 7. Verification

- [x] 7.1 `git grep "Update Purpose after archive" -- openspec/specs` returns nothing, and `openspec validate --all --strict` passes. Paste both results in the PR.
- [x] 7.2 `pnpm lint`, `pnpm typecheck`, and both suites pass; paste the core/server block and the UI block verbatim.
