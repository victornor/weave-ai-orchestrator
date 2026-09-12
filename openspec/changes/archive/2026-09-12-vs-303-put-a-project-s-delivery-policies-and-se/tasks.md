## 1. Shared allowed values

- [x] 1.1 In `packages/shared/src/enums.ts` add `export const ARCHIVE_COMMITS = ['push', 'pr', 'local'] as const` with its derived type, and in `packages/shared/src/config.ts` change `archiveCommit` to `z.enum(ARCHIVE_COMMITS).default('push')`. Verify `pnpm vitest run packages/shared && pnpm typecheck` stay green and `ProjectPoliciesSchema.parse({ archiveCommit: 'pr' })` still succeeds for each of the three values.

## 2. Projects row controls

- [x] 2.1 In `packages/ui/src/routes/Settings.tsx` generalise the YOLO helpers into `policyOverrideOf(policies, key)` and `withPolicy(policies, key, value)` (removing the key when `value` is `undefined`), keep the YOLO select working through them, and add a row-local, `aria-expanded`-carrying **Delivery & setup** toggle whose panel renders only when open. Verify by running `pnpm --filter @weave-ai/ui exec vitest run src/test/settings.test.tsx` with a new test asserting the toggle reveals the controls and that rendering the section sends no PATCH for the project.

- [x] 2.2 Add the policy selects in the panel — `proposalApproval` and `taskApproval` from `APPROVAL_OWNERS` (displaying legacy `conductor` as `weaver`), `mergeMethod` from `MERGE_METHODS`, `deliveryMode` from `DELIVERY_MODES`, `archiveCommit` from `ARCHIVE_COMMITS`, and the booleans `autoMergeDefault`/`requireCi` as `inherit`/`on`/`off` — each with an `inherit` option that calls `withPolicy(..., undefined)` and each labelled `"<policy> for <slug>"`. Verify tests assert the option lists and that a concrete choice PATCHes `{ policies: { ...existing, <key>: <value> } }`.

- [x] 2.3 Add the `mergeConcurrency` number field using `useCommittableField` + `CommitStatus`, validating the draft in `onCommit` against `ProjectPoliciesSchema.shape.mergeConcurrency.unwrap().removeDefault()` and throwing a range message built from its `minValue`/`maxValue`; committing an empty value clears the key. Verify a test that an out-of-range value sends no PATCH and shows the range, and that a valid value sends it.

- [x] 2.4 Add the `setupCommand` text field using `useCommittableField` + `CommitStatus` with copy that says it runs shell in the project clone, committing only `{ setupCommand }`. Verify a test that committing a non-empty value sends exactly that body and that an empty commit clears it.

- [x] 2.5 In `packages/ui/src/api/hooks.ts` give `usePatchProject` an `onMutate` that merges the patch into the cached project list (`qk.projects(ws)`) and an `onError` that restores the snapshot, so successive policy changes before a refetch do not drop an earlier one. Verify a test that changes two policies in a row and asserts the second request still carries the first.

## 3. Preserve-other-fields coverage

- [x] 3.1 In `packages/ui/src/test/settings.test.tsx` add a case where a project carries sibling policies, `setupCommand`, `maxWorkers` and `landingBranch`: changing one policy must send every sibling policy unchanged and must not include `maxWorkers`, `landingBranch` or `setupCommand` in the body. In `packages/core/src/projects/projects.test.ts` add a case that `projects.update(HUMAN, id, { policies: { requireCi: false } })` leaves `setupCommand`, `maxWorkers` and the project's other policies intact. Verify both files pass.

## 4. Full verification

- [x] 4.1 Run `pnpm lint`, `pnpm typecheck` and `pnpm test`, and report both suite blocks verbatim (core/server and UI), with totals, in the delivery. Do not merge on a red run.
