# Paperclip research report (analyzed 2026-09-03)

Paperclip (paperclipai): "If OpenClaw is an employee, Paperclip is the company." Express 5 + Postgres (Drizzle, embedded by default) + React; 125 tables, ~600 routes, a 25k-line `heartbeat.ts`. Inspiration for org structure, tickets, run logging, cost/budget telemetry, adapters and plugins.

## Core loop

1. Trigger (timer, assignment, mention, on-demand, automation) -> wakeup request.
2. Server calls adapter `execute()`; adapter spawns the CLI with injected env + prompt.
3. Agent calls the REST API (short-lived run JWT) guided by an injected skill: check inbox, checkout ticket, work, comment, set disposition.
4. Adapter captures stdout/events, parses usage/cost, extracts session state.
5. Server records the run, cost events, session params for the next wake.

Injected env: `PAPERCLIP_AGENT_ID, COMPANY_ID, API_URL, API_KEY (run JWT), RUN_ID, TASK_ID, WAKE_REASON, WAKE_COMMENT_ID, WAKE_PAYLOAD_JSON, APPROVAL_ID/STATUS, LINKED_ISSUE_IDS, WORKSPACE_*`.

## Key tables (columns worth copying)

- `companies`: issuePrefix + issueCounter (human ids `PAP-224`), status, budget, requireBoardApprovalForNewAgents.
- `agents`: name, role, title, icon, status (`active|paused|idle|running|error|pending_approval|terminated`), reportsTo (self-FK tree), capabilities, adapterType, adapterConfig, runtimeConfig, budgetMonthlyCents, permissions, lastHeartbeatAt. `agent_config_revisions` {changedKeys, before, after, rolledBackFromRevisionId} with rollback route.
- `issues`: identifier, title, description, status (`backlog|todo|in_progress|in_review|done|blocked|cancelled`), priority, workMode (`standard|ask|planning|skill_test`), parentId (structure only), assigneeAgentId XOR assigneeUserId, checkoutRunId (ownership) vs executionRunId (live run), originKind, originFingerprint, responsibleUserId, unblockDescriptor, monitorNextCheckAt, sourceTrust.
- `issue_relations` typed `blocks` edges (first-class blockers; cancelled blockers do NOT satisfy). Auto-wakes `issue_blockers_resolved`, `issue_children_completed`.
- `issue_comments` (run-attributed), `issue_documents` + revisions + annotations (plans live in document key `plan`), `issue_work_products` (`pull_request|preview_url|runtime_service|commit|branch|artifact`), `issue_thread_interactions` (`suggest_tasks|ask_user_questions|request_confirmation|request_checkbox_confirmation|request_item_verdicts`, each with resolverPolicy, continuationPolicy, idempotencyKey, revision-bound target).
- `heartbeat_runs`: status (`queued|scheduled_retry|running|succeeded|interrupted|failed|cancelled|timed_out`), invocationSource (`timer|assignment|on_demand|automation`), usageJson, sessionIdBefore/After, logStore/logRef/logBytes/logSha256, stdout/stderrExcerpt, processPid, retryOfRunId, livenessState (`completed|advanced|plan_only|empty_response|blocked|failed|needs_followup`), contextSnapshot.
- `heartbeat_run_events`: monotonic `seq` per run, unique `(runId, seq)`, `(runId, sourceEventId)`, `sourcePayloadSha256` for exactly-once ingestion; redaction on write path; `run.phase.timing` with a closed 12-name phase allowlist (free-form labels dropped).
- `agent_wakeup_requests`: source, reason, payload, status (`queued|deferred|claimed|coalesced|skipped|completed|failed|cancelled`), coalescedCount, idempotencyKey. Every suppressed wake is a `skipped` row with a reason.
- `agent_task_sessions` unique `(companyId, agentId, adapterType, taskKey)` -> sessionParamsJson; `agent_runtime_state` per agent with lifetime token/cost rollups; reset-session route.
- `cost_events`: companyId, agentId, issueId, projectId, goalId, runId, billingCode, provider, biller, billingType (`metered_api|subscription_included|subscription_overage|credits|fixed|unknown`), costStatus (`reported|unpriced`), model, input/cached/output tokens, costCents, occurredAt. `usageBasis: per_run | session_cumulative` (server deltas cumulative sessions).
- `budget_policies` (scopeType company|agent|project, metric, windowKind calendar_month_utc|lifetime, amount, warnPercent 80, hardStopEnabled) + `budget_incidents` (soft/hard, approval link). Checked pre-dispatch (`getInvocationBlock`) and post cost-event; hard stop pauses scope AND cancels queued work.
- `activity_log` (actorType, actorId, action, entityType, entityId, agentId, runId, responsibleUserId, details) written on every mutation. responsibleUserId propagates user -> issue -> run -> activity -> cost.
- `approvals` (`hire_agent|approve_ceo_strategy|budget_override_required|request_board_approval`; `pending|revision_requested|approved|rejected|cancelled`).
- `routines` (`schedule|webhook|api` triggers; concurrency `coalesce_if_active|always_enqueue|skip_if_active`; catch-up policies) creating real issues, deduped by `(originKind, originId, originFingerprint)` while open.

## Adapter contract (`packages/adapter-utils/src/types.ts`)

```ts
interface ServerAdapterModule {
  type: string
  execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult>
  testEnvironment(ctx): Promise<AdapterEnvironmentTestResult>
  listSkills?(ctx); syncSkills?(ctx, desiredSkills: string[])
  sessionCodec?: { deserialize; serialize; getDisplayId }
  supportsLocalAgentJwt?; runtimeToolDelivery?: "native_mcp" | "environment" | "invocation_context"
  models?; listModels?(); refreshModels?(); detectModel?()
  agentConfigurationDoc?: string        // served at GET /llms/agent-configuration/<type>.txt
  onHireApproved?(payload, adapterConfig); getQuotaWindows?()
  getConfigSchema?(): AdapterConfigSchema   // declarative form, no React needed
  supportsInstructionsBundle?; instructionsPathKey?; requiresMaterializedRuntimeSkills?
  getRuntimeCommandSpec?(config); loginCapability?
}
interface AdapterExecutionContext { runId; agent; runtime: { sessionId, sessionParams, sessionDisplayId, taskKey }; config; context; executionTarget?; runtimeMcp?; onLog(stream, chunk); onEvent?(event); onSpawn?({pid, processGroupId}); authToken? }
interface AdapterExecutionResult { exitCode; signal; timedOut; errorMessage?; errorCode?; errorFamily?: transient_upstream|provider_quota|model_refusal|refresh_token_*; retryNotBefore?; usage?; usageBasis?; sessionId?; sessionParams?; provider?; biller?; model?; billingType?; costUsd?; resultJson?; summary?; clearSession?; question? }
```

Invocation facts:
- claude: `--print --output-format stream-json --verbose [--resume <id>] [--model] [--effort] [--max-turns] [--append-system-prompt-file <f> only when NOT resuming] [--mcp-config <f> --strict-mcp-config] --add-dir <bundle>`. Comment: "On resumed sessions the instructions are already in the session cache; re-injecting them via --append-system-prompt-file wastes 5-10K tokens per heartbeat."
- codex: `exec --json [--skip-git-repo-check] [--dangerously-bypass-approvals-and-sandbox] [--model] [-c model_reasoning_effort=..] [resume <id>] -` (prompt over stdin).
- opencode: `run --format json [--session <id>] [--model provider/model] [--variant]`.
- Three feedback tiers: native ACP engine (structured events), CLI JSON wrappers, generic process/http (plain lines). Transcript entries are a typed union (`assistant, thinking, user, tool_call, tool_result, init, result, stderr, system, diff, ...`); external adapters ship their own `ui-parser.ts`.
- Adapter types are an open registry (`registerServerAdapter`), external adapters as npm packages exporting `createServerAdapter`.

## Execution semantics worth copying (doc/execution-semantics.md)

- Status is a contract about who owns the next move. `in_progress` must be execution-backed. `blocked` requires a routable waiting path (first-class blockers, a pending interaction/approval naming a responder, or a structured unblockDescriptor {owner, action}); prose-only blocked is rejected. `in_review` requires a real reviewer path ("Assignment to yourself plus a 'please review' comment is not a review path").
- Liveness contract: every non-terminal ticket must have at least one action path: active run, queued wake, typed execution participant, pending interaction/approval, scheduled monitor, human owner, healthy blocker chain, open recovery action. Enforced as a state guard (`invalid_issue_disposition`), not prose. "An unmanaged local process is not a durable action path."
- Run-scoped write authorization is subtree-scoped (a run may mutate its checked-out ticket and descendants). Lateral coordination = the courier pattern (create a self-contained ticket assigned to the target agent).
- Child -> parent report channels: completion signal (always), direct-parent report comment (trust-gated), stop-only relay on blocked/cancelled. Low-trust reviewers' comments are "a prompt-injection carrier into higher-trust context"; `sourceTrust` on issues/comments/work products.
- Lock lifecycle: compare-and-clear on finalization; never clobber a successor's lock; sweeper adopts only terminal/missing-run locks. "Stale-lock recovery is crash recovery, not a retry loop."
- Wake funnel gates in order: enrich context -> drain mode -> company active -> session resolve -> budget -> coalesce -> insert.
- Three watchdogs: task watchdog (subtree at rest), silent active-run watchdog (no output N min), liveness recovery scan.

## The `paperclip` skill (agent-facing instruction layer)

"You run in heartbeats — short execution windows triggered by Paperclip. Each heartbeat, you wake up, check your work, do something useful, and exit."

Nine steps: identity -> approval follow-up -> inbox -> pick work (`in_progress > in_review > todo`, skip blocked) -> checkout -> context (`heartbeat-context`, incremental comments `?after=`) -> work -> update status & communicate -> delegate. Scoped-wake fast path: if the wake payload names a ticket, skip steps 1-4.

Rules to lift nearly verbatim:
- "Verify writes — never infer them. A successful PATCH always returns the updated JSON. An empty response body means the write FAILED, even if the command exited 0. Never pipe a disposition write through head/tail and never rely on curl -f inside a pipeline."
- "Bounded write retry. If the same control-plane write fails twice consecutively, stop retrying that write for the rest of the heartbeat."
- "Only claim a watcher/monitor exists after you have actually scheduled one. Describing a watcher in a comment does not create it."
- "Never retry a 409." "Never look for unassigned work. No assignments = exit." "Never cancel cross-team tasks." "Use first-class blockers." "@-mentions trigger heartbeats — use sparingly, they cost budget." "Escalate via chainOfCommand when stuck."
- "NEVER ASK A HUMAN TO DO WHAT AN AGENT COULD DO. ... Try harder. Try again. Ask another agent to help."
- Plans go in the issue document `plan`, not the description, not repo files; "If you're asked to make a plan, do not mark the issue as done."
- Reviewer delegates post findings on their own review ticket and mark it done; the verdict is the deliverable.
- Credentials: propose as a secret immediately; never paste into comments/docs/files.
- Ticket references must be markdown links; multiline markdown via heredoc, never one-lined JSON.
- Common Mistakes table format: mistake / why wrong / what to do instead.

`paperclip-converting-plans-to-tasks`: "Minimize the issue graph. Prefer one end-to-end task with one owner." Split only for a qualifying boundary (different owner/permission, parallelizable deliverable, hard dependency lifecycle, independent review gate, substantial follow-up); merge-back pass; "Take responsibility"; "Enough is enough... ship something."

`paperclip-create-agent`: discover adapters via `/llms/agent-configuration.txt`, compare existing agent configs, choose template, draft, checklist, `POST /agent-hires`, approval. Defaults: timer heartbeats off; managed instructions bundle over promptTemplate; justify any capability expansion.

## Integration surface

- REST with three principal kinds (run JWT, agent API key, user session); 409 documented as "do not retry"; `llms.txt`-style self-describing endpoints.
- MCP server fronting the REST API (~44 tools) plus an inbound MCP gateway with tool profiles and ask-first approval gates ("Approval means approve and run: Paperclip executes the stored, signed call arguments exactly once").
- Webhooks: routine triggers (`bearer|hmac_sha256|github_hmac|none`), plugin webhooks, HTTP adapter outbound.
- Plugins: platform modules (in-process registries: adapter, storage, secret, run-log store) vs plugins (out-of-process worker, capability-gated manifest with jobs, webhooks, tools, db, apiRoutes, ui slots namespaced by plugin id). Non-goals: plugins cannot override core routes or mutate approval/auth/checkout/budget logic.
- Company export/import as git-native markdown packages (`TEAM.md`, `agents/*/AGENTS.md`, `projects/*/PROJECT.md`, `tasks/*/TASK.md`, `skills/*/SKILL.md`), secret-scrubbed.
- Three named data paths with different review levels: Telemetry (phones home; strict) / Observability (OTLP, operator-gated) / Run log (local). "Apply this rule by path, not by word match."

## Avoid

25k-line service file (fix module boundaries first: wake-queue, dispatch, run-lifecycle, workspace-resolution, budget-gate, event-sink, recovery); 125 tables and parallel work models (cases/pipelines beside issues); issue/task/ticket naming split; two budget systems (denormalized spent + policies); four-layer instruction stack; enum-as-text columns; JSONB expression joins run->issue (use a real FK); same-origin plugin UI; telemetry on by default; fixed role enum; `union | (string & {})` scars; trust boundaries designed after the fact; a second "native runner" engine; doc sprawl across `doc/` and `docs/`.
