## Why

Captain works across several workspaces on one daemon. Live, Chat and Needs you are per-workspace (`/w/:ws/live`, `/w/:ws/chat`, `/w/:ws/needs`); jumping between them is how they watch and drive everything, and that jump recently 404'd (VS-166) and went silent (VS-167). They asked for a global Live of every working agent, a Chats page of every workspace's conductor thread side by side, and a Needs you that aggregates pending decisions from every workspace — all reachable from the sidebar above the workspace list, without replacing the per-workspace pages.

## What Changes

- **A global section at the top of the desktop sidebar**, above the Workspaces heading, with Needs you, Live and Chats (same nouns as the per-workspace rail). Those links do not require expanding a workspace group or picking a workspace first.
- **Global Needs you** at `/needs`: every open decision awaiting the human across every hosted workspace, as the same cards with the same actions as the per-workspace Needs you page (`human-decisions/option-cards`). Each card names its workspace. Answering a card records the answer in that workspace. Empty workspaces contribute no cards and do not break the page.
- **Global Live** at `/live`: the same live-grid metaphor as the per-workspace Live page (`workspace-navigation/live-floor`) — one cell per live worker on a ticket, streaming that worker's output — across every workspace this daemon hosts. Each cell also names its workspace. Empty workspaces contribute no cells and do not break the page. The conductor is still not a cell.
- **Global Chats** at `/chats`: one conductor-chat pane per workspace, laid out horizontally side by side. Sending in a pane posts to that workspace's primary web conductor thread and the reply streams in that pane. Per-workspace drafts and reading positions stay as they are.
- **Per-workspace Needs you, Live and Chat stay.** `/w/:ws/needs`, `/w/:ws/live` and `/w/:ws/chat` are unchanged. Opening a global page does not make a workspace active and does not rewrite the remembered workspace for the next launch.
- **Phone: five tabs stay.** Global Needs you, Live and Chats are in the More menu, above the per-workspace leftovers, so they are reachable without growing the bar. The phone's Needs you tab remains the active workspace's.
- **No new daemon API.** Each page fans out the existing per-workspace decisions / workers / tickets / runs / threads / messages / run-event streams, keyed by workspace id the way VS-128 already fetches another workspace's projects.

## Capabilities

### New Capabilities

- `human-decisions/global-needs`: the `/needs` page — open human-owned decisions from every hosted workspace, same cards and actions as per-workspace Needs you, workspace identity on each card, empty/loading/partial-failure.
- `workspace-navigation/global-live`: the `/live` page — membership across every hosted workspace, workspace identity on each cell, empty/loading/partial-failure, reuse of the per-workspace live grid (resize, phone expand, streaming, not a control surface).
- `conductor-chat/global-chats`: the `/chats` page — one conductor pane per workspace, horizontal layout, send and live turn scoped to that pane's workspace, empty/loading/partial-failure.

### Modified Capabilities

- `workspace-navigation/sidebar-workspaces`: a global Needs you / Live / Chats section sits above the workspace list; on a global page no workspace group is marked active and the matching global link is; the phone's More menu lists those three without growing the five tabs. Existing scenario names are kept.

## Impact

- `packages/ui/src/router.tsx` — `/needs`, `/live` and `/chats` as siblings of `/w/$ws`, sharing chrome that does not require a workspace in the URL.
- `packages/ui/src/app/WorkspaceNav.tsx`, `nav.ts`, `AppShell.tsx`, `MoreSheet.tsx` — global section; More items; AppShell runs with no active workspace.
- `packages/ui/src/api/context.tsx` — `WorkspaceProvider` can skip `setWorkspaceId` so a chat pane does not clobber the remembered workspace.
- `packages/ui/src/routes/NeedsYou.tsx`, `Live.tsx` and `Chat.tsx` — reuse the inbox, the grid and the chat page; hooks that today bind `useWs()` take an explicit workspace id where a card/pane/cell is not inside the route's provider. `useAnswerDecision` posts to the card's workspace.
- `packages/ui/src/test/` — new coverage for the global routes and sidebar section; existing needsyou, live-floor, chat, workspacenav and moreSheet tests stay green.
- `docs/PLAN.md` §21.1 — global Needs you, Live and Chats in the rail IA.
- No daemon, schema, event, CLI, TUI or Telegram change.

## Out of scope

- Telegram / TUI.
- Changing a workspace's conductor runtime or model.
- Replacing per-workspace Needs you, Live or Chat.
- A new daemon-level SSE or workers-across-workspaces API.
