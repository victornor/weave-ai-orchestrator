## 1. Spawn gate

- [x] 1.1 In `packages/core/src/workers/index.ts` `spawn`, delete the `roles.freeSlots(role.id) <= 0` check. Keep the `liveInProject(project.id) >= project.maxWorkers` check and its `role_full` throw, with the message still naming the project and its limit. Verify by rewriting `packages/core/src/workers/workers.test.ts`: drop or invert `'refuses to spawn when the role has no free slot'` and `'picks a new role limit up on the next spawn…'` so a role stored at `maxWorkers: 1` with one live worker still spawns a second when the project has room; keep `'refuses to spawn when the project is at its worker limit'`.
- [x] 1.2 Add the ticket's named case in `workers.test.ts`: two roles in one project, project `maxWorkers` 3, both roles stored at 2, two live workers of the first role — spawning a third of the first role succeeds; a fourth of any role is refused with `role_full`. Verify that test passes.

## 2. Concurrency reporting

- [x] 2.1 In `packages/core/src/roles/index.ts`, make `concurrency().effective` equal `projectMax` and `concurrency().free` / `freeSlots()` equal `max(0, projectMax − projectLive)`. Keep `roleMax` as the stored field. Verify by rewriting `roles.test.ts` `'reports the effective concurrency as the smaller of the role and project limits'` and the `freeSlots` assertions in `'raises and lowers the worker limit…'` so a role stored at 2 in a project of 4 reports `effective: 4` and `free` as the project's remaining slots even when that role already has 2 live workers.
- [x] 2.2 Confirm `GET /roles/:id` and `ac_role_get` still return the concurrency block with no route/tool signature change. Existing server integration tests that PATCH `maxWorkers` keep passing (they assert the stored field, not spawn).

## 3. Team UI and hire card

- [x] 3.1 Remove `MaxWorkersField` and its call from `packages/ui/src/routes/Team.tsx`, and replace the `{roleWorkers.length}/{r.maxWorkers} workers` list readout with a live count that does not present a per-role denominator. Verify by rewriting `packages/ui/src/test/team.test.tsx` `'Team — role max workers'`: the sheet has no `max workers` input, there is no `live/roleMax` text, and the existing start-session tests still pass.
- [x] 3.2 In `packages/render/src/decision.ts` drop the hire-approval card's "Max workers" row. Verify `packages/render/src/decision.test.ts` no longer expects that row for a hire card.

## 4. Copy that treats a role cap as a spawn gate

- [x] 4.1 Update `skills/agent-conductor-conductor/references/routing.md` and `skills/agent-conductor-conductor/SKILL.md` so a matching role at its stored max-workers is no longer described as queued behind a per-role cap. The conductor assigns anyway; if nothing spawns, the wait is a full *project*. Raising throughput is Settings' per-project max-workers, not `ac_role_set_max_workers`. Verify by reading the two files: no remaining instruction to raise a role cap to drain a queue.
- [x] 4.2 Update `skills/agent-conductor-hire/SKILL.md`, `references/spec-schema.md` and `references/checklist.md` so `maxWorkers` is not described as "how many tickets this role runs at once". Verify hire copy no longer presents it as a concurrency control.
- [x] 4.3 Update `docs/PLAN.md` §7.2 (caps list) and the `ac_role_set_max_workers` tool blurb, `docs/OPERATIONS.md` "If work is not starting" (`role_full` is the project cap), and the README / demos lines that say workers spawn up to `role.maxWorkers`. Verify those docs name the project Settings field as the spawn cap.

## 5. Suite

- [x] 5.1 Run `pnpm lint`, `pnpm typecheck` and `pnpm test`. All green. Existing dispatcher test `'respects the project worker cap'` is unchanged.
