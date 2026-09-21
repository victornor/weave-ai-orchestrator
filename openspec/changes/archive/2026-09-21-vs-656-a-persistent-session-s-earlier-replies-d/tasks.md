## 1. The retirement reason is recorded

- [x] 1.1 Add `packages/db/src/migrations/0061_session_retired_reason.sql` (`ALTER TABLE agent_sessions ADD COLUMN retired_reason TEXT;`) with a comment naming VS-656 and the four reasons; add the column to `SessionRow`. Verify: `packages/db/src/migrations.test.ts` asserts the column exists after migrate and that a pre-0061 database still opens.
- [x] 1.2 In `packages/core/src/sessions/index.ts` `forTurn`, set `retired_reason` on the row it retires (`tool_contract`, `idle`, `runtime`), and `reset` in `reset()`; return the reason on `TurnSession` as `retireReason`. Verify: `sessions.test.ts` asserts the retired row's `retiredReason` and the returned `retireReason` for the tool-contract, idle and runtime cases, and that an unchanged session returns none.

## 2. The boundary is exposed and rendered

- [x] 2.1 Add `SESSION_RETIRED_REASONS` and a human-wording helper (`sessionRetirementLabel`) to `packages/shared` (enums/helper). Verify: a unit test covers every reason plus an unknown/null reason returning the generic restart wording.
- [x] 2.2 `GET /workers/:id` (`packages/server/src/routes/workers.ts`) returns the agent's `sessions` (id, status, turnCount, createdAt, updatedAt, retiredReason), oldest-first; document it in `docs/API.md`. Verify: `packages/server/test/workers.test.ts` asserts the shape and order, and that a non-session agent's list is still returned without error.
- [x] 2.3 Extend `sessionConversationRows` (`packages/ui/src/lib/sessionConversation.ts`) with a `boundary` row: when a run's `sessionId` differs from the previous rendered run's, insert a boundary before it carrying the previous session's stored reason. Verify: a new `sessionConversation.test.ts` fails on the current code for two sessions' runs and passes after, asserting the boundary sits between the sessions and that no boundary appears for a single session.
- [x] 2.4 Render the `boundary` row in `SessionThreadFeed` as a centred, muted marker with the reason sentence. Verify: a `v2worker.test.tsx` case with two sessions' runs shows the marker with the right wording; the existing single-session cases show no marker.

## 3. The conversation is the agent's whole history

- [x] 3.1 Replace the workspace-wide `useRuns({ limit: 200 })` in `SessionThreadFeed` with an agent-scoped read (`/runs?agent=<id>`), through a small `useSessionRuns(agentId)` hook with a named `SESSION_RUNS_PAGE`; drop the `>= oldest` clause. Verify: a `v2worker.test.tsx` case where the shared workspace window would exclude the agent's older run now shows that run's turn and its delivered answer — this case fails on the current code.
- [x] 3.2 Page earlier history: grow the run limit with the loaded thread pages and call the thread's `loadOlder` on scroll near the top. Verify: a `v2worker.test.tsx` case triggers `loadOlder` and later runs/messages render in order without duplicates.

## 4. An involuntary retirement carries the conversation

- [x] 4.1 Add `sessionCarryOverDigest(messages, opts)` (bounded: newest-first selection, 1,500-char per message, 12,000-char and 40-message totals, an omission line) as a pure function in `packages/core/src/prompts`. Verify: unit tests cover the per-message cap, the total cap, the omission line, ordering oldest-first, and an empty/absent history producing nothing.
- [x] 4.2 Carry the reason through the engine into `TurnPromptOptions`, and in `buildTurnPrompt` append a `## Conversation carried over` section for a `session` retired for `tool_contract` or `idle`, excluding the waking message ids. Verify: `prompts/render.test.ts` asserts the section is present for those two reasons and absent for `runtime`/`reset`, and that the current human message is not duplicated in the account.
- [x] 4.3 Confirm VS-542 is not weakened: the retirement still creates a new session whose first turn is not resuming (`session.started`, not `session.resumed`) and whose runtime gets the current tool definitions. Verify: `sessions.test.ts` and `engine.test.ts` assert the new session's `isFirstTurn`/no ref while the carried section is present.

## 5. Verification and evidence

- [x] 5.1 `openspec validate vs-656-a-persistent-session-s-earlier-replies-d --json --strict` is clean.
- [x] 5.2 `pnpm lint && pnpm typecheck` green, then the full suite one suite at a time with `--maxWorkers=4`, pasting both suite blocks verbatim in the report.
- [x] 5.3 Capture rendered evidence in both themes (dark, light) at desktop width of a session conversation spanning two sessions with a boundary marker and the earlier turns' transcripts. Attach each capture to the ticket (`weave_ticket_attachment_put`) so it appears on the approval card; author the harness outside `work/` and remove it, leaving `git status --porcelain` empty.
- [x] 5.4 State plainly in the report what was and was not verified against the real fern-ofm session, and confirm that workspace's database was read only (no writes).
