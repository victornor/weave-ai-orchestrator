## 1. The SDK contract for a live input channel

- [x] 1.1 Add `InputDelivery = 'delivered' | 'closed' | 'unsupported'` and an optional
  `send(text: string): Promise<InputDelivery>` to `TurnHandle` in `packages/runtime-sdk/src/index.ts`,
  with a doc comment saying an adapter that cannot deliver omits it; verify `pnpm typecheck` passes
  and no adapter is forced to implement it.
- [x] 1.2 Document on `RuntimeCapabilities.streamingInput` that it now means "this adapter's
  `TurnHandle` carries `send`", and verify by grep that every adapter's declared value matches
  whether it provides `send` after task group 3.
- [x] 1.3 Add `stdinMode?: 'close' | 'open'` to `SpawnOpts` and a `write(line: string): boolean` to
  the object `spawnLines` returns (`packages/runtime-sdk/src/process.ts`), leaving stdin open in
  `'open'` mode and ending it on process close and on cancel; verify a new unit test in
  `packages/runtime-sdk/src/launch.test.ts`'s sibling (or a new `process.test.ts`) that a child in
  `'open'` mode receives two separately written lines and one in `'close'` mode behaves as today.
- [x] 1.4 Make `write` return `false` rather than throw after stdin has ended, keeping the existing
  EPIPE handler; verify with a test that writes after the child exits.

## 2. The fake runtime and the fake CLI

- [x] 2.1 Give `FakeRuntime` (`packages/runtime-sdk/src/testkit.ts`) a configurable
  `streamingInput` and, when it is on, a `TurnHandle` with a `send` that records what it received and
  can be scripted to return `closed`; verify the recorded inputs are readable from a test.
- [x] 2.2 Add a fake `claude` binary fixture that speaks the stream-json contract — reads `user`
  frames from stdin, echoes them when `--replay-user-messages` is passed, emits a `result` line and
  exits when stdin ends — so the Claude adapter can be tested end to end without the real CLI; verify
  by a test that spawns only the fake.

## 3. The Claude adapter over stream-json stdin

- [x] 3.1 Change `buildArgs` (`packages/runtimes/claude/src/args.ts`) to emit
  `-p --output-format stream-json --verbose --input-format stream-json --replay-user-messages`, drop
  the prompt operand and the plain-text stdin path, and return the turn's first `user` frame instead;
  verify `packages/runtimes/claude/test/args.test.ts` asserts the whole head and the exact frame, and
  that `MAX_ARGV_PROMPT` no longer gates anything.
- [x] 3.2 Spawn with `stdinMode: 'open'` in the adapter, write the prompt frame at spawn, and expose
  `send` on the `TurnHandle` writing a `{"type":"user","message":{"role":"user",...}}` frame; verify
  against the fake CLI that a frame written mid-turn is received by the child.
- [x] 3.3 End the child's stdin as soon as the parser reports the turn's `result` line, and have
  `send` resolve `closed` after that; verify against the fake CLI that the process exits at the end of
  a turn and that a late `send` reports `closed`.
- [x] 3.4 Teach `events.ts` to match a replayed `user` frame to a frame we sent — an acknowledgement,
  never a fresh turn input and never a tool result; verify with a recorded fixture in
  `packages/runtimes/claude/fixtures/` that a replayed frame produces no spurious transcript event.
- [x] 3.5 Honour a `liveInput: false` turn option by returning to `--input-format text`, the argv/stdin
  prompt and no `send`; verify `args.test.ts` covers both shapes.

## 4. Carrying the channel through the run engine

- [x] 4.1 Add `send?: (text: string) => Promise<InputDelivery>` to `ActiveRun`
  (`packages/core/src/runs/active.ts`) and set it from the handle in `engine.ts` beside where `cancel`
  is replaced; verify an engine test finds `send` on the active run while a `FakeRuntime` turn is in
  flight and finds it gone once the run finalizes.
- [x] 4.2 Read `defaults.liveInput` (new optional boolean in `packages/shared/src/config.ts`,
  defaulting to `true`) and pass it as the turn option from `engine.ts`; verify a config test that an
  existing `workspace.yaml` without the key parses and defaults to `true`.

## 5. One steering path with two outcomes

- [x] 5.1 Add `human.input` to `RUN_EVENT_TYPES` (`packages/shared/src/enums.ts`) with a documented
  payload of `{ text, authorKind, authorId, delivery, acknowledgedAt? }`; verify the enum test and
  `pnpm typecheck` pass.
- [x] 5.2 Change `WorkersService.message` to take `{ live?: boolean }` and return
  `{ delivery: 'mid_turn' | 'queued'; runId: string | null; wake: Wakeup | null }`, recording the
  ticket comment first, then attempting `send` when `live`, then recording the `human.input` event,
  and enqueuing the wake only when delivery was not mid-turn; update `packages/core/src/api.ts` to
  match and verify every existing caller still compiles.
- [x] 5.3 Verify with core tests against `FakeRuntime`: mid-turn delivery when the fake declares
  `streamingInput` and a run is in flight; queued delivery when it does not; queued delivery when the
  fake's `send` returns `closed`; exactly one delivery in each case and never zero.
- [x] 5.4 Verify with a core test that the human's text is on the ticket, attributed to the human,
  even when `send` throws.
- [x] 5.5 Verify with a core test that a mid-turn message leaves an open decision open, and that the
  run's permission mode and allowed/denied tool lists in the `TurnInput` are unchanged by it.

## 6. The daemon's surface

- [x] 6.1 Accept `{ body, live?: boolean }` on `POST /workers/:id/message` and return
  `{ delivery, runId, wakeId }`; verify a server test for both outcomes.
- [x] 6.2 Add `input: { midTurn: boolean; reason?: string }` to the `GET /workers/:id` detail,
  derived from the runtime's `streamingInput` and whether a live run with a channel exists; verify a
  server test covering a capable runtime mid-turn, a capable runtime between turns, and an incapable
  runtime.
- [x] 6.3 Update `docs/API.md` for both routes; verify the two entries name the new body field, the
  response and the detail field.

## 7. What the human sees

- [x] 7.1 Render `human.input` in `packages/render` as an attributed block carrying the text and its
  delivery; verify a golden test.
- [x] 7.2 In `packages/ui`'s `WorkerPage`, label the composer from the worker detail's `input`
  ("reaches the running turn" / "queued for the next turn" / the named limitation) and show the
  outcome of the message just sent; verify a ui test for each of the three labels and for the outcome.
- [x] 7.3 In `packages/tui`'s `Attach`, send with `live: true` and report the returned outcome in the
  notice line instead of the fixed "comment posted" text; verify a tui test.
- [x] 7.4 Verify with a ui test that opening and closing the transcript view issues no request that
  changes the run.

## 8. Recording the decision and closing out

- [x] 8.1 Write `docs/adr/` entry for the stdin transport: the flags, the stdin-lifetime rule, closing
  on `result`, why the channel is always open on Claude, and the `defaults.liveInput` rollback;
  verify it names the evidence in `design.md`.
- [x] 8.2 Update PLAN §8's warm-process row and §14b.1's description of the attach input line to match
  what shipped; verify the two sections no longer describe input as queued-only.
- [x] 8.3 Run `pnpm typecheck`, `pnpm lint`, `pnpm test` and
  `pnpm --filter @agent-conductor/ui exec vitest run`; verify all four are green and that no test
  drives a real CLI.
