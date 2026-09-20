## 1. Recordings and protocol facts

- [x] 1.1 Commit the recorded app-server traffic (mock provider, scratch home) as fixtures under `packages/runtimes/codex/test/fixtures/` and a script-free README line saying how they were captured. Verify: fixtures parse as JSONL and contain `item/started` commandExecution, `outputDelta`, `agentMessage/delta`, `turn/completed`.
- [x] 1.2 Record one real approval request (command outside the sandbox on the mock) and one reasoning-delta turn if the mock can produce reasoning; save as fixtures. Verify: the request frame and the decision reply shape are in a fixture the tests read.
- [x] 1.3 Record `thread/start` in a non-git cwd and a `thread/resume` of an `exec`-created thread id against the mock; state the results in the design's Open points. Verify: fixtures or a recorded error frame exist for each.

## 2. Translator

- [x] 2.1 Extract the completed-item mapping from `events.ts` so `exec` and app-server paths share it. Verify: existing `events.test.ts` passes unchanged.
- [x] 2.2 Add `app-server-events.ts`: notifications → `RuntimeEvent`s and `onPartial` frames (text, reasoning, command output, MCP progress), `tool.call` at item start, usage, error/retry, unknown → `runtime.raw`. Verify: replay of the recorded fixtures yields the expected ordered events and partials, with `partId` equal to the completed event's id.

## 3. Driver

- [x] 3.1 Add `app-server.ts`: spawn, handshake, thread start/resume/fork, `turn/start`, approval and elicitation answering by permission mode, unknown-request error reply, cancel via `turn/interrupt` then process kill, 10 s handshake timeout, cut-off handling. Verify: driver tests against a fake server script cover an approval ask in each permission mode, a cut-off stream, cancel mid-stream, resume, fork.
- [x] 3.2 Wire the adapter: try the driver first, return `null` before `turn/start` is accepted so `runTurn` runs `exec`; honour `options.appServer === false`; declare `partialOutput: 'full'` and add `appServer` to the config schema; keep `-c` overrides (MCP, compaction limits, tool-output limit) shared with `buildArgs`. Verify: adapter tests: server does not start → `exec` path completes with startup-failure reason preserved; server ok → same `TurnResult` fields (session thread id, finalText, structured, usage, provider, model) as `exec` for the same story.
- [x] 3.3 Confirm partial frames are redacted: an engine or adapter test with a registered secret in command output shows `[redacted]` in the broadcast frame. Verify: the test.

## 4. Real-CLI-free end-to-end check

- [x] 4.1 Run the adapter against the real `codex app-server` with the mock provider and a scratch `CODEX_HOME` (never live credentials) and confirm the run's events and partials. Verify: a transcript of the run in the PR description.

## 5. Measurement and UI evidence

- [x] 5.1 Measure delta produced → visible on the page, and tool start → visible, before (`exec`) and after (`app-server`) on the mock, stating that a real provider was not used. Verify: both numbers in the PR.
- [x] 5.2 Render a Codex worker page mid-turn (streaming text, a running command with output, a completed step) in every theme at desktop and phone width; attach captures to the ticket from outside the worktree. Verify: attachments visible on the ticket.

## 6. Delivery

- [x] 6.1 Run lint, typecheck, and both test suites one at a time with `--maxWorkers=4`; paste both suite blocks verbatim. Verify: `git status --porcelain` empty, PR opened.
