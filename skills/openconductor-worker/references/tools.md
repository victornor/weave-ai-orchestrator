# `oc_*` tools — input shapes

Every call returns `{ ok: true, data: … }` or `{ ok: false, error: { code, message, retryable } }`.
Unknown ids return `not_found`, never an exception. `409` = someone else owns the object: **never retry it**.
The `oc` CLI mirrors every tool (`oc ticket get`, `oc ask`, `oc report`, …) with `--json`, for runtimes with weak MCP support.

## Available to every agent

| Tool | Input | Returns |
|---|---|---|
| `oc_inbox` | — | the wakes bundled into this run: messages, ticket events, answered decisions, mentions, conductor steering |
| `oc_ticket_get` | `id` | the ticket, including `status`, `kind`, `acceptance`, `openspecChangeName`, `documents`, `blockedBy` |
| `oc_ticket_list` | `filter: {status?, kind?, assigneeRoleId?, projectId?, limit?}` | tickets you are allowed to see |
| `oc_ticket_comments` | `id`, `after?` (cursor) | comments since the cursor, with `authorKind` and `sourceTrust` |
| `oc_ticket_checkout` | `id` | ownership of the ticket for this run; `409` if held elsewhere |
| `oc_ticket_release` | `id`, `note` | releases ownership |
| `oc_ticket_comment` | `id`, `body` (markdown), `kind` = `comment` \| `status` \| `report` \| `relay` | the stored comment |
| `oc_ticket_document_put` | `id`, `key` (`plan` \| `report` \| …), `body` | a new revision of that document |
| `oc_ticket_transition` | `id`, `to`, `{note?, unblock?: {owner, action}, blockedBy?: [ids]}` | the new status, or the guard's rejection reasons |
| `oc_ticket_work_product` | `id`, `{type, url, title, state}` — type is `pull_request` \| `branch` \| `commit` \| `artifact` \| `preview_url` \| `report` | the recorded work product |
| `oc_ask` | `ticketId?`, `{title, context, options: [{key, label, detail}], recommendation, allowFreeText, correlationKey}` | the created decision; **end the turn after asking** |
| `oc_report` | `{state, key?, note}` — state is `working` \| `needs_decision` \| `blocked` \| `paused` \| `done` \| `failed` | a `status` comment and updated liveness |
| `oc_knowledge_get` | `scope`: `shared` \| `project` \| `workspace` (conductor) \| `decisions` (conductor); conductor may pass a project id | the file's current body |
| `oc_knowledge_note` | `scope`, `section`, `text` (≤ 60 words) | remaining budget, or a rejection: duplicate, too long, over budget |
| `oc_knowledge_replace` | `scope`, `body` | the new revision — **only inside a curation run** |
| `oc_openspec_status` | `ticketId` | the daemon's cached view of the bound change: planning complete, tasks, validation |
| `oc_spec_list` | `projectId` | the project's capabilities with requirement counts |
| `oc_spec_get` | `projectId`, `capability` | the spec with its requirements and scenarios |
| `oc_spec_search` | `projectId?`, `query` | matches across specs, change artifacts and knowledge |
| `oc_spec_change_get` | `changeName` | proposal, design, tasks and delta specs for a change |
| `oc_ticket_merge_done` | `id`, `{mergeCommit, method}` | accepted only after the daemon verifies the merge; rejected outside `merging` |
| `oc_worktree_status` | — | `{path, branch, dirty, ahead, behind, landed}` — the authority, never guess |

Workers may also call `oc_ticket_create` for **child tickets inside their own project**, with the same input shape as the conductor's. Use it only when the brief tells you to, or for a genuine follow-up that must not block this ticket — and say so on your ticket.

## Conductor only

| Tool | Input |
|---|---|
| `oc_ticket_create` | `{projectId?, kind, title, description, priority, parentId?, blockedBy?, assigneeRoleId?, autoMerge?}` — `autoMerge` only when the human asked for it in the same request |
| `oc_ticket_assign` | `id`, `roleId` |
| `oc_ticket_set_priority` | `id`, `priority` |
| `oc_role_list` | — |
| `oc_role_get` | `id` |
| `oc_role_hire` | the role spec (see `openconductor-hire/references/spec-schema.md`) |
| `oc_role_update_charter` | `id`, `{charter, reason, applyToRunning?}` |
| `oc_role_pause` / `oc_role_resume` / `oc_role_retire` | `id`, `reason` |
| `oc_worker_list` | `filter` |
| `oc_worker_get` | `id` |
| `oc_worker_message` | `workerId`, `message` — a comment on its ticket plus a wake |
| `oc_worker_relaunch` | `id`, `note` |
| `oc_worker_cancel` | `id`, `reason` — leaves the worktree; discarding unlanded work is a human decision |
| `oc_decision_answer` | `id`, `{key?, text}` — only for decisions the conductor owns |
| `oc_human_send` | `threadId?`, `body` — the only way the conductor's words reach the human |
| `oc_briefing` | — |
| `oc_project_list` | — |
| `oc_project_add` | `url`, `opts` — requires a human decision |
| `oc_usage` | `filter` |

## Environment

Each run is given `OC_API_URL`, `OC_RUN_TOKEN`, `OC_RUN_ID`, `OC_AGENT_ID`, `OC_ROLE_ID`, `OC_WORKSPACE_ID`, `OC_PROJECT_ID`, `OC_TICKET_ID` (workers), `OC_WORKTREE` (workers), `OC_WAKE_REASON`, `OC_AGENT_KIND`. The token is scoped: a worker's token returns `403` for other projects' tickets, knowledge bases and worktrees, and for `WORKSPACE.md`. A `403` is not a bug to work around; it is the boundary.
