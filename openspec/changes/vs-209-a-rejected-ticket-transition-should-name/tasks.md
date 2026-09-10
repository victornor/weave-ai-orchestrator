## 1. Error detail

- [x] 1.1 In `packages/core/src/tickets/guards.ts`, add `allowed: TRANSITIONS[kind][from]` to the `details` of the graph-invalid `invalid_disposition` throw (the `!canTransition(kind, from, to)` branch), importing `TRANSITIONS` from `@agent-conductor/shared` alongside the existing `canTransition` import. Verify by running `pnpm --filter @agent-conductor/core typecheck` and confirming no import/type errors.

## 2. Test

- [x] 2.1 In `packages/core/src/tickets/tickets.test.ts`, add a test asserting that transitioning a `change` ticket from `approved` to `in_review` is rejected with `error.details.allowed` equal to `TRANSITIONS.change.approved` (or the equivalent literal list) and not containing `in_review`. Verify with `pnpm --filter @agent-conductor/core exec vitest run tickets.test.ts`.

## 3. Worker-facing docs

- [x] 3.1 Add one row/line to `skills/agent-conductor-worker/SKILL.md`'s "Common mistakes" table (or immediately below it) noting that a rejected transition's error now lists the reachable next statuses in `details.allowed`, so the worker should read the error rather than recall the graph. Verify by reading the rendered table for accuracy against the change actually shipped in task 1.1.

## 4. Verification

- [x] 4.1 Run `pnpm typecheck` and `pnpm test` (or the project's standard full check) at the repo root and confirm both are green. Verify by pasting the final pass/fail summary into the ticket.
