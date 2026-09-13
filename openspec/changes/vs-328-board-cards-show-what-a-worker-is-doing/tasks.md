## 1. Pure mapping and parsers

- [x] 1.1 In `packages/render`, add `workerActivity(event)` returning `{ label, verb, target } | null`
      for a run event, reusing `toolTarget`'s extraction and covering every runtime's shape per
      design.md. Golden-test it against `RunEvent` payloads copied field-for-field from each adapter
      (`packages/runtimes/{claude,opencode,codex,gemini,cursor}/src/events.ts`), including the
      edit/write, read/search, shell-command, test-command, web and unknown cases.
- [x] 1.2 In `packages/shared`, add `parseTestSummary(output)` returning `{ passed, total } | null`
      for vitest, jest, bun test, `node --test`, pytest, `go test`, cargo test and `dotnet test`.
      Unit-test it against real sample outputs for every runner, including a failing run, a runner
      with no summary, and an empty/undefined output. Export it from the package index.
- [x] 1.3 Add the shared `WorkerActivitySummary` and `TestTally` types, and the ephemeral
      workspace-frame shape the board consumes, to `packages/shared`. Build
      `pnpm --filter @weave-ai/render build` and `pnpm --filter @weave-ai/shared build`.

## 2. Adapters parse the tally before truncating

- [x] 2.1 In each of `packages/runtimes/{claude,opencode,codex,gemini,cursor}/src/events.ts`, parse
      `parseTestSummary` from the command output before it is truncated and carry the result as
      `tests` on the `command.executed` payload. Change no other field.
- [x] 2.2 Extend each runtime's `test/events.test.ts` fixture/assertions so a command whose real
      recorded output carries a summary yields the expected `tests`, and one without a summary yields
      no `tests` field. Use recorded/real sample bytes, not typed fixtures.

## 3. `WorkerActivityService` in core

- [x] 3.1 Add `packages/core/src/activity/index.ts`: per-workspace, in-memory, per-agent
      `summaryFor(agentId)`, `observe(agent, ticket, event)`, throttled `broadcast`, and a lazy
      `tests` rebuild from a worker's persisted runs (newest-first), bounded to at most
      `WORKER_ACTIVITY_REBUILD_RUNS` runs and `WORKER_ACTIVITY_REBUILD_EVENTS` command events and
      cached per worker, so the read stays cheap after a restart. Activity is set only by live events
      and cleared at run finalize; tests persist until replaced.
- [x] 3.2 Add `EventBus.broadcast(type, entityId, payload)` in `packages/core/src/events.ts` that
      emits to the in-process bus without inserting an `events` row; assert in a test that the events
      table does not grow.
- [x] 3.3 Wire the service into `CoreServices` (`packages/core/src/create.ts` / `api.ts`) and call
      `observe` from the run engine's `record()` (`packages/core/src/runs/engine.ts`). Unit-test the
      service with a fake event sequence: activity set/changed/cleared, tally set/replaced/kept-across-
      turn, throttle coalescing (fake timers), and rebuild after a fresh instance.

## 4. Server surface

- [x] 4.1 `GET /workers` and `GET /workers/:id` include the worker's activity line and last test
      tally from `services.activity.summaryFor`. Update `packages/server/test` for the shape.
- [x] 4.2 The workspace SSE route (`packages/server/src/routes/events.ts`) forwards ephemeral
      `broadcast` frames without advancing the replay cursor; test that a persisted frame and an
      ephemeral frame are both delivered and that the ephemeral one does not move `after`.
- [x] 4.3 Document the new workers-read fields and the activity frame in `docs/API.md`.

## 5. Pull-request check tally

- [x] 5.1 Extend `ForgeAdapter.prState`'s return with an optional `checks: { passed, total }` in
      `packages/plugin-sdk`; derive it from `statusCheckRollup` in `packages/core/src/forge/gh.ts`.
- [x] 5.2 The supervisor reconcile (`packages/core/src/supervisor/index.ts`) writes the returned rollup
      state and counts onto the ticket's delivery record whenever they differ from what is stored,
      independent of whether the PR's state changed (today the write is inside `if (pr.state !==
      row.state)`), and emits `ticket.updated` on that write so the board refreshes. Tests: a tally is
      recorded; an open PR whose checks go from `1/3` to `3/3` updates the stored tally and emits the
      refresh while its state is unchanged; an empty rollup records none; a forge error leaves the
      previous record.

## 6. Board rendering

- [x] 6.1 Add the activity line, the test tally and the PR-checks line to `TicketCard` and `TicketRow`
      (`packages/ui/src/components/TicketCard.tsx`), bounded to two extra rows and truncating per
      design.md. Include a leaf `ActivityLine` with its own 1 s relative-time interval.
- [x] 6.2 In `packages/ui/src/routes/Board.tsx`, subscribe with `useWorkspaceEvents` to the activity
      frame, merge it over `useWorkers` per worker, and coalesce bursts per animation frame; pass the
      summary and the ticket's `delivery` checks to the cards. `invalidateFor` ignores the frame.
- [x] 6.3 UI tests: card/row render the line, tally (passing and failing tones), and PR checks;
      nothing when unknown; the board updates the changed card from a pushed activity frame; no
      run-event stream is opened per card. The 1/3→3/3-while-open refresh is covered at its source by
      the supervisor test in 5.2 plus the existing `ticket.updated` → `qk.tickets` invalidation
      (`packages/ui/src/test/events.test.tsx`), which is what refetches the board's card data.

## 7. Full verification

- [x] 7.1 Run `pnpm lint`, `pnpm typecheck`, and `pnpm test`; paste both suite blocks verbatim per
      this project's convention and fix anything red. Done: lint clean, typecheck clean. Core/server:
      187 passed | 1 skipped (188) files, 2897 passed | 1 skipped (2898) tests. UI: 99 passed (99)
      files, 1677 passed (1677) tests.
- [x] 7.2 Re-read the ticket's acceptance criteria against the final diff and note any gap before
      requesting review. Gaps, stated honestly: the activity line is derived from tool/file/command
      events, so a live worker between the run starting and its first tool call shows no line (phase
      markers were deliberately not mapped, per design.md); and no literal screenshot was taken (jsdom
      cannot evaluate the truncation/layout either), so the card's visual density is verified by tests
      and token classes only.

## 8. PR #273 review follow-up (conductor, 2026-09-13)

- [x] 8.1 `parseTestSummary` now sets `total = passed + failed`, so skipped/todo tests do not count
      against a clean run (vitest, jest, `node --test`, dotnet; pytest already did). Tests use real
      outputs with skipped and todo counts.
- [x] 8.2 The vitest and jest parsers sum every summary line in one output, so a run of more than one
      suite reads as one tally; tested with this repo's real two-suite shapes, all-passing and one
      failing.
- [x] 8.3 `go test` without `-v` returns null rather than counting packages as tests; the existing
      package-line test now expects null.
- [x] 8.4 Board `summaryOf` lets a pushed frame win even when its `activity` is null, so a cleared
      line does not fall back to the query's stale one; test added.
- [x] 8.5 `workerActivity` returns null for a `command.executed` with no command, so Claude/Gemini/
      Cursor keep the `tool.call`'s line instead of flipping a finished test run to "Running a
      command"; test added.
