# `weave_*` tools — input shapes

Every call returns `{ ok: true, data: … }` or `{ ok: false, error: { code, message, retryable } }`.
Unknown ids return `not_found`, never an exception. `409` = someone else owns the object: **never retry it**.
The `weave` CLI mirrors every tool (`weave ticket get`, `weave ask`, `weave report`, …) with `--json`, for runtimes with weak MCP support.

## Available to every agent

| Tool | Input | Returns |
|---|---|---|
| `weave_inbox` | — | the wakes bundled into this run: messages, ticket events, answered decisions, mentions, weaver steering |
| `weave_ticket_get` | `id` | the ticket, including `status`, `kind`, `acceptance`, `openspecChangeName`, `documents`, `blockedBy` |
| `weave_ticket_list` | `filter: {status?, kind?, assigneeRoleId?, projectId?, limit?, includeDescription?}` | lean tickets (id, identifier, status, kind, title, … — no `description`). Pass `includeDescription: true` or call `weave_ticket_get` for the body |
| `weave_ticket_comments` | `id`, `after?` (cursor) | comments since the cursor, with `authorKind` and `sourceTrust` |
| `weave_ticket_checkout` | `id` | ownership of the ticket for this run; `409` if held elsewhere |
| `weave_ticket_release` | `id`, `note` | releases ownership |
| `weave_ticket_comment` | `id`, `body` (markdown), `kind` = `comment` \| `status` \| `report` \| `relay` | the stored comment |
| `weave_ticket_document_put` | `id`, `key` (`report` \| …), `body` | a new revision of that document; `plan` is reserved for the daemon's own generated plan digest and refuses any other writer |
| `weave_ticket_document_get` | `id`, `key` (default `report`), `revision?` | the document's body and revision — a scout's report, or the daemon's `plan` digest, on any ticket in your project; `not_found` lists the keys that do exist |
| `weave_ticket_transition` | `id`, `to`, `{note?, unblock?: {owner, action}, blockedBy?: [ids]}` | the new status, or the guard's rejection reasons |
| `weave_ticket_work_product` | `id`, `{type, url, title, state}` — type is `pull_request` \| `branch` \| `commit` \| `artifact` \| `preview_url` \| `report` | the recorded work product |
| `weave_ask` | `ticketId?`, `{title, context, kind: 'question' \| 'concern' \| 'gate_finding', options: [{key, label, detail}], recommendation, allowFreeText, correlationKey}` | the created decision, owned by the weaver whichever `kind` you name; **end the turn after asking** |
| `weave_report` | `{state, key?, note}` — state is `working` \| `needs_decision` \| `blocked` \| `paused` \| `done` \| `failed` | a `status` comment and updated liveness |
| `weave_incident` | `{title, whatFailed, tryingToDo, evidence?}` | a system incident (`id`, `createdAt`, `reporterKind`). File when Weave AI itself fails; not a ticket. Never put secrets in evidence |
| `weave_knowledge_get` | `scope`: `shared` \| `project` \| `workspace` (weaver) \| `decisions` (weaver); weaver may pass a project id | the file's current body |
| `weave_knowledge_note` | `scope`, `section`, `text` (≤ 60 words), `doc?` (slug) | remaining budget, or a rejection: duplicate, too long, over budget, or `not_found` if `doc` names a document that does not exist yet; `doc` appends into that linked document's section instead of the hub |
| `weave_knowledge_replace` | `scope`, `body` | the new revision — **only inside a curation run** |
| `weave_openspec_status` | `ticketId` | the daemon's cached view of the bound change: planning complete, tasks, validation |
| `weave_spec_list` | `projectId` | the project's capabilities with requirement counts |
| `weave_spec_get` | `projectId`, `capability` | the spec with its requirements and scenarios |
| `weave_spec_search` | `projectId?`, `query` | matches across specs, change artifacts and knowledge |
| `weave_spec_change_get` | `changeName` | proposal, design, tasks and delta specs for a change |
| `weave_ticket_merge_done` | `id`, `{mergeCommit, method}` | accepted only after the daemon verifies the merge; rejected outside `merging` |
| `weave_worktree_status` | — | `{path, branch, dirty, ahead, behind, landed}` — the authority, never guess |

Workers may also call `weave_ticket_create` for **child tickets inside their own project**, with the same input shape as the weaver's. Use it only when the brief tells you to, or for a genuine follow-up that must not block this ticket — and say so on your ticket.

## Weaver only

| Tool | Input |
|---|---|
| `weave_ticket_create` | `{projectId?, kind, title, description, summary?, priority, parentId?, blockedBy?, assigneeRoleId?, autoMerge?}` — `autoMerge` only when the human asked for it in the same request; `summary` is a one-line why (VS-146) |
| `weave_ticket_assign` | `id`, `roleId` |
| `weave_ticket_set_priority` | `id`, `priority` |
| `weave_role_list` | — |
| `weave_role_get` | `id` |
| `weave_role_hire` | the role spec (see `weave-ai-hire/references/spec-schema.md`) |
| `weave_role_update_charter` | `id`, `{charter, reason, applyToRunning?}` |
| `weave_role_pause` / `weave_role_resume` / `weave_role_retire` | `id`, `reason` |
| `weave_worker_list` | `filter` |
| `weave_worker_get` | `id` |
| `weave_worker_message` | `workerId`, `message` — a comment on its ticket plus a wake |
| `weave_worker_relaunch` | `id`, `note` |
| `weave_worker_cancel` | `id`, `reason` — leaves the worktree; discarding unlanded work is a human decision |
| `weave_decision_answer` | `id`, `{key?, text}` — only for decisions the weaver owns |
| `weave_decision_review` | `decisionId`, `{status: 'looked'\|'concerns', note}` — mark that you have reviewed a plan, merge or action approval; the note (concern, or why it is clean) appears on the card. Workers cannot call this |
| `weave_human_send` | `threadId?`, `body` — the only way the weaver's words reach the human |
| `weave_briefing` | — |
| `weave_project_list` | — |
| `weave_project_add` | `url`, `opts` — requires a human decision |
| `weave_usage` | `filter` |

## Environment

Each run is given `AC_API_URL`, `AC_RUN_TOKEN`, `AC_RUN_ID`, `AC_AGENT_ID`, `AC_ROLE_ID`, `AC_WORKSPACE_ID`, `AC_PROJECT_ID`, `AC_TICKET_ID` (workers), `AC_WORKTREE` (workers), `AC_WAKE_REASON`, `AC_AGENT_KIND`. The token is scoped: a worker's token returns `403` for other projects' tickets, knowledge bases and worktrees, and for `WORKSPACE.md`. A `403` is not a bug to work around; it is the boundary.
