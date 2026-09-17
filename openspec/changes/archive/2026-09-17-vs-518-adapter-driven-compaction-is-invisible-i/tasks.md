# Tasks

## 1. Session service: post-compaction bookkeeping

- [x] 1.1 In `packages/core/src/sessions/index.ts`, give the session service a way to end an
  adapter compaction that records the post-compaction context size when known, otherwise clears it —
  e.g. extend `setCompacting` to accept the completed size, or add a narrow
  `noteCompactionEnd(sessionId, postTokens | null)`. Keep the session service the only writer of
  `compacting_at` / `compacting_error` / `last_context_tokens`.
- [x] 1.2 Keep `sessions.compacting(agentId)` and the dispatcher's `compactingInDb` / `compactionDue`
  reads unchanged; verify no other caller of `setCompacting` regresses (`packages/core/src/workers/index.ts`).

## 2. Engine: observe adapter compaction on the turn stream

- [x] 2.1 In `packages/core/src/runs/engine.ts`, in the `phase('turn')` `onEvent` handler, on
  `session.compaction.started` mark `turnSession.session.id` compacting and broadcast the ephemeral
  `session.compaction` frame `{ agentId, compacting: true, at, origin: 'adapter' }` for the agent.
- [x] 2.2 On `session.compaction.completed`, clear the mark via the session service (task 1),
  storing the boundary's `postTokens` when present and clearing otherwise, and broadcast the closing
  frame `{ agentId, compacting: false, ok: true, error: null, origin: 'adapter' }`.
- [x] 2.3 Track that this turn observed an adapter compaction, and carry it into `finalize` so
  `sessions.record` does not overwrite `last_context_tokens` with the turn's possibly pre-compaction
  `usage.contextTokens` (write `contextTokens: undefined` in that case).
- [x] 2.4 When a turn ends while a compaction mark set by that turn is still standing (a `started`
  with no `completed` before the run finished), clear it in `finalize` so the dispatcher is not held
  on a dead mark; a completion arriving on a later turn clears it then.
- [x] 2.5 Record the origin (`adapter`) in the run engine's log line for the observed compaction, so
  the two paths are distinguishable to an operator without a schema change.

## 3. Tests

- [x] 3.1 `packages/core/src/runs/engine.test.ts` (or a focused `engine.compaction.test.ts`): a turn
  whose runtime emits `session.compaction.started` marks the session compacting and broadcasts the
  `session.compaction` running frame — the same assertions the daemon path already satisfies.
- [x] 3.2 A turn whose runtime emits `started` then `completed` with `postTokens` leaves
  `last_context_tokens` at the post-compaction size and clears `compacting_at`; the closing frame is
  broadcast.
- [x] 3.3 A turn whose runtime reports compaction but no `postTokens` leaves
  `last_context_tokens` null, and the next dispatcher tick does not start an automatic compaction
  from a pre-compaction number.
- [x] 3.4 A turn that emits `started` and ends without `completed` leaves no compaction mark set.

## 4. Per-runtime detectability and delivery notes

- [x] 4.1 Confirm the Claude adapter emits `session.compaction.*` unchanged (VS-454) and add no
  adapter change; state in the PR that Claude is the only runtime that signals adapter compaction.
- [x] 4.2 State in the PR, per runtime (codex, opencode, cursor, gemini), that no compaction signal
  exists and no banner is fabricated, with the reason (see design.md's table).

## 5. Checks

- [x] 5.1 `pnpm lint`, `pnpm typecheck`, `pnpm test` (both the core/server and UI suites) green, with
  both suite blocks pasted verbatim in the report.
