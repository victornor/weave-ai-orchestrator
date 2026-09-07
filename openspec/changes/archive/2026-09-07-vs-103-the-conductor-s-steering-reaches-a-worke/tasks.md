## 1. `ac_worker_message` defaults to mid-turn delivery

- [x] 1.1 Add `live: z.boolean().optional()` to `ac_worker_message`'s input schema
  (`packages/server/src/tools.ts`), change the handler to
  `svc(ctx).workers.message(ctx.actor, i.workerId, i.message, { live: i.live ?? true })`, and update
  the tool's `description` to say it attempts mid-turn delivery by default, names the two outcomes,
  and states that a message never widens what the worker may do or answers a decision for it; verify
  `pnpm typecheck` passes and `WorkersService.message`'s own default (queued, when a caller omits
  `live`) is untouched.

## 2. Tests: the conductor's default and the conductor's path

- [x] 2.1 Add a server-level test (alongside `packages/server/test/mcp.test.ts`'s existing
  `ac_worker_message`-adjacent coverage, or a new `packages/server/test/workerMessage.test.ts`) that
  calls the tool with no `live` field and asserts `workers.message` was invoked with `{ live: true }`,
  and a second case with `live: false` asserting it is passed through unchanged; verify both run
  against the tool dispatch path (MCP or the `/agent/tools/:tool` mirror), not a direct import of the
  handler function.
- [x] 2.2 In `packages/core/src/workers/workers.test.ts`, add a conductor-actor counterpart to the
  existing "a mid-turn message leaves an open decision open and touches no permission or tool config"
  test (currently `HUMAN`-only, around line 366): same scenario with an actor of `{ kind: 'agent', id:
  'conductor' }` and `{ live: true }`, asserting the open decision stays open and the role's
  permission/tool config is unchanged; verify it passes against the existing `workers.message`
  implementation with no service-side change needed.
- [x] 2.3 Retitle the existing test at `workers.test.ts:262` ("messages a worker as a ticket comment
  plus a conductor_request wake") so its comment is unambiguous that it pins the *service's* own
  default when a caller omits `live` — not the conductor tool's default, which task 1.1 changes;
  verify the test's assertions and behavior are otherwise untouched.
- [x] 2.4 Verify the fake-runtime scenarios the ticket names all already exist and pass for a
  conductor-shaped call: mid-turn delivery when the fake declares streaming input and a run is in
  flight, queued when it does not, queued when the channel is closed, and the ticket comment recorded
  even when `send` throws — reusing the fixtures `workers.test.ts`'s "message: mid-turn vs queued
  delivery (VS-99)" describe block already sets up, parametrized or duplicated for the conductor actor
  where task 2.2 does not already cover the case.

## 3. Docs: the conductor is told what `live` means and what to tell captain

- [x] 3.1 Update `templates/conductor.AGENTS.md.tmpl`'s `ac_worker_message` mention (§ "Roles and
  workers" tool list and the unblock-ladder rung that names it) to say steering now reaches a running
  turn by default and that the tool's response says whether it landed inside the current turn or will
  apply from the next one; verify the rendered `work/AGENTS.md`-equivalent (or a template snapshot
  test, if one exists) reflects the new wording.
- [x] 3.2 Update `skills/agent-conductor-conductor/SKILL.md`'s unblock-ladder rung 2 ("Can you steer
  it? … It is a comment on the ticket plus a wake; the worker acts or reports.") to say the default is
  mid-turn delivery when the runtime supports it, and that a `queued` outcome means the correction
  applies at the worker's next turn, not immediately; verify the skill still reads as a single
  coherent ladder.
- [x] 3.3 Update `docs/PLAN.md`'s `ac_worker_message(workerId, message)` line (§10-adjacent tool
  reference) to `ac_worker_message(workerId, message, {live?})` and describe the `mid_turn`/`queued`
  outcome, matching the wording used for the human/attach path elsewhere in the plan; verify no other
  PLAN section still describes the conductor's relay as queued-only.

## 4. Verification

- [x] 4.1 `pnpm typecheck && pnpm lint && pnpm test` green.
- [x] 4.2 `openspec validate vs-103-the-conductor-s-steering-reaches-a-worke --json --strict` clean
  from the repo root.
