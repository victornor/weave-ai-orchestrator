## 1. Shared types, schema and service

- [x] 1.1 Add `INCIDENT_REPORTER_KINDS` (`conductor` | `worker`) and the `Incident` type to `packages/shared`. Add `ac_incident` to `COMMON_TOOLS`. Verify shared tests (or a new one) include the enum values and that `COMMON_TOOLS` contains `ac_incident`.
- [x] 1.2 Add migration `0022_incidents.sql` creating `incidents` (id, reporter_kind, title, what_failed, trying_to_do, evidence, workspace_id, project_id, ticket_id, agent_id, run_id, role_id, created_at) with newest-first and reporter-kind indexes, no foreign keys. Verify `packages/db` migration tests create the table and insert a row.
- [x] 1.3 Implement `IncidentsService` in `packages/core` against the daemon db: `create` (derives reporterKind; stores run context; two identical files → two rows) and `list`/`get` (newest first, optional reporterKind filter). Verify unit tests cover worker vs conductor derivation, validation of empty title/whatFailed/tryingToDo, two-file-two-rows, and filtered list.

## 2. MCP tool and HTTP list

- [x] 2.1 Put `IncidentsService` on `AppDeps` and `ToolCtx`; construct it from `daemon.sqlite` at daemon boot. Wire `mcpRoutes` and the agent-tools HTTP POST so both pass the service. Verify a tool handler can write without going through workspace `CoreServices`.
- [x] 2.2 Register `ac_incident` (`scope: 'all'`) with the input/output in design.md D2. Description MUST tell the agent to file when a system call fails or they cannot proceed because of AgentConductor, and not to put secrets in evidence. Verify a worker tool-call test and a conductor tool-call test each persist a row with the matching `reporterKind`, and that an empty title returns `validation` with no row.
- [x] 2.3 Add session-authenticated `GET /api/incidents` (`reporter`, `limit`) and `GET /api/incidents/:id` as daemon-level routes. Verify a session client lists Alpha-worker and Beta-conductor files together newest first; a run token is rejected; `reporter=conductor` hides worker rows. Document in `docs/API.md`.
- [x] 2.4 Filing MUST NOT create a ticket, a decision, or a conductor-thread message. Verify the tool test asserts ticket/decision/thread counts are unchanged.

## 3. Global Incidents page and nav

- [x] 3.1 Register `/incidents` as a root sibling of `/w/$ws` in `packages/ui/src/router.tsx`, sharing chrome that renders without a `WorkspaceProvider`. Verify the router test can navigate to `/incidents` without a `$ws` param.
- [x] 3.2 Append Incidents to `GLOBAL_NAV` (after Chats, glyph `failed`) and to the phone More menu's global destinations. Teach `AppShell.onGlobalPage` to include `/incidents`; visiting it MUST NOT call `setWorkspaceId`. Verify `workspacenav.test.tsx` lists Needs you, Live, Chats, Incidents above the workspace list, marks Incidents current on `/incidents`, and leaves the remembered workspace unchanged. Verify `moreSheet.test.tsx` lists Global Incidents and still asserts five tabs.
- [x] 3.3 Build the `/incidents` page: fetch `GET /api/incidents`, filter All / Conductor / Worker via `?reporter=`, newest-first rows showing title, reporter kind, createdAt, workspace when known; expand for whatFailed, tryingToDo, evidence. Empty, loading, and error+retry as specified. Verify `globalIncidents.test.tsx` covers both kinds labelled, conductor-only and worker-only filters, empty wording, filter-matching-nothing wording, load error vs empty, and that a filed worker incident's title appears.

## 4. Prompts, PLAN, and checks

- [x] 4.1 Add `ac_incident` to PLAN §9.2 Common tools and one sentence to §21.1's global-section IA (Needs you, Live, Chats, Incidents). Add one line to conductor and worker AGENTS templates: file `ac_incident` on a system failure; it is not a ticket. List the tool in the worker and conductor skill tool references. Verify those files name `ac_incident`.
- [x] 4.2 `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm --filter @agent-conductor/ui exec vitest run` are green.
