## 1. Session-wide conversational prompt

- [x] 1.1 In `packages/core/src/prompts/index.ts`, key the interactive "What to do now" text on `ticket.interactiveSession` for every turn, not `turnCount === 0`. Keep the existing first-turn hold paragraph when `turnCount === 0`. For later interactive turns, instruct: this is a conversation (answer, investigate, explain); do not write code, transition toward delivery, or create a plan or merge approval unless the human asked in this conversation; if you think a change is warranted, say so in the conversation and wait; a conversation-only ending is success. Ordinary workers keep today's delivery one-liner. Verify with a new `prompts/render.test.ts` case that builds the prompt for an interactive worker at `turnCount` 0, 1 and 2: turn 0 still contains the hold text; turns 1 and 2 contain the conversational contract and do not contain "do the phase your ticket status asks for"; a non-interactive worker at the same counts contains the delivery one-liner and does not contain the conversational contract.

## 2. Contract documents

- [x] 2.1 Add `interactiveSession: boolean` to the `ticket` object in `workerData()` (`packages/core/src/prompts/index.ts`). Verify a render test that `renderWorkerInstructions` / `renderBrief` for an interactive ticket sees the flag (the rendered output changes in 2.2 / 2.3).
- [x] 2.2 In `templates/worker.AGENTS.md.tmpl` and the `WORKER_TMPL` fallback if it grows an "Each turn" section, when `ticket.interactiveSession` is true replace the delivery phase table with the conversational contract (conversation is the posture; do not follow the phase table unless the human asked for changes). Ordinary tickets keep the current table. Verify `renderWorkerInstructions` for interactive vs non-interactive tickets in `prompts/render.test.ts`.
- [x] 2.3 In `templates/brief.md.tmpl` and `packages/core/src/prompts/defaults.ts` `BRIEF_TMPL`, when `ticket.interactiveSession` is true the definition of done and the plan/merge rules describe a conversation-only ending as success and say delivery happens only if the human asked. Ordinary tickets keep today's definition of done. Verify `renderBrief` for both branches in `prompts/render.test.ts`.
- [x] 2.4 In `skills/agent-conductor-worker/SKILL.md`, add an override at the top of the turn-loop / status table: if the ticket is an interactive session, conversation is the posture for every turn and the phase table does not apply unless the human asked for changes in the conversation. Verify by reading the shipped skill text against the contract in task 1.1.

## 3. Supervision exclusions

- [x] 3.1 In `packages/core/src/tickets/service.ts` `livenessViolations()`, skip tickets with `interactiveSession` set (same early-return style as `assigneeHuman`). Verify a new `tickets.test.ts` case: an interactive `todo`/`in_progress` ticket with a live worker, no run and no wake is not a liveness violation; an otherwise identical non-interactive ticket still is.
- [x] 3.2 In `packages/core/src/supervisor/index.ts` `stalledWorkers()`, exclude rows whose ticket has `interactive_session = 1`. Verify a new `supervisor.test.ts` case in the VS-202 block: an interactive ticket that meets every other stall condition is not flagged and raises no `worker.stalled`; a non-interactive ticket in the same shape still is.

## 4. First-turn hold stays

- [x] 4.1 Leave `FIRST_TURN_ALLOWLIST` and the `turnCount === 0` tool ceiling in `packages/core/src/runs/engine.ts` unchanged. Verify the existing VS-101 engine tests still pass (`interactive session first-turn hold`): allowlist on turn 0, restriction lifted on turn 1, ordinary first turn unrestricted, role denial still applies.

## 5. Verification

- [x] 5.1 Run `pnpm typecheck` and `pnpm test` at the repo root and confirm both are green. Paste the pass/fail summary on the ticket.
