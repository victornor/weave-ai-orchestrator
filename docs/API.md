# OpenConductor HTTP API (v1)

Base: `/api`. Workspace-scoped routes: `/api/w/:ws/...` where `:ws` is the workspace id (slug). JSON in/out. Errors: `{ error: { code, message, details?, retryable } }` with the status from `OcError.status(code)`.

Auth: `Authorization: Bearer <token>` (CLI/presenter) or the `oc_session` httpOnly cookie (web). Loopback listener accepts run tokens (`Bearer rt_...`) for `/mcp/runs/:runId` and `/api/w/:ws/agent/*` only.

## Daemon-level
- `GET /api/health` → `{ ok, version, workspaces: [{id, name, status}], operatorConfigured, tlsMode }`
- `POST /api/auth/setup` `{ username, password }` (only when no operator) · `POST /api/auth/login` `{ username, password, totp?, deviceName?, kind }` → `{ token, sessionId, expiresAt }` or `{ totpRequired: true }` (401 `auth_totp_required`) · `POST /api/auth/logout` · `GET /api/auth/me` → `{ operator, session, totpEnabled }`
- `GET /api/auth/sessions` · `DELETE /api/auth/sessions/:id` · `DELETE /api/auth/sessions` (all others)
- `POST /api/auth/totp/setup` → `{ secret, otpauthUrl, recoveryCodes }` · `POST /api/auth/totp/enable` `{ code }` · `POST /api/auth/totp/disable` `{ password }` · `POST /api/auth/password` `{ current, next }`
- `GET /api/workspaces` · `POST /api/workspaces` `{ path }` (register existing) · `POST /api/workspaces/init` `{ path, id, name, ticketPrefix }` · `POST /api/workspaces/import` `{ path, target }` (stage an export into `target`, register it, import its tickets as `backlog`) → `{ id, path, created, roles, knowledgeFiles, tickets, skipped }`
- `GET /api/runtimes` → `[{ id, displayName, detection, capabilities, models }]` · `GET /api/runtimes/:id/models`
- `POST /api/transcribe` (multipart audio) → `{ text }` or 501 when provider `none`
- `GET /llms/api.txt` (agent-readable summary) · `GET /api/openapi.json`

## Workspace
- `GET /api/w/:ws` → workspace + config summary · `PATCH /api/w/:ws/config` (partial `workspace.yaml`) · `POST /api/w/:ws/pause` · `POST /api/w/:ws/resume`
- `GET /api/w/:ws/events?after=<seq>` SSE stream (`event: <type>`, `id: <seq>`, `data: WorkspaceEvent`); heartbeat comment every 15 s
- `POST /api/w/:ws/export` `{ out? }` → `{ path, workspace, roles, knowledgeFiles, tickets }` (portable package: `workspace.yaml`, `roles/**`, `knowledge/**`, `tickets/*.md`; no db, no runs, no secrets)
- `GET /api/w/:ws/briefing`

### Projects
`GET /projects` · `POST /projects` `{ url, id?, runtime?, defaultBranch?, maxWorkers?, setupCommand? }` · `GET /projects/:id` · `PATCH /projects/:id` · `DELETE /projects/:id` · `POST /projects/:id/fetch`

### Roles
`GET /roles?project=` · `GET /roles/:id` (spec + charter + workers + revisions) · `POST /roles` (hire; body RoleSpec) · `POST /roles/:id/activate` `{ runtime?, model? }` · `PATCH /roles/:id` `{ patch, reason }` · `PUT /roles/:id/charter` `{ charter, reason, applyToRunning? }` · `POST /roles/:id/rollback` `{ revision }` · `POST /roles/:id/pause|resume|retire` `{ reason }`

### Workers (agents)
`GET /workers?status=&project=&role=&includeRetired=` · `GET /workers/:id` (agent + session + ticket + last run + usage) · `GET /workers/:id/brief` · `POST /workers/:id/message` `{ body }` · `POST /workers/:id/relaunch` `{ note }` · `POST /workers/:id/cancel` `{ reason }` · `POST /workers/:id/pause|resume` · `GET /conductor` · `POST /conductor/reset-session` · `PATCH /conductor` `{ runtime?, model? }`

### Tickets
`GET /tickets?project=&status=&kind=&role=&search=&limit=&offset=` · `POST /tickets` (TicketCreateInput) · `GET /tickets/:id` (id or identifier; includes blockers, children, worker, openspecState, workProducts, documents list) · `PATCH /tickets/:id` `{ title?, description?, priority?, autoMerge? }` · `POST /tickets/:id/assign` `{ roleId }` · `POST /tickets/:id/transition` `{ to, note?, unblock?, blockedBy? }` · `POST /tickets/:id/cancel` `{ reason }` · `PUT /tickets/:id/blockers` `{ blockedBy: [] }`
`GET /tickets/:id/comments?after=` · `POST /tickets/:id/comments` `{ body }` (human; wakes worker) · `GET /tickets/:id/documents/:key?revision=` · `PUT /tickets/:id/documents/:key` `{ body }` · `GET /tickets/:id/documents/:key/revisions` · `GET /tickets/:id/work-products` · `GET /tickets/:id/runs` · `GET /tickets/:id/usage` · `POST /tickets/:id/discard` `{ force: true }` (creates discard_approval unless already approved)

### Decisions
`GET /decisions?status=&owner=` · `GET /decisions/:id` · `POST /decisions/:id/answer` `{ key?, text?, remember? }` · `POST /decisions/:id/withdraw`

### Runs
`GET /runs?agent=&ticket=&status=&limit=&offset=` · `GET /runs/:id` · `GET /runs/:id/events?after=&limit=` · `GET /runs/:id/events/stream` (SSE) · `POST /runs/:id/cancel` `{ mode }` · `GET /runs/:id/log` (raw jsonl)

### Knowledge & specs
`GET /knowledge` (lint) · `GET /knowledge/:scope?project=` · `PUT /knowledge/:scope?project=` `{ body }` (human replace) · `POST /knowledge/:scope/note?project=` `{ section, text }` · `GET /knowledge/:scope/revisions?project=` · `POST /knowledge/:scope/revert?project=` `{ revision }` · `POST /knowledge/:scope/curate?project=` · `GET /search?q=&project=` (knowledge + specs)
`GET /specs/:project` (capabilities) · `GET /specs/:project/capabilities/:capability` · `GET /specs/:project/changes?state=` · `GET /specs/:project/changes/:name` · `GET /specs/:project/graph` · `POST /specs/:project/reindex`

### Usage
`GET /usage?scope=workspace|project:<id>|role:<id>|worker:<id>|ticket:<id>|model:<id>&window=&grain=&start=&end=` · `GET /usage/top?by=model|ticket|role|worker|project&...` · `GET /usage/models?...` · `GET /usage/ticket/:id`

### Threads (chat)
`GET /threads?channel=web` · `POST /threads` `{ channel: 'web', label? }` · `GET /threads/:id/messages?before=&limit=` · `POST /threads/:id/messages` `{ body }` (inbound from human; wakes the agent) · `POST /threads/:id/bind` `{ ticketId | null }`

### Presentation / presenter
`GET /presentation` · `PUT /presentation` (PresentationBlocks) · `GET /presenter/desired` → `{ conductor, workers: AgentView[], config }` · `PUT /presenter/:presenterId/handles` `{ handles }`

### Agent endpoints (run token, loopback)
`GET /api/w/:ws/agent/inbox` · everything the MCP tools do is also available as `POST /api/w/:ws/agent/tools/:tool` `{ input }` → `ToolResult` for `oc` CLI use.

### MCP
`POST/GET /mcp/runs/:runId` — Streamable HTTP MCP server named `openconductor` exposing the `oc_*` tools scoped to that run's agent (PLAN §9.2).

## Events (SSE `type`)
See `EVENT_TYPES` in `@openconductor/shared`. Payloads carry the entity snapshot where cheap (ticket, decision, worker, thread message) or `{ id }` otherwise.
