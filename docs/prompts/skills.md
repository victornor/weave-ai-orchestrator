> **Superseded — this is the outline, not the source of truth.**
> The shipped skills live in `skills/`, one directory per skill with `SKILL.md` and `references/`, indexed by
> `skills/manifest.json` (skill → audience) and documented in `skills/README.md`. Change those; this file is
> kept only as the record of the outlines they were written from.

# Skills shipped by AgentConductor — outlines and key rules (draft v0.1)

Each skill is a `SKILL.md` with frontmatter `{ name, description, allowed-tools }` and a `references/` directory for progressive disclosure. The daemon installs them into agent homes per runtime. Rules marked (verbatim) are lifted from the research files and should be kept close to that wording.

## agent-conductor-worker (workers)

Trigger: every worker turn.

Sections:
1. Turn loop (as in the charter+brief, expanded with tool call examples). First turn: verify the brief's Setup with `ac_worktree_status`; relaunch: read the relaunch note and the ticket's documents before continuing.
2. Ticket rules:
   - Checkout before writing. Never retry a 409 (verbatim, paperclip).
   - Never look for other work. Your ticket is your only work; nothing to do = idle turn.
   - Use first-class blockers (`blockedBy`) rather than prose "blocked by X".
   - Status semantics: `in_progress` means you are actively working or will resume next wake; `in_review` requires a work product and a real reviewer path; `blocked` requires blockers, an open decision, or `{owner, action}`.
   - Only claim a monitor/watcher exists after you scheduled one; describing it does not create it (verbatim).
3. Communication rules:
   - `ac_report` states and when to use `paused` (known external wait that clears itself) vs `blocked` (you need help).
   - Verify writes, never infer them: every `ac_*` write returns `{ok:true, data}`; anything else is a failure to report (adapted from paperclip).
   - Bounded retry: the same control-plane write failing twice ends retries for this turn.
   - Ticket references as links `[ACME-42](conductor://tickets/ACME-42)`; multiline markdown preserved (write comment bodies from files/heredocs, never one-line JSON).
4. Worktree: `work/` is your only worktree; `ac_worktree_status` before starting; read `work/AGENTS.md` first.
5. Delivery modes (`pr` / `local-branch`) with exact git and `gh` commands, and the `merging` procedure: fetch, rebase onto default (or merge it in, per project convention), resolve conflicts (re-run tests and lint; if resolution changes specified behavior, `ac_ask` first), push with `--force-with-lease`, wait for CI when required, `gh pr merge --<method>`, `ac_ticket_merge_done`. On failure → `blocked` with owner `conductor`.
6. Final report schema with examples for each state.
7. Common mistakes table (mistake / why it is wrong / what to do instead).

references/: `tools.md` (every `ac_*` tool with input/output), `delivery.md`, `report-examples.md`.

## agent-conductor-openspec (workers)

Trigger: a `change` (or `task` with tracker) ticket.

- Mapping table: ticket status → OpenSpec workflow to invoke → what "done with this phase" means → transition to request.
- The change name is given in the turn prompt and in `ac_ticket_get(...).openspecChangeName`; it exists; never ask whether to create or continue it; never pick a different change.
- Propose: planning artifacts only (verbatim from OpenSpec: "Do not edit project code. After the planning artifacts are complete, stop."). Material ambiguity → `ac_ask` with options, not a question in prose. Then `ac_ticket_transition(id, "proposed")`; if rejected, fix the listed validation issues.
- Apply: read `openspec instructions apply --change <c> --json`; implement pending tasks; tick `- [x]` only when fully implemented; commit per task or logical group; scope beyond the spec → `ac_ask` and pause that task.
- Never run `/opsx:archive` or `openspec archive`. Never `openspec update`.
- Revision feedback arrives as a comment + status back to `proposing`; update artifacts and re-transition.

references/: `openspec-cli.md` (the exact JSON fields the agent may rely on), `troubleshooting.md` (validation error codes and fixes, `skip_specs`).

## agent-conductor-scout (workers)

Trigger: a `scout` ticket.

- Deliverable is the `report` document (`ac_ticket_document_put(id, "report", body)`), never code. The worktree is a laboratory; scratch commits are fine on a throwaway branch; never push.
- Report structure: Question / What I did / What I found (evidence: commands, output, `file:line`) / Recommendation / Open questions. Must stand alone.
- Transition to `done` when the report is complete; a recommendation to implement is a recommendation, not a ticket (the conductor decides).

## agent-conductor-conductor (conductor)

Trigger: always (it is the procedural half of the conductor charter).

- Intake classification and routing procedure with examples.
- Ticket creation template: title (imperative, ≤ 70 chars), description with Context / Request / Acceptance criteria / Out of scope / Links; kind and priority heuristics.
- Supervision: reading the digest; the unblock ladder (answer → reroute → courier ticket → escalate); when to pause an agent; when to reset a session (only with a reason and never with uncommitted work).
- Gate-finding authority (adapted from firstmate ask-user-authority): decide when unambiguous toward the accepted design; escalate contract expansions, product calls, repeated same-theme findings, destructive/security-sensitive choices. Escalation form: the original requirement, the proposed expansion, the smallest compliant alternative, consequences of both, recommendation.
- Outcome language and translation table (as in the charter, with more examples), the "one decision per message" rule, acknowledgement when work will take time.
- Relaying worker output: never verbatim; read as evidence, send the outcome and the next decision. When the human wants to talk to a worker directly, point them at the ticket (`/talk <ticket>`); never proxy a conversation.

references/: `examples.md` (good vs bad conductor replies), `routing.md`.

## agent-conductor-hire (conductor)

Trigger: no agent fits a ticket; the human asks to add a role; repeated charter problems.

Procedure:
1. `ac_role_list` for the project; compare each `scope` and charter summary against the need. Reuse on match (a role serves many concurrent tickets); on partial overlap, hire and sharpen both charters.
2. Draft the spec: name ("<Role> (<project>)"), role, one-sentence charter summary, natural-language scope (used for routing, so make exclusions explicit), 5–9 responsibilities, capabilities (tools/stack), project rules pulled from the project card, runtime = project default, budget from workspace defaults.
3. `ac_role_hire(spec)`; tell the human what was hired, that it awaits their confirmation, and that they can switch its CLI before its first worker runs.
4. After activation, assign the ticket.
5. Refinement: when workers of a role repeat a mistake, `ac_role_update_charter` with a concrete added rule under "Conductor's notes" and a reason; prune the role's memory when it drifts.

references/: `spec-schema.md`, `role-examples.md` (backend, frontend, qa/reviewer, docs, devops), `checklist.md`.

## agent-conductor-planning (conductor; agents when decomposing)

- Minimize the ticket graph (verbatim from paperclip's converting-plans-to-tasks): one end-to-end ticket with one owner by default; split only for a qualifying boundary (different owner/project, parallelizable self-contained deliverable, hard dependency needing its own blocker lifecycle, independent review gate, substantial follow-up); merge-back pass; every child names its reason.
- Acceptance criteria format; when to prefer a `scout` first (unresolved uncertainty that would change what to build).
- "Enough is enough": re-planning a plan is procrastination; ship something.

## agent-conductor-briefing (conductor)

- `ac_briefing()` is the only source; never assemble a second reader from ticket lists or memory.
- Render four sections, always, in order, never a delta: **Needs you** (only items requiring the human's own action, each with a link and a recommended answer) / **Recently landed** / **Under way** (one line per agent) / **Up next** (queued, waiting on agents or dates; warnings that need no action).
- Empty-state lines for each section. Then, if Needs-you is non-empty and the human asked what you need, present the single highest-impact decision in full and wait.

## agent-conductor-knowledge (all agents)

- What belongs where: project KB (what the next worker on this project needs: stack and commands, project conventions the repo does not state, landmines, dated learnings) vs workspace KB (conductor only: the business, the portfolio, how the human works, standing policies) vs SHARED.md (conductor-written, project-agnostic conventions every worker sees) vs repo docs (anything a future contributor needs regardless of AgentConductor; goes through a PR) vs ticket (task state, findings, decisions).
- Entry rules: ≤ 60 words, standalone, absolute dates, no pronouns, no secrets, no copies of code, nothing derivable from git. At most one note per ticket unless something surprising happened. Perishable entries carry `<!--exp:YYYY-MM-DD-->`.
- `ac_knowledge_note` returns remaining budget; a rejected write (duplicate, too long, over budget) is not retried; say so in the final report.
- Curation turn (when the ticket is "Curate project knowledge" or the conductor is asked to curate a workspace file): read the whole file and, for a project KB, fact-check against `work/`; merge duplicates; move learnings that became conventions into Conventions; remove entries now stated in the repo or contradicted by it; archive stale ones; tighten wording; keep each section within its share of the budget. Never add a fact. Submit with `ac_knowledge_replace` and list every removed entry with a reason in the ticket comment.
