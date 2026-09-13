## 1. Core: the spec writer grows up

- [x] 1.1 In `packages/core/src/roles/index.ts`, change `RolesService.update` to return a result object (`{ role, changedKeys, charterRewritten, reBriefed }`); before persisting, detect whether `CHARTER.md` equals `renderCharter(ctx, beforeSpec)` and, if so, pass the re-rendered merged charter to `persistSpec` so the file is rewritten (a hand-written charter is left alone and `charterRewritten` is false); when `opts.applyToRunning === true`, re-render the home of every live worker of the role via `renderHome` and count them; adjust `setSecrets`, `packages/server/src/routes/roles.ts` (return `.role`) and `weave_role_set_max_workers` to the new return shape; verify `pnpm typecheck`.
- [x] 1.2 Add `RolesService.requestUpdate(actor, id, patch, reason, opts)` to the interface in `packages/core/src/api.ts` and implement it in `roles/index.ts`: refuse an empty patch; refuse `id`/`project` as immutable; refuse `secrets` (name `weave_role_set_secrets`) and `maxWorkers` (name `weave_role_set_max_workers`); when `patch.permission` differs from the current permission and `ctx.config.defaults.hireApproval !== 'none'`, raise a `hire_approval` decision (`correlationKey: role-permission:<id>`, `target: { roleId, permissionChange: true, patch, reason, applyToRunning }`, a role-specific title/context, `recommendation: null`, the hire approve/reject option keys) and return `{ ...before, decisionId, applied: false }` without writing; otherwise call `update` and return `applied: true` with `decisionId: null`.
- [x] 1.3 Extend the roles tests in `packages/core/src/roles/roles.test.ts`: `requestUpdate` changes `charterSummary` and `scope`, writes one revision whose `changedKeys` are those two, and emits `role.updated`; `id`/`project`/`secrets`/`maxWorkers`/unknown/empty patches are refused with a `validation` error naming the right thing and write nothing; a spec-rendered charter is rewritten while a hand-written one is left byte-identical and reported `charterRewritten: false`; `applyToRunning: true` re-briefs a live worker (its rendered `AGENTS.md` carries the new scope) and reports the count, and omitting it reports zero.

## 2. Permission changes follow the hire policy

- [x] 2.1 In `packages/core/src/decisions/service.ts`, branch `applyHireApproval` on `target.permissionChange`: on `approve`, apply `target.patch` through `deps().roles.update(actor, roleId, patch, reason, { applyToRunning: target.applyToRunning })` and return without activating the role or assigning the project's describe scout ticket; on `reject`, change nothing; leave the hire path untouched when the flag is absent.
- [x] 2.2 Add the permission tests: with `hireApproval: human`, `requestUpdate` raises a human-owned decision carrying the patch and leaves the stored permission unchanged; answering `approve` writes the revision and updates the permission; answering `reject` writes nothing; with `hireApproval: none` the change applies with no decision. Put the service-level cases in `roles.test.ts` and the apply-branch cases in `packages/core/src/decisions/decisions.test.ts`.

## 3. The tool

- [x] 3.1 Add `'weave_role_update'` to `WEAVER_TOOLS` in `packages/shared/src/tools.ts`; verify `packages/shared/src/tools.test.ts` passes and `toolNamesFor('weaver')` contains it while `toolNamesFor('worker')` does not.
- [x] 3.2 Define the tool in `packages/server/src/tools.ts` (`scope: 'weaver'`) next to the other `weave_role_*` tools: input `{ id, patch: RoleSpecSchema.partial().strict(), reason: z.string().min(1), applyToRunning: z.boolean().optional() }`, handler calling `svc(ctx).roles.requestUpdate(...)`; a description that says it edits the spec fields, that `secrets`/`maxWorkers` belong to their own tools, and that a `permission` change follows the hire policy; verify a new `packages/server/test/roleUpdate.test.ts` (modeled on `scheduleWakeup.test.ts`) asserts: a weaver call updates the role and returns the revision detail, a worker token is refused `forbidden`, and a patch with `id`/`secrets`/an unknown key fails `validation`.

## 4. The approval card reads as a role change

- [x] 4.1 In `packages/ui/src/components/DecisionCard.tsx`, when a `hire_approval` decision's `target.permissionChange` is true, render the approve action as "Approve" (not "Hire") and the head label as "Role approval"; leave a real hire unchanged; verify a UI test in `packages/ui/src/test/components.test.tsx` renders both and asserts the labels.

## 5. Instructions and docs

- [x] 5.1 Update `skills/weave-ai-hire/SKILL.md`: in the refine section, say a stale description or scope is fixed with the spec-editing tool and the charter prose with `weave_role_update_charter`, and that a `permission` change waits on the hire policy's approval; update the weaver's role-maintenance instructions (the `weave-ai-weaver` skill and/or its role-maintenance section) so the weaver knows the tool exists.
- [x] 5.2 Update `docs/API.md`: add `weave_role_update` to the MCP section (weaver-only, mutable fields, `id`/`project`/`secrets`/`maxWorkers` refused, permission follows `hireApproval`, `applyToRunning`), and note on the Roles HTTP line that a `permission` patch follows the same policy.

## 6. Verification

- [x] 6.1 Run `pnpm lint`, `pnpm typecheck` and both suites (`pnpm test`, then `pnpm --filter @weave-ai/ui exec vitest run`); paste both suite blocks verbatim with their totals in the delivery report.
- [x] 6.2 Confirm `openspec validate vs-335-the-weaver-can-edit-a-role-s-full-spec-d --json --strict` stays clean through the implementation (it is validated at propose, and again before delivery).
