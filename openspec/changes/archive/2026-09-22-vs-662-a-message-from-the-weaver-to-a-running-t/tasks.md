## 1. A shared interrupt for a steer to a running ticket worker (core)

- [x] 1.1 Add a helper in `packages/core/src/runs/active.ts` — an active-run lookup for an agent plus an interrupt that calls `runs.cancel(actor, runId, 'interrupt', 'message')` only when the run does not already carry `cancelled.cause === 'message'` — returning the interrupted run id or null. Gate it to a ticket-bound worker so the weaver and a ticketless session are never touched.
- [x] 1.2 In `workers.message`'s live branch, when the worker has an executing run with no `send`, interrupt it for the conductor (agent actor) as well as a human, and set `delivery = 'interrupted'`, instead of falling through to a `conductor_request` wake. Verify with a core test that fails today: an agent actor + an active run with no `send` → `delivery: 'interrupted'`, cancel called with `(actor, runId, 'interrupt', 'message')`, and a `live_interrupt` wake carrying the whole body.
- [x] 1.3 Use the helper's cancelled-cause guard in `workers.message` so a second steer while the turn is stopping does not cancel again, and enqueue its own `live_interrupt` wake carrying the whole body. Verify with a test where two rapid steers produce one cancel, two wakes, and both bodies present in order.
- [x] 1.4 Leave the mid-turn path and `live: false` unchanged: a run with `send` still reports `mid_turn` with no cancel, and `live: false` still queues outright. Verify with tests for each.

## 2. Every other steer path (core)

- [x] 2.1 In `tickets.comment`, when the sender is a human and the ticket's worker has an executing run, interrupt it after the transaction commits (the VS-657 shape: read the active run inside `tx`, cancel after) and carry `interruptedRunId` in the `ticket_comment` wake. Verify with a core test: a human comment on a running worker's ticket interrupts the turn and the `ticket_comment` wake carries the comment body and `interruptedRunId`.
- [x] 2.2 In `decisions.answer`, when the asking agent is a ticket-bound worker with an executing run, interrupt it and carry `interruptedRunId` in the `decision_answered` wake. Verify with a core test.
- [x] 2.3 Generalise the "previous turn was interrupted" note in `buildTurnPrompt` to fire for any wake whose payload carries `interruptedRunId`, not only `human_message`, so a ticket comment's or a decision answer's resumed turn is told its previous turn was interrupted.
- [x] 2.4 Render an interrupted `decision_answered` wake's answer in the resumed turn's prompt: its `answer` already rides in the payload, and the "Answered decisions" query excludes it once the interrupted run finalizes. Merge the wake's answer into that section, deduplicated by decision id. Verify with a prompt test.
- [x] 2.5 Update the `weave_worker_message` description in `packages/server/src/tools.ts` to name `mid_turn`, `interrupted` and `queued`.

## 3. Same-session resume and transcript

- [x] 3.1 Verify with an engine test that a worker run interrupted by a steer finalizes `interrupted_by_message` and that its wake starts the next run on the same session carrying the message (reuse/extend the VS-254 test at `engine.test.ts:866`), including that the resumed turn keeps the same session when the runtime is resumable.
- [x] 3.2 Add `'interrupted'` to `HumanInputBlock.delivery` and map all three values explicitly in `packages/render/src/transcript.ts`, `packages/render/src/inspect.ts`, `packages/ui/src/lib/transcript.ts`, and render it in `packages/ui/src/components/Transcript.tsx`, so an interrupting input reads `interrupted`, never `queued`. Verify with render and UI unit tests for `mid_turn`, `interrupted` and `queued`.

## 4. Runtime coverage

- [x] 4.1 Verify the two runtime paths at core level with the fake runtime: `streamingInput: true` (a `send`-carrying run) → `mid_turn` and no cancel; no `send` → `interrupted` and cancel. Reuse the VS-660 per-adapter harness where a per-adapter assertion is needed, and confirm each adapter stops on `cancel('interrupt')` rather than adding a new mechanism.
- [x] 4.2 Record the plain list of paths and runtimes and what each does (the design.md table: claude and the built-in runtime deliver mid-turn; codex, opencode, gemini and cursor interrupt; a human comment and an answered decision interrupt on every runtime; system wakes, the ticketless session and the weaver's chat are unchanged) for the PR body.

## 5. Verification and evidence

- [x] 5.1 Iterate on the changed test files only, then run one full suite with `--maxWorkers=4` at the end; paste both suite blocks verbatim in the PR.
- [x] 5.2 Capture light and dark screenshots of the live view after an interrupting steer (the label reads interrupted, not queued) and attach them to the ticket.
- [x] 5.3 State plainly in the PR what was verified against a fake runtime and what needs the real CLI, and confirm nothing was run against live credentials.