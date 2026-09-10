## Why

When a conductor or worker hits a system failure (an MCP call that errors, something they cannot do because AgentConductor itself is broken), that fact today lives only in a transcript or a chat aside — or nowhere. Captain asked for a durable system report they can file themselves, and a global Incidents page so those failures are collected instead of disappearing. VS-171 (Claude auto-classifier blocking `ac_*`) is the kind of issue this should catch.

## What Changes

- **`ac_incident` MCP tool** on every agent (conductor and worker). The agent files what failed, what they were trying to do, and evidence. The daemon records reporter kind from the run (`conductor` or `worker`); the agent does not self-classify. Filing does not create a ticket, a decision, or a chat message.
- **Persistent incident records** in `daemon.sqlite` (daemon-wide, like upgrades — not per-workspace). Each row keeps the run's workspace, agent, run, ticket and project as context.
- **Global Incidents page** at `/incidents`, reachable without picking a workspace, listing persisted incidents newest first, with a filter or grouping that separates conductor incidents from worker incidents.
- **Sidebar global section** gains an Incidents link next to Needs you / Live / Chats (order: Needs you, Live, Chats, Incidents). Phone: Global Incidents in the More menu, above per-workspace leftovers; five tabs stay five.
- **Per-workspace pages stay.** This does not replace tickets or Needs you. No per-workspace Incidents page.
- Agents are told, in the tool description and the conductor/worker prompts, to file an incident when a system call fails or they cannot do something because of AgentConductor — not to wait for the human to notice in chat.

## Capabilities

### New Capabilities

- `incidents/filing`: the `ac_incident` tool, the persisted record, and the rule that a file is a system report not a ticket.
- `incidents/global-page`: the `/incidents` page — list, conductor vs worker separation, empty/loading, context on each row, not a workspace page.

### Modified Capabilities

- `workspace-navigation/sidebar-workspaces`: Incidents joins the global section and the phone More menu's global destinations. Existing scenario names are kept.

## Impact

- `packages/shared` — `ac_incident` on `COMMON_TOOLS`; incident types and reporter-kind enum.
- `packages/db` — migration creating `incidents` (used in `daemon.sqlite`).
- `packages/core` — `IncidentsService` (create, list, get).
- `packages/server` — tool handler; `GET /api/incidents`; wire the service onto `AppDeps` / `ToolCtx`; `docs/API.md` and PLAN §9.2 / §21.1.
- `packages/ui` — `/incidents` route, global nav item, More menu item, page with conductor/worker filter.
- `templates/` and `skills/` — when to file; tool listed in worker/conductor tool references.
- Tests for the tool, the HTTP list, the page, and the nav. Existing lint, typecheck and vitest stay green.

## Out of scope

- Auto-creating a fix ticket from every incident.
- Acknowledge / resolve / close workflow (append-only in this change).
- An MCP list/get tool for agents (the human reads the page).
- Telegram / TUI.
- A sixth phone tab, or a per-workspace Incidents page.
