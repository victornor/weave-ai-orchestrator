# AgentConductor HTTP API (v1)

Base: `/api`. Workspace-scoped routes: `/api/w/:ws/...` where `:ws` is the workspace id (slug). JSON in/out. Errors: `{ error: { code, message, details?, retryable } }` with the status from `OcError.status(code)`.

Auth: `Authorization: Bearer <token>` (CLI/presenter) or the `ac_session` httpOnly cookie (web). Loopback listener accepts run tokens (`Bearer rt_...`) for `/mcp/runs/:runId` and `/api/w/:ws/agent/*` only.

## Daemon-level
- `GET /api/health` → `{ ok, version, release: { version, path, sha }, workspaces: [{id, name, status}], operatorConfigured, tlsMode, publicUrl, host: { platform, hostname, tools: { git|gh|openspec|wt: { available, version, need, purpose } } } }` — `host.tools` is the daemon host's tool detection (cached 60 s), which is what a remote `conductor doctor` reports. `release` is the release directory **this process is executing** (never what `current` points at, which an upgrade swings before the restart); `release.sha` is `null` when it could not be determined.
- `POST /api/auth/setup` `{ username, password }` (only when no operator) · `POST /api/auth/login` `{ username, password, totp?, deviceName?, kind }` → `{ token, sessionId, expiresAt }` or `{ totpRequired: true }` (401 `auth_totp_required`) · `POST /api/auth/logout` · `GET /api/auth/me` → `{ operator, session, totpEnabled }`
- `GET /api/auth/sessions` · `DELETE /api/auth/sessions/:id` · `DELETE /api/auth/sessions` (all others)
- `POST /api/auth/totp/setup` → `{ secret, otpauthUrl, recoveryCodes }` · `POST /api/auth/totp/enable` `{ code }` · `POST /api/auth/totp/disable` `{ password }` · `POST /api/auth/password` `{ current, next }`
- `GET /api/workspaces` · `POST /api/workspaces` `{ path }` (register existing) · `POST /api/workspaces/init` `{ path, id, name, ticketPrefix }` · `POST /api/workspaces/import` `{ path, target }` (stage an export into `target`, register it, import its tickets as `backlog`) → `{ id, path, created, roles, knowledgeFiles, tickets, skipped }`
- `GET /api/runtimes` → `[{ id, displayName, detection, capabilities, models }]` · `GET /api/runtimes/:id/models`
- `GET /api/daemon/update[?refresh=1]` → `{ configured, running: { version, path, sha }, source, ref, targetSha, updateAvailable, checkedAt, error }` — resolves `upgrade.source` at `upgrade.ref` with `git ls-remote` (no clone) and compares it with the running release. `configured: false` when no `upgrade.source` is set: not an update and not an error. Cached for `upgrade.updateCheckIntervalSec` (default 900); `?refresh=1` resolves again. A check that fails sets `error` and leaves `updateAvailable` false.
- `GET /api/daemon/upgrade` → `{ upgrade, waitingFor: [{ workspace, running, runIds }] }` — the latest upgrade record, and (only while it is still cancellable) the work holding it. `upgrade.state` is one of `queued|waiting|building|switching|restarting|completed|failed|cancelled`; `upgrade.log` is a bounded tail (200 lines) of the build output; `upgrade.reason` is one of `wait_timeout|build_failed|backup_failed|switch_failed|restart_unverified|restart_failed|abandoned`.
- `POST /api/daemon/upgrade` `{ ref?, source?, test? }` → 202 with the record — queue a deferred upgrade: dispatch is held at once, in-flight turns finish, and only then does the daemon build, back up, switch `current` and hand the restart to a detached runner. 409 `conflict` while one is already in flight, 400 `validation` when no source is configured.
- `POST /api/daemon/upgrade/cancel` → the cancelled record — only from `queued` or `waiting` (409 `conflict` from `building` on, 404 when nothing is in flight). Resumes dispatch on every workspace that is not itself paused.
- `POST /api/daemon/drain` `{ timeoutSec? }` → `{ drained, running: [{workspace, runId}], workspaces }` (stop dispatching everywhere, wait for in-flight turns up to the timeout; used by `conductor daemon upgrade` before a restart) · `POST /api/daemon/undrain` → `{ resumed }` (start dispatching again on workspaces that are not paused)
- `POST /api/transcribe` (multipart audio) → `{ text }` or 501 when provider `none`
- `GET /llms/api.txt` (agent-readable summary) · `GET /api/openapi.json`

## Workspace
- `GET /api/w/:ws` → workspace + config summary · `PATCH /api/w/:ws/config` (partial `workspace.yaml`) · `POST /api/w/:ws/pause` · `POST /api/w/:ws/resume`
- `GET /api/w/:ws/events?after=<seq>` SSE stream (`event: <type>`, `id: <seq>`, `data: WorkspaceEvent`); heartbeat comment every 15 s
- `POST /api/w/:ws/export` `{ out? }` → `{ path, workspace, roles, knowledgeFiles, tickets }` (portable package: `workspace.yaml`, `roles/**`, `knowledge/**`, `tickets/*.md`; no db, no runs, no secrets)
- `GET /api/w/:ws/briefing`

### Projects
`GET /projects` · `POST /projects` `{ url, id?, runtime?, defaultBranch?, maxWorkers?, setupCommand? }` · `GET /projects/:id` · `PATCH /projects/:id` · `DELETE /projects/:id` · `POST /projects/:id/fetch`
`GET /projects/:id/merge-queue` → `{ projectId, concurrency, active: [MergeQueueEntry], waiting: [MergeQueueEntry] }` — the per-project merge queue (PLAN §11.4). `MergeQueueEntry` is `{ ticketId, identifier, title, projectId, position, queuedAt, startedAt, workerId }`; `position` is 1-based within `waiting` and `null` for an `active` entry. `concurrency` is the project's `mergeConcurrency` policy (default 1).

### Roles
`GET /roles?project=` · `GET /roles/:id` (spec + charter + workers + revisions + `concurrency` `{roleMax, projectMax, effective, live, projectLive, free}`) · `POST /roles` (hire; body RoleSpec) · `POST /roles/:id/activate` `{ runtime?, model? }` · `PATCH /roles/:id` `{ patch, reason }` (`patch` is a partial RoleSpec and is strict — an unknown key is a `validation` 400, never a silent no-op; clear the model override with `model: null`) · `PUT /roles/:id/charter` `{ charter, reason, applyToRunning? }` · `POST /roles/:id/rollback` `{ revision }` · `POST /roles/:id/pause|resume|retire` `{ reason }`

### Workers (agents)
`GET /workers?status=&project=&role=&includeRetired=` · `GET /workers/:id` (agent + session + ticket + last run + usage) · `GET /workers/:id/brief` · `POST /workers/:id/message` `{ body }` · `POST /workers/:id/relaunch` `{ note }` · `POST /workers/:id/cancel` `{ reason }` · `POST /workers/:id/pause|resume` · `GET /conductor` (same envelope as `GET /workers/:id`: `{ worker, ticket, lastRun, usage }` — `lastRun` is how a chat surface finds the turn to stream) · `POST /conductor/reset-session` · `PATCH /conductor` `{ runtime?, model? }`

### Tickets
`GET /tickets?project=&status=&kind=&role=&search=&limit=&offset=` · `POST /tickets` (TicketCreateInput) · `GET /tickets/:id` (id or identifier; includes blockers, children, worker, openspecState, workProducts, documents list, and `mergeQueue: { position, concurrency }` — `position` is the ticket's place among its project's waiting tickets, `null` unless it is waiting) · `PATCH /tickets/:id` `{ title?, description?, priority?, autoMerge? }` · `POST /tickets/:id/assign` `{ roleId }` · `POST /tickets/:id/transition` `{ to, note?, unblock?, blockedBy? }` · `POST /tickets/:id/retry` `{ note? }` (relaunch the parked worker or spawn one; blocked → back to work) · `POST /tickets/:id/cancel` `{ reason }` · `PUT /tickets/:id/blockers` `{ blockedBy: [] }`
`GET /tickets/:id/comments?after=` · `POST /tickets/:id/comments` `{ body }` (human; wakes worker) · `GET /tickets/:id/documents/:key?revision=` · `PUT /tickets/:id/documents/:key` `{ body }` · `GET /tickets/:id/documents/:key/revisions` · `GET /tickets/:id/work-products` · `GET /tickets/:id/runs` · `GET /tickets/:id/usage` · `POST /tickets/:id/discard` `{ force: true }` (creates discard_approval unless already approved)

### Decisions
`GET /decisions?status=&owner=` · `GET /decisions/:id` · `POST /decisions/:id/answer` `{ key?, text?, remember? }` · `POST /decisions/:id/withdraw`

### Runs
`GET /runs?agent=&ticket=&status=&limit=&offset=` · `GET /runs/:id` · `GET /runs/:id/events?after=&limit=` · `GET /runs/:id/events/stream` (SSE) · `POST /runs/:id/cancel` `{ mode }` · `GET /runs/:id/log` (raw jsonl)

### Knowledge & specs
`GET /knowledge` (lint) · `GET /knowledge/:scope?project=` · `PUT /knowledge/:scope?project=` `{ body }` (human replace) · `POST /knowledge/:scope/note?project=` `{ section, text }` · `GET /knowledge/:scope/revisions?project=` · `POST /knowledge/:scope/revert?project=` `{ revision }` · `POST /knowledge/:scope/curate?project=` · `GET /search?q=&project=` (knowledge + specs)

Linked documents: `GET /knowledge/docs?scope=&project=` → `[{ path, scope, projectId, projectSlug, slug, title, summary, tokenEstimate, budgetTokens, links, backlinks, updatedAt }]` · `GET /knowledge/docs/:scope/:slug?project=` → the document plus `body, revision, linksTo: [{slug, path, title}], linkedFrom: [{path, slug, title}]` · `PUT /knowledge/docs/:scope/:slug` `{ body }` → `{ path, revision, tokenEstimate, budgetTokens, unresolvedLinks, backlinks, orphan }` · `DELETE /knowledge/docs/:scope/:slug` (archived first) · `GET /knowledge/graph?project=` → `{ nodes: [{ id (path), kind: hub|doc, scope, projectId, projectSlug, slug, title, tokens, updatedAt }], edges: [{ from, to }] }`. Documents are `[[slug]]`-linked markdown pages under `knowledge/projects/<id>/docs/`, `knowledge/workspace/shared/` and `knowledge/workspace/docs/`, each held to `defaults.knowledgeBudgetTokens.document` (10000 by default); `GET /knowledge` (lint) rows carry `kind: hub|doc`, `title` and `projectSlug`.
`GET /specs/:project` (capabilities) · `GET /specs/:project/capabilities/:capability` · `GET /specs/:project/changes?state=` · `GET /specs/:project/changes/:name` · `GET /specs/:project/graph` · `POST /specs/:project/reindex`. Capability ids are OpenSpec paths and are often nested (`conductor-chat/dispatch-labels`); `:capability` accepts the slash either raw or percent-encoded. The capability detail is flat: `{ id, capability, title, body, requirements: [{ name, text, scenarios }], pending: [{ changeName, ticketId, ticketIdentifier, deltaKind }], history: [{ changeName, ticketId, ticketIdentifier, state, archivedAs, archivedAt }] }`.

### Usage
`GET /usage?scope=workspace|project:<id>|role:<id>|worker:<id>|ticket:<id>|model:<id>&window=&grain=&start=&end=` · `GET /usage/top?by=model|ticket|role|worker|project&...` · `GET /usage/models?...` · `GET /usage/ticket/:id`

The `/usage` series answer carries `billingMix: { subscription, metered, unknown }` — tokens in the queried scope and window per `usage_events.billing_type` — so a client can tell whether any metered spend occurred without a second request. Rows recorded before a runtime had an account snapshot count as `unknown`.

`GET /usage/accounts` → `[{ workspaceId, runtimeId, displayName, billingType (metered_api|subscription_included|unknown), planLabel, limitsAvailable, limits: [{ kind: session|weekly_all|weekly_scoped, label, utilization (0..100), resetsAt, scopeLabel }], note, capturedAt }]` — the current runtime account snapshots (PLAN §16.2), one per runtime, refreshed by the supervisor every 5 minutes. An empty array means nothing has been probed yet. `limits` is empty whenever `limitsAvailable` is false; `note` says why.

### Threads (chat)
`GET /threads?channel=web` · `POST /threads` `{ channel: 'web', label? }` · `GET /threads/:id/messages?before=&limit=` · `POST /threads/:id/messages` `{ body, projectId?, replyToMessageId? }` (inbound from human; wakes the agent. `projectId` is the project the message was sent about — an id or a slug, stored on the message and carried in the wake payload; unknown ids are rejected with `not_found`. `replyToMessageId` is the message this one answers — it must name a message of the same thread, and one that does not is rejected with `not_found`; it is stored on the message and carried in the wake payload alongside `replyToExcerpt`, a bounded excerpt of that message's body. Reads return both `replyToMessageId` and `replyToExcerpt` on every message, the excerpt resolved from the referenced row so it is available even when that message is outside the requested page) · `POST /threads/:id/bind` `{ ticketId | null }`

### Presentation / presenter
`GET /presentation` · `PUT /presentation` (PresentationBlocks) · `GET /presenter/desired` → `{ conductor, workers: AgentView[], config }` · `PUT /presenter/:presenterId/handles` `{ handles }`

### Agent endpoints (run token, loopback)
`GET /api/w/:ws/agent/inbox` · everything the MCP tools do is also available as `POST /api/w/:ws/agent/tools/:tool` `{ input }` → `ToolResult` for `conductor` CLI use.

### MCP
`POST/GET /mcp/runs/:runId` — Streamable HTTP MCP server named `agent-conductor` exposing the `ac_*` tools scoped to that run's agent (PLAN §9.2).

## Events (SSE `type`)
See `EVENT_TYPES` in `@agent-conductor/shared`. Payloads carry the entity snapshot where cheap (ticket, decision, worker, thread message) or `{ id }` otherwise.
