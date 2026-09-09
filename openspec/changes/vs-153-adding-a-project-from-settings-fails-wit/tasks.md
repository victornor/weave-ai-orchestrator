## 1. Accept policies on POST /projects

- [x] 1.1 Add optional `policies: ProjectPoliciesSchema.optional()` to `AddSchema` in `packages/server/src/routes/projects.ts`, keeping `.strict()`. Verify `pnpm vitest run packages/server/test/jobs.test.ts` still passes the existing 202 add case.
- [x] 1.2 In `packages/server/test/jobs.test.ts`, assert `POST /projects` with `{ url, policies: { autoMergeDefault: true } }` is 202 and the stubbed `startAdd` receives that policies object; `{ url, autoMerge: false }` is 400 with `unrecognized_keys` naming `autoMerge`; `{ url }` with no policies is still 202.

## 2. Persist autoMergeDefault on add

- [x] 2.1 In `packages/core/src/projects/projects.test.ts`, add a case that `add(..., { policies: { autoMergeDefault: true } })` yields `project.policies.autoMergeDefault === true` (and off/omitted is not true). Verify with `pnpm vitest run packages/core/src/projects/projects.test.ts`. No `createRow` change unless this test fails.

## 3. Settings form maps Auto-merge default onto policies

- [x] 3.1 Change `useAddProject` in `packages/ui/src/api/hooks.ts` so the mutate body type has `policies?: { autoMergeDefault?: boolean }` and no `autoMerge`. Verify `pnpm --filter @agent-conductor/ui exec tsc --noEmit` (or the typecheck that covers ui) is clean for this type.
- [x] 3.2 In `ProjectsSection` (`packages/ui/src/routes/Settings.tsx`), post `policies: { autoMergeDefault }` matching the control and never a top-level `autoMerge`. Wire the settings-test mock of `useAddProject` to record mutate arguments. Verify `packages/ui/src/test/settings.test.tsx`: submit with the control off → body has no `autoMerge` and `policies.autoMergeDefault` is not true; submit with it on → `policies.autoMergeDefault === true` and no `autoMerge` key.

## 4. Docs and suite

- [x] 4.1 Update `docs/API.md` `POST /projects` so the documented body includes optional `policies.autoMergeDefault` and still names the schema as strict (no top-level `autoMerge`).
- [x] 4.2 `pnpm typecheck && pnpm lint && pnpm test` green.
