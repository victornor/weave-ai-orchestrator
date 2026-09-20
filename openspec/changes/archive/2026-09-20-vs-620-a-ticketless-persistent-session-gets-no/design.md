## Context

See proposal.md — Why. This closes the two residuals VS-618 recorded (its design.md audit row 7 and the reply bookkeeping), building on machinery that already exists:

- `skillsFor` (`packages/core/src/workers/home.ts`) keys on `agent.kind` alone, so a `kind='session'` agent always gets `WORKER_SKILLS`. `skills/manifest.json` declares each skill's audience (`worker`, `weaver`, `all`); the `all`-audience skills are exactly `weave-ai-knowledge` and `weave-ai-artifacts`.
- `takeTicketForSession` (`packages/core/src/workers/index.ts:488-502`) sets `agents.ticket_id` and then calls `renderHome`; `releaseSessionTicket` (`packages/core/src/workers/index.ts:534-536`) clears it and calls `renderHome`. VS-618's D5 deferred skill scoping because it was unsure the ticketed path was guaranteed a re-render at that moment; those re-render calls already exist.
- `sessionReplyContext` (`packages/core/src/runs/engine.ts:682`) resolves a session turn's delivery target: normally from the `human_message` wake; for a retry wake with no thread context it falls back to the session's own thread and `pendingHumanMessages` (`engine.ts:710`), which returns every inbound message after the last agent-authored outbound. A succeeded turn with no final text posts nothing (VS-618), so its waking message never gets an outbound and `pendingHumanMessages` keeps returning it.

## Goals / Non-Goals

**Goals:**

- A ticketless persistent session's home carries no ticket-delivery skill; taking a ticket equips it, and finishing returns it to the ticketless set.
- A completed tool-only session turn consumes its human message for reply-target purposes, so a later turn, retry or resume never re-quotes or re-delivers a message already handled.
- The audit lists every rule that still makes a session's turn end in a message or report, and the weaver's and worker's own rules are untouched.

**Non-Goals:**

- Changing the worker, weaver or planner skill sets, or any weaver rule.
- Changing the session's per-turn instruction (`SESSION_NOW`), its home template (`session.AGENTS.md.tmpl`), or the tool surface a session sees.
- A new skill, capability, endpoint, migration or dependency, and any UI change.

## Decisions

### D1. Scope skills by the agent's ticket posture, not its kind

`skillsFor(ctx, kind)` becomes `skillsFor(ctx, agent)`, where the agent carries `kind` and `ticketId`. A ticketless `session` gets a new `SESSION_SKILLS` = the `all`-audience skills `['weave-ai-knowledge', 'weave-ai-artifacts']`. A `session` with a ticket, a `worker`, the `weaver` and the `planner` keep today's sets exactly, so a ticketed session is still equipped as a worker and no other kind moves.

Chosen over the ticket's fallback (make the skill text conditional on having a ticket) because the checkout and release re-renders already exist, so the cleaner path is safe; the skill files stay single-purpose.

- **Alternative:** strip only `weave-ai-worker` and keep `weave-ai-openspec` / `weave-ai-scout` for a ticketless session. Rejected — those are ticket-phase skills too, and the `all`-audience set is the manifest's own statement of what is not ticket-bound.

### D2. The home marker records the posture, so a posture change forces a re-render

Add the resolved skill posture to the `.ac-render.json` marker and to `currentRevisions`; `ensureHomeCurrent` re-renders when it differs. The explicit `renderHome` calls in `takeTicketForSession` and `releaseSessionTicket` already cover the change at the moment it happens; the marker makes the ticketed path robust to any future path that changes `ticket_id` without re-rendering, and self-heals an existing home on its next turn. A marker written before this change has no posture field and counts as a mismatch — the same self-heal pattern the `runtimeId` field uses (VS-189).

`installBundleFiles` (`packages/runtime-sdk/src/fsutil.ts:92-116`) syncs the skills directory and removes every directory the bundle no longer carries, so the worker skills actually disappear from a ticketless home. It returns early only when the bundle is empty, so the session set must be non-empty — it is.

### D3. A resume answers the messages of the run it resumes

`sessionReplyContext`'s no-thread-context fallback first resolves the run named by the retry payload's `retryOfRunId` (`ctx.db` over `runs.wakeupIds` → those `human_message` wakes' `threadId`/`messageId`). A retry wake without thread context is the watchdog's or boot recovery's resume of one specific run, so that run's own human wakes are exactly the messages the resumed turn answers. A completed tool-only turn consumes its message because a later resume names a *different* run whose wakes do not include it; the thread scan saw the message as still unanswered only because the tool-only turn posted nothing. When the retried run was not human-woken (a self-scheduled run a human message arrived during), the fallback keeps the thread scan — the thread's inbound messages after the last agent-authored outbound.

- **Alternative:** bound the thread scan by the session's last successfully finished run (`runs.list({ status: ['succeeded'] })`). Rejected: `deliverSessionAnswer` runs after `finalize`, so the succeeding run is itself the newest succeeded run and its `startedAt` would sit after the very message the resume is answering — the boundary would swallow every answer. Excluding the current run still lets an unrelated intervening success swallow the message.
- **Trade-off:** one extra `runs` + wakes lookup when a resume without thread context resolves; the fallback runs only on that path, not on every turn.

### D4. Item 3 is an audit, and nothing else needs removing

Read at the change's base (`81efa3ca`). Scope named as **session** (ticketless persistent session), **worker**, **weaver**, **planner**.

| # | Where | Rule / wording | Level | Disposition |
|---|---|---|---|---|
| 1 | `skills/weave-ai-worker/SKILL.md` | "leave progress on a ticket … finish with the structured final report" | session residual | **removed from a ticketless session's home** (D1) |
| 2 | `templates/session.AGENTS.md.tmpl` + `SESSION_TMPL` | "Your final message text is posted to this conversation … write your answer as your final message" | session | kept — it is how a channel-bridged session's answer reaches the human (VS-596/VS-618), not a tidiness rule |
| 3 | `prompts/index.ts` `SESSION_NOW` | "write your reply as your final message; there is no report format to fill in" | session | kept — it already removes the report shape |
| 4 | `tools.ts` `weave_report` description | "does not by itself set your turn's liveness (that comes from your final structured report) … counts as evidence toward the stuck-worker gate" | all kinds | kept — the sentence is the worker/weaver liveness protocol on a tool all kinds can call; a ticketless session's `SESSION_NOW` (#3) already says there is no report, and `weave_report` writes no comment without a ticket. Removing the rule would change the tool contract for the worker and weaver the ticket says to leave unchanged |
| 5 | `tools.ts` `weave_human_send` / `weave_plan_reply` | reply only through the tool | weaver / planner | unchanged — not on a session's surface |
| 6 | `prompts/index.ts` `WORKER_DELIVERY_NOW`, `worker.AGENTS.md.tmpl` | ticket delivery phases; structured final report | worker | unchanged — a ticketless session never gets it (`whatToDoNow`) |
| 7 | `prompts/index.ts` `WEAVER_NOW`, `weaver.AGENTS.md.tmpl`, `skills/weave-ai-weaver` | reply only via `weave_human_send`; structured report | weaver | unchanged — weaver-only |
| 8 | `prompts/index.ts` `INTERACTIVE_*` | ticketed interactive-worker rules | worker (ticketed) | unchanged — the ticketed path keeps worker rules |

Conclusion: after D1, the only rules that make a turn end in a message or report belong to the worker, weaver or planner protocol, or are the session's channel delivery (#2). No session-visible rule exists only to tidy replies.

## Risks / Trade-offs

- **A session's runtime may have discovered the old skills when its session started.** → The runtime CLI is spawned per turn (`--resume`), and skills are read from the home each turn, so the checkout re-render lands before the next turn.
- **A marker written before this change (no posture field) forces one re-render of every home.** → Intended and harmless — the same self-heal as VS-189's `runtimeId`.
- **A resume without thread context does one extra `runs` + wakes lookup.** → The fallback runs only for a retry wake that carries no thread context, not on every turn.
- **The `all`-audience set includes `weave-ai-artifacts`, which a ticketless session cannot publish to.** → Harmless; the set follows the manifest's own audience taxonomy rather than a per-skill judgement, and no rule in it shapes the turn's reply.

## Migration Plan

No data migration, no backfill. After the daemon is upgraded, a ticketless session's next home render removes the worker-audience skills and installs the all-audience set; a ticketed session re-renders on checkout exactly as before. Historical sessions are otherwise unchanged.

## Open Questions

None.
