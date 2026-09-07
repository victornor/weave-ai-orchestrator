## 1. Data model

- [x] 1.1 Add a migration `ALTER TABLE tickets ADD COLUMN interactive_session INTEGER NOT NULL DEFAULT
  0` (additive, no CHECK, no rebuild); verify a db migration test that an existing database with real
  ticket rows migrates cleanly and the column defaults to `0`.
- [x] 1.2 Add `interactiveSession: boolean` to `Ticket` (`packages/shared/src/types.ts`) and
  `interactiveSession?: boolean` to `TicketCreateInput` (`packages/core/src/api.ts`); verify `pnpm
  typecheck`.

## 2. Starting a session

- [x] 2.1 `tickets.create` (`packages/core/src/tickets/service.ts`) stores `interactiveSession` from
  the input (defaulting `false`); verify a core test that a ticket created with `interactiveSession:
  true` reads back that way and one created without it defaults `false`.
- [x] 2.2 Add `WorkersService.startInteractiveSession(actor, input: {ticketId: string} | {projectId:
  string; roleId: string; kind: TicketKind; title: string; description?: string}): Promise<Agent>`
  (`packages/core/src/workers/index.ts`): for an existing ticket, mark it `interactiveSession: true`
  (refusing if it already has a live worker for a *different* purpose is unnecessary — starting a
  session against a ticket with a live worker just returns it, per `interactive-sessions/start`); for
  a fresh ticket, call `tickets.create` with `interactiveSession: true` and the given
  `assigneeRoleId`; either way call the existing `spawn` unchanged. Verify a core test for both paths:
  the resulting agent has a worktree, a runtime and the role's permission mode, and a core test that
  starting against a ticket with an existing live worker returns it rather than spawning a second one.
- [x] 2.3 Wire `startInteractiveSession` into `CoreServices`/`api.ts`.

## 3. The first-turn hold

- [x] 3.1 In `runs/engine.ts`, where `TurnInput.permission` is built (`engine.ts:234-252`), load the
  turn's ticket (already loaded as `ticket` at line 131) and, where `ticket?.interactiveSession &&
  agent.turnCount === 0`, intersect the role's `allowed` tools (or, if the role sets none, the full
  first-turn allowlist) with `FIRST_TURN_ALLOWLIST` (`ac_inbox, ac_ticket_get, ac_ticket_comments,
  ac_ticket_comment, ac_ticket_document_get, ac_worktree_status, Read, Grep, Glob`) and set that as
  `allowedTools`; leave `deniedTools` as the role's own so an explicit role denial still applies.
  Verify a core test asserting the `TurnInput` passed to the fake runtime on turn 1 of an interactive
  ticket's agent has `allowedTools` restricted to that set, and a core test that turn 2 (after a
  message) receives the role's ordinary permission with no restriction.
- [x] 3.2 Update the first-turn's prompt (`prompts/index.ts` — `buildTurnPrompt` and/or the brief) so
  an interactive session's first turn is told explicitly: read the ticket and its context, post one
  ticket comment stating your understanding and what you are ready to do, then stop. Verify a render
  test that this instruction appears on turn 1 of an interactive ticket's prompt and not on turn 2 or
  on an ordinary ticket's prompt.
- [x] 3.3 Verify with a core test, end to end against `FakeRuntime`, that an interactive session's
  first turn posts a ticket comment and makes no other change (no file write in the worktree, no
  ticket transition), and that its second turn (triggered by a message) can do all of those.

## 4. Keeping the conductor out

- [x] 4.1 In `WorkersService.message`, refuse with a clear reason when `actor.kind === 'agent'` and
  the target agent's ticket has `interactiveSession: true`; a human actor (`actor.kind === 'human'`)
  is unaffected. Verify a core test that an agent actor calling `message` against an interactive
  session's worker is refused, and a core test that a human actor calling it succeeds exactly as
  before.
- [x] 4.2 Verify `ac_worker_message`'s handler (`packages/server/src/tools.ts:458-460`) surfaces that
  refusal with a server test.

## 5. Ending and idle cleanup

- [x] 5.1 Verify with a core test that `workers.cancel` against an interactive session's worker leaves
  the ticket commented and the worktree `dirty` (kept), exactly as it already does for any worker —
  no code change expected; if one turns out to be needed, make it narrowly and say so in the PR.
- [x] 5.2 Verify with a server test that `POST /worktrees/:id/discard` against an interactive
  session's worktree still refuses without `force: true` — no code change expected, per the same
  reasoning.
- [x] 5.3 Add `defaults.interactiveSessionIdleTimeoutMinutes` to workspace config
  (`packages/shared/src/config.ts`, default 240) and an idle-cancel pass in `supervisor/index.ts`
  beside `retireFinished` that calls `workers.cancel(SYSTEM, workerId, 'idle interactive session')`
  for every ticket with `interactive_session = 1`, a live worker, no run currently `running`, and
  `agents.lastRunAt` older than the timeout. Verify a supervisor test that an idle session is
  cancelled with its worktree kept, and a test that a session with a run still executing is left
  alone regardless of `lastRunAt`.

## 6. Visibility

- [x] 6.1 `GET /tickets` and `GET /workers` (`packages/server/src/routes/`) include
  `interactiveSession` in their response shape. `GET /tickets` and `GET /workers/:id` return the full
  `Ticket` object already (no route change needed, verified by the existing core-level round-trip
  test); `GET /workers`'s list needed a join since `Agent` carries no ticket data — added, with a
  server test. Also added the HTTP entry point the plan's Impact section named but tasks.md never
  broke out: `POST /workers/start-session` (discovered missing while implementing this task),
  wired to `WorkersService.startInteractiveSession`, with server tests for both input shapes and the
  invalid-body case.
- [x] 6.2 Add a way to start a session from the web app — from an existing ticket's page, and from a
  project + role picker that creates one — and mark an interactive session's ticket/worker card.
  Shipped: a "Start interactive session" button on `TicketPage` (offered when the ticket has no live
  worker yet and is not already a session); a "Start session" button on each role's card in
  `TeamRoute`, opening an inline title/description form that creates a fresh ticket for that
  project+role in one action — no separate project+role picker component was needed, since
  `TeamRoute` already renders each role nested under its own project, so the context is already in
  scope by the time the button is clicked (no reusable picker exists anywhere else in the UI, and
  building a *standalone* one would have been the materially bigger, unnecessary investment); an
  `interactive` marker on `WorkerCard`/`WorkerRow` and the ticket page header;
  `useStartSession`/`useWorkers`' widened `WorkerListItem` type in `hooks.ts`. Verified:
  `components.test.tsx` (the marker, present/absent), `ticketpage.test.tsx` (button offered/hidden by
  worker/session state, calls `useStartSession` with `{ticketId}`), `team.test.tsx` (form open/close,
  disabled until a title is entered, calls `useStartSession` with `{projectId, roleId, kind, title,
  description}`, cancel starts nothing).

## 7. Closing out

- [x] 7.1 Update `docs/API.md` for the new/changed routes and the `interactiveSession` field.
- [x] 7.2 Run `pnpm typecheck`, `pnpm lint`, `pnpm test` and
  `pnpm --filter @agent-conductor/ui exec vitest run`; verify all four are green and that no test
  drives a real CLI. Verified: `pnpm typecheck` clean, `pnpm lint` clean (boundaries + console),
  root `pnpm exec vitest run` 1520 passed / 1 pre-existing skip (117 files), ui suite 838 passed (54
  files). No test spawns a real coding CLI — every runtime interaction goes through `FakeRuntime`.
