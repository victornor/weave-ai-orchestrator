## Context

See `proposal.md` — Why. Three facts from the current code shape the approach:

- The conversational instruction is a single ternary in `buildTurnPrompt` (`packages/core/src/prompts/index.ts`): `ticket.interactiveSession && agent.turnCount === 0` picks the first-turn hold text; every other worker turn gets the delivery one-liner ("do the phase your ticket status asks for"). `agent.turnCount` is the count *before* the current turn (`finalize` increments it after).
- The first-turn *tool* hold is a separate ceiling in `runs/engine.ts` (`FIRST_TURN_ALLOWLIST`, same `turnCount === 0` predicate). Product decision 2026-09-07: that hold is a fact the runtime enforces, not prompt tone. Engine tests already pin the allowlist on turn 0, the lift on turn 1, and no restriction on a non-interactive first turn.
- The delivery contract is repeated, independently, in three more places that survive past turn 0: `templates/worker.AGENTS.md.tmpl` ("Each turn" phase table), `templates/brief.md.tmpl` (definition of done, plan/merge rules), and `skills/agent-conductor-worker/SKILL.md` (loaded every turn). Changing only the one-liner leaves the agent instructed to deliver. VS-211: `brief.md.tmpl` and `worker.AGENTS.md.tmpl` both render from `workerData()` and independently repeat the same instructions — fix both, from the same flag.

Two supervision paths treat a quiet open ticket as unfinished work:

- `livenessViolations()` (`tickets/service.ts`) includes `todo` / `in_progress` / … with a live worker, no run, no wake. The 60 s `livenessScan` then enqueues `liveness_repair`. An interactive ticket stays `todo` after the greeting comment, so this can fire a second turn *before the human has spoken*.
- `stalledWorkers()` (`supervisor/index.ts`, VS-202) matches a worker on a non-terminal ticket with nothing left to wake it and `last_run_at` older than the threshold. A finished conversation is that shape exactly. It does not exclude `interactive_session`.

The 2026-09-10 silence and the unwanted merge approval (ACME-19) are one event under the prompt flip (the agent stops conversing and starts delivering). `liveness_repair` is a confirmed independent cause of the same pair of symptoms, and is in scope under "not treated as incomplete."

## Goals / Non-Goals

**Goals:**

- Session-wide conversational contract, asserted by tests that drive turn 0, turn 1 and a later turn — not by moving the `turnCount` check.
- First-turn tool hold unchanged.
- Escalation, when the human asks, is the existing ticket flow and its gates.
- Interactive tickets excluded from liveness repair and stalled-worker detection.
- Non-interactive workers bit-identical in prompt, brief, tools, liveness and stall.

**Non-Goals:**

- A new ticket column, escalate tool, or "session phase" state machine.
- Widening or keeping the first-turn allowlist after turn 0.
- Changing idle-session cancel (`interactiveSessionIdleTimeoutMinutes`).
- Detecting "the human asked" in software. That judgement stays with the agent, under the new contract.
- A new skill. The worker skill gets an override paragraph; it is already loaded every turn.

## Decisions

### 1. Express the posture as a session-wide prompt plus a contract document, not a capability restriction

The ticket named three plausible shapes. Chosen: a distinct "What to do now" for every interactive turn, *and* the same contract in the rendered brief / worker `AGENTS.md` / worker skill. Not a post-first-turn tool allowlist.

*Why not just move `turnCount === 0`.* That would apply the first-turn hold forever: no Shell, no investigation beyond Read/Grep/Glob, and no way to write a plan when the human asks. The ticket forbids this.

*Why not a capability restriction after turn 0.* VS-101 rejected prompt-only for the *wait* because the human had not spoken yet. After they have, they need investigation tools, and they need write/transition tools the moment they ask. A second allowlist would need a lift — a new flag, a new tool, or a decision card — which is a product surface the ticket does not ask for. When they ask, "joins the standard flow" means the role's ordinary tools plus the existing plan/merge gates.

*Why prompt + contract, not prompt alone.* After turn 0 the system prompt is `skip` (`engine.ts`: inject only on `turnSession.isFirstTurn`). The session still has the first-turn `AGENTS.md` (phase table, definition of done) and the worker skill (phase table, loaded every turn). The one-liner cannot win against those. `workerData()` already has the ticket; add `ticket.interactiveSession` and condition both templates. The skill cannot be templated per ticket (VS-211 left skills static); add a short override the agent evaluates from its ticket: if this ticket is an interactive session, conversation is the posture and the phase table does not apply unless the human asked for changes.

*First-turn text stays the hold text.* Later interactive turns get a different paragraph: answer / investigate / explain; do not deliver unless asked; if you think a change is warranted, ask in the conversation and wait; a conversation-only ending is success. Ordinary workers keep today's one-liner.

### 2. Keep the first-turn tool allowlist keyed on `turnCount === 0`

No change to `FIRST_TURN_ALLOWLIST` or the engine predicate. Existing VS-101 engine tests stay the assertion that the hold is a ceiling, not a hope, and that it lifts on turn 1.

### 3. Exclude interactive tickets from both "unfinished work" scans

`livenessViolations()`: skip `t.interactiveSession` (same early-return style as `assigneeHuman` / open decision / merge-queue wait). `stalledWorkers()` SQL: `AND t.interactive_session = 0`. Idle-session cancel is unchanged and remains the closer for a session nobody is talking to.

*Alternative considered:* only exclude from VS-202, leave liveness. Rejected — `liveness_repair` is the more urgent of the two (60 s vs. a multi-minute stall threshold) and is what can start delivery before the human's first message.

### 4. Tests assert instructions and supervisor behaviour across several turns, not an LLM

No runtime LLM. The multi-turn acceptance criterion is: `buildTurnPrompt` (or a full `executeRun` that writes `prompt.md`) for an interactive ticket at `turnCount` 0, 1 and 2 contains the conversational contract and does not contain the delivery one-liner; a non-interactive ticket at the same counts contains the delivery one-liner and does not contain the conversational contract. Sibling tests: first-turn allowlist unchanged; second-turn tools unrestricted; `livenessViolations` / `stalledWorkers` skip interactive and still match ordinary tickets; rendered brief / `AGENTS.md` for `interactiveSession: true` omit the phase table and the delivery definition of done.

"Does not write code unless asked" is the contract those prompts carry. Enforcing it as a tool ceiling is Decision 1's rejected alternative.

## Risks / Trade-offs

- [An agent with full tools after turn 0 can still ignore the contract and start delivering] → Same class of risk as every other prompt-enforced rule after the first-turn hold lifts. Mitigation is making the contract the loudest instruction in every layer that currently says "deliver," and asserting those layers in tests. A later ticket can add a hard lift if this is not enough.
- [YOLO on the project would auto-approve a plan if the agent proposed anyway] → Out of scope to special-case YOLO; the contract says not to propose unless asked. Mentioned so apply does not "fix" YOLO as a side quest.
- [`docs/prompts/worker.AGENTS.md.tmpl` still has the old phase table] → That file is a superseded draft, not rendered. Do not edit it.
- [A session started against an already-open delivery ticket inherits `interactiveSession: true` and would then stop being driven by liveness] → That is the product: starting a session marks the ticket interactive. Idle-cancel still ends it. If the human asks for work, ordinary gates apply.

## Migration Plan

None. Prompt, template and two SQL/filter predicates; no schema, no API. Rolls forward with the next release; rollback is the previous release.

## Open Questions

None. The posture-expression choice the ticket left open is Decision 1.
