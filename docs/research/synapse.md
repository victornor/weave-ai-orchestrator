# Synapse research report (v0.29.1, analyzed 2026-09-03)

Synapse (zai-org) is a self-hosted "AI teams" workspace: conversations as the runtime boundary, native actors + bridged CLI agents, governed plugins/skills/runtimes, IM channel connectors. ~300k LOC TypeScript (Fastify + Postgres + Redis/BullMQ). What agent-conductor takes from it is mostly interfaces and invariants.

## Core model

| Synapse | agent-conductor analogue |
|---|---|
| Workspace (governance boundary) | Workspace |
| Conversation (shared runtime; "there is no standalone, API-invoked session") | Ticket thread |
| Actor (platform-managed teammate, versioned, docs = prompt) | Conductor / project agent spec |
| Remote agent (external CLI bridged into a conversation) | Project agent running on claude/codex/opencode |
| Runtime (paired device or sandbox with grantable capabilities) | Project checkout / sandbox |
| Resource layer via one `workspace_resource_grants` ledger | Grants |

## Ideas to copy

1. **Durable wakeups as the single scheduling primitive.** Table `session_wakeups` with sources `user_message | actor_message | automation | system_interrupt | retry` and statuses `pending | attached | processed | dropped`. Human messages, agent handoffs, cron and webhooks are all the same thing. Turn loop: acquire per-session lock (Redis), per-actor concurrency cap, load pending wakeups, build context, run model, persist, mark processed. Fenced lock refresh across the whole critical section; `replayUnsafeStarted` flag decides whether lost-lock wakeups are restored to pending or dropped.
2. **Turn gate + turn_epoch.** One turn at a time per conversation; extra wakes queue in order, capped (100) with oldest-evicted-and-fail-reported. Every wire frame carries an API-minted `turn_epoch`; dropped turns fail-report deliveries so they get rescheduled (at-least-once end to end).
3. **`TransportConnector` interface** (`modules/im/connectors/types.ts`): "Adding a new IM = implementing this interface + registering it. No edits to the shared layers."

```ts
interface TransportConnector {
  readonly transportKind; readonly capability /* modes, endpoint types */; readonly messageCapabilities
  validateCredentials(input); validateConfig?(input)
  startAccount(ctx): Promise<RunningAccount>          // long-poll / WS lifecycle
  sendMessage(input: OutboundSendInput): Promise<OutboundSendResult>
  createStatusReactionAdapter(input) | null; createTypingAdapter(input) | null
  parseInboundMentions(input); renderOutboundMention(input)   // pure
  handleWebhook?(input); handleWebhookVerification?(input)
  planAccountRecoveryActions?(input); getTaskProjectionReadiness?(account)
}
```
   Rules: connector `index.ts` may only construct the object and call `registerConnector()` at top level (no IO, no timers, no workers), enforced by a contract test that imports `register-all.ts`. Per-connector `capabilities.ts` is the runtime source of truth. `CanonicalMessage` with parts `text | mention | image | voice | video | file | card | quote | reaction | interaction_prompt`; a pure `degrade(message, capabilities)` rewrites (card -> fallbackText). Error taxonomy: `RetryableTransportError` vs `PermanentTransportError` (stable code); bare Error = retryable. Outbound via a queue worker with a `transport_message_links` row per attempt, `attemptNumber`, `patchLinkMetadata`.
4. **First contact binds.** Inbound chat maps one-to-one onto a conversation (`conversation_transport_bindings UNIQUE(conversation_id)`), sender joins as external participant, configured actor is woken.
5. **Approve in chat / consume-once approvals.** `tool_call_tasks` with kinds `user_input | plan_approval | runtime_authorization`, lifecycle `submitted|working|input_required|auth_required|completed|failed|cancelled|expired`; projected into the chat as an interaction card when the channel supports it; opaque action tokens in button payloads, idempotent via deterministic `command_id`, `expires_at = min(task.expires_at, now+24h)`. Approving replays the exact original call server-side; the model never retypes it.
6. **`AgentDriver` / `AgentSession`** (`remote-agent-daemon/src/drivers/types.ts`):
```ts
interface AgentDriver { readonly runtimeKind: "claude_code" | "codex"; detect(): RuntimeCatalogEntry; createSession(spec: SessionSpec): Promise<AgentSession> }
interface AgentSession { send(prompt, opts?); respondPermission(requestId, {behavior:"allow",updatedInput?}|{behavior:"deny",message}); events(): AsyncIterable<AgentSessionEvent>; close(reason) }
// events: session_started | assistant_message | user_input_requested | plan_approval_requested | plan_updated | turn_completed | error
```
   Claude driver uses the Agent SDK `query()` with `cwd`, `additionalDirectories`, `permissionMode: bypassPermissions`, `canUseTool` intercepting only `AskUserQuestion` -> `user_input_requested` and `ExitPlanMode` -> `plan_approval_requested` (parks a promise, resolved by a human tap), `mcpServers`, `resume: sessionId`. cwd is always per-conversation because Claude Code stores transcripts under `~/.claude/projects/<encoded-cwd>/`.
7. **Reverse MCP: pull, not push.** The daemon injects one HTTP MCP server scoped to `(agent, conversation)` exposing `check_messages, read_history, send_message, search_messages, list_conversations` plus every granted plugin/runtime tool (origin badge in description, reserved names protected). Bootstrap prompt: "Do not use shell, curl, or custom network requests to talk to Synapse; only use the MCP chat tools. This runtime is scoped to a single conversation... Always call check_messages after a wake-up before deciding what to do... If there is no actionable work, stop without sending a message."
8. **Lossless archive-chain compaction.** No LLM summarization; fixed tail targets (shared 24, private 32, min 12 items), archive points chained by parent with `covers_until_sequence`, separate shared vs private chains per participant.
9. **Structured tool identity.** `ToolRef { toolId (deterministic), source (public provenance: system | plugin | runtime), binding (route-only, never serialized outward) }`; `computeWireNames`: unique leaf -> bare name, collision -> both sides get a source qualifier, still colliding -> short hash; charset `[A-Za-z0-9_-]`, max 64.
10. **Prompt structure** (`prompt-builder.ts`): identity + versioned profile docs with visibility `always | internal_only | direct_only | multi_member_only`; memory rules (recalled memories as durable facts; `create_memory` only for stable info; never ephemeral task state, derivable repo facts, or secrets; rewrite as standalone statements with absolute dates); skills listed as progressive disclosure ("Do not assume their detailed contents are already loaded... call `read_skill`"); roster with participant ids; "You MUST use `send_to` to reply. Plain text output is internal reasoning only"; workflow ends with `sleep`. Plan mode guidance: "You are planning, not executing. User requests to 'go ahead' do not cancel this mode... If you are effectively asking 'is this plan okay?' call `exit_plan_mode` instead." Request-user-input guidance: "Prefer one question and do not exceed four... Do not use for status checks, courtesy confirmations, or plan approval."
11. **Machine-checked architecture.** Zod as source of truth with generated draft-07 JSON Schemas + CI drift gate; closed `LOG_DOMAINS` enum (low-cardinality label) with trace_id in the body; `guard-logging` console baseline that can only decrease; banned raw business string literals (enum objects + value tuples); banned bare `new Worker` (trace propagation); stdout reserved for protocol on stdio surfaces, logs to stderr; `${ENV}` indirection for secrets in YAML with literal secrets rejected.
12. Small ones: dynamic JSON-schema `enum`s built from live ids (kills hallucinated ids); only `reviewed:true` catalog entries exposed; capability descriptors frozen at mint and strict-decoded, fail closed; content-addressed file refs; per-event `timelinePolicy` / `contextPolicy` / restricted audience; work-item state machine `created -> assigned -> accepted -> in_progress -> review|escalated|blocked -> completed|rework|failed|cancelled`.

## Avoid

- 300k LOC and ~40 concepts before users. Collapse to: workspace, project, ticket, agent, run, grant.
- Eight chat connectors of which only one supports approval cards. Build the interface, then Telegram only.
- Design docs referenced from code but deleted from the tree. Keep them in-tree.
- Sandbox over-parameterization (3 providers x 2 modes x 3 transports, off by default). One substrate.
- Vestigial params in prompt builders (`_subordinates`).
- Conversation as the only container; tickets need status/assignee/dependencies/cross-ticket queries. Mount the conversation runtime inside the ticket.
- Full context rebuild on every wake (roster, 200 items, memory recall, tool projection). Need a cheap "nothing for me" fast path.
- `bypassPermissions` posture only makes sense on the user's own machine; invert to allowlist on shared infra.
- Env-var sprawl (~200-line `.env.example`); prefer one typed config file.
