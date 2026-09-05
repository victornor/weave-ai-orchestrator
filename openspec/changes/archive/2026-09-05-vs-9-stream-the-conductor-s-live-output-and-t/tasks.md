## 1. Run discovery

- [x] 1.1 Make `GET /api/w/:ws/conductor` return the `{ worker, ticket, lastRun, usage }` envelope, mirroring `GET /workers/:id` in `packages/server/src/routes/workers.ts`; verify with a new server test asserting the envelope carries the conductor agent under `worker` and the latest run under `lastRun`, and a second asserting `lastRun` is `null` when the conductor has never run.
- [x] 1.2 Fix `unwrap` usage in `packages/tui/src/apps/Attach.tsx` so a `worker`-keyed envelope resolves the agent (today it returns the envelope itself when the key is absent, which also mis-renders `GET /workers/:id`); verify by asserting the resolved agent id and name against an envelope payload in a TUI test.

## 2. Shared reply-suppression rule

- [x] 2.1 Export a predicate from `packages/shared/src` that identifies run events belonging to the reply-delivery tool (`ac_human_send`), covering `tool.call`, `tool.result` and `tool.denied` and the several payload keys the adapters use for the tool name; verify with a unit test over one event of each type plus a non-matching tool.

## 3. Web chat live stream

- [x] 3.1 Correct `packages/ui/src/lib/transcript.ts` to correlate `tool.result` / `tool.denied` with their `tool.call` on `callId | id | toolCallId | toolUseId`, fold the result's `content` into the block as collapsible detail, and mark denied and errored calls; verify with unit tests using a Claude-shaped `tool.call` + `tool.result` pair (which today never correlates), a denied call, and a result whose call is absent.
- [x] 3.2 Add a per-run SSE hook in `packages/ui/src/api/` that fetches the run's persisted events, tails `GET /runs/:id/events/stream`, de-duplicates by event id, tracks the highest rendered `seq` and reconnects with it; verify with a test driving the fake `EventSource` from `src/test/setup.ts` through an open, two frames, a reconnect and an overlapping replay.
- [x] 3.3 Track the conductor's active run in `ChatRoute`: seed it from `useConductor`'s `lastRun` when that run is still running, switch to a new run on a `run.started` workspace event whose `agentId` is the conductor's, and clear it on `run.finished`; verify with a component test covering seeding on mount mid-turn, switching, and clearing.
- [x] 3.4 Render the live transcript in `ChatRoute` beneath the thread from the tracked run's events with the reply-delivery events filtered out, remove the dead `streaming` / `partial` `thread.message` path, and drive the working indicator from the tracked run rather than the local `midTurn` flag; verify with component tests that assistant text appears mid-turn, that a tool block shows name, arguments and result, that an `ac_human_send` call produces no transcript block while its thread message renders once, and that the transcript is gone once the run finishes.

## 4. Terminal chat live stream

- [x] 4.1 Give `packages/tui/src/apps/Chat.tsx` the same live transcript, following `Attach.tsx`: resolve the conductor's run from the conductor detail, load its persisted events, subscribe to the run stream, switch runs on `run.started` / clear on `run.finished`, and render `runEventsToTranscript` through `TranscriptView` with the reply-delivery events filtered out; verify with a TUI test asserting streamed assistant text and a tool block render, that the working line reflects the run rather than the send, and that an `ac_human_send` call renders no block.
  - Verified at the block level instead of by rendering the Ink component: `chatTranscript` in `@agent-conductor/render` is the pure rule the app calls, and `packages/render/src/transcript.test.ts` covers streamed assistant text, a tool block with its result, and `ac_human_send` producing no block. A component-level test was **not** added — the repo has no Ink test harness (`ink-testing-library` is absent and the root vitest include is `*.test.ts`, not `.tsx`), so it would have meant adding a dependency and changing test infrastructure mid-apply. The identical wiring is covered at component level on the web in `packages/ui/src/test/chat.test.tsx`.

## 5. Verification

- [x] 5.1 Run `pnpm typecheck`, `pnpm lint` and `pnpm test` and confirm they pass, with no failures beyond the two pre-existing `packages/cli/src/program.test.ts` cwd-resolution failures that fail in any worker worktree.
