## Context

See `proposal.md`. Constraints that shape the approach:

- Every UI route today lives under `/w/$ws` (`packages/ui/src/router.tsx`). `WorkspaceLayout` wraps `WorkspaceProvider`, which both opens that workspace's `EventStream` and writes `conductor.ws` via `setWorkspaceId`. There is no chrome that can render without a workspace in the URL.
- `api.ws(workspace, path)` and every `qk.*(ws, …)` already take an explicit workspace id (VS-128). `useWorkers` / `useTickets` / `useThreads` / `useDecisions` / `useAnswerDecision` / `useRunEventStream` still bind `useWs()`. Fan-out needs an explicit-id path, not a new daemon API.
- `ChatRoute` already remounts on workspace via `<ChatPage key={ws} />`. Chat still reads `useWs()`, `useConnection()`, `useWorkspaceEvents()`.
- Nested `WorkspaceProvider`s would clobber `conductor.ws` because every provider calls `setWorkspaceId`.
- jsdom has no layout. Route tests mock `../api/hooks` wholesale. New radio/radiogroup controls in shared chat UI break bare `queryByRole('radio')` in `chat.test.tsx` (VS-126).
- Phone: five tabs are a hard spec. Global destinations go in More, like per-workspace Live did (VS-152). Per-workspace Needs you is already a tab; global Needs you is not a sixth tab.
- `DecisionCard` already takes `ws` as a prop. `useAnswerDecision` posts to `useWs()` today — a global inbox must pass the card's workspace.

## Goals / Non-Goals

**Goals:**

- `/needs`, `/live` and `/chats` as root siblings of `/w/$ws`, with the existing sidebar chrome.
- Reuse the Needs you inbox, the Live grid and the Chat page rather than second implementations.
- Fan-out existing per-workspace HTTP + SSE; no new daemon route.
- A chat pane must not rewrite the remembered workspace.

**Non-Goals:**

- A daemon-level `/workers` or multiplexed `/events` API.
- Replacing per-workspace Needs you, Live or Chat.
- Telegram, TUI, PLAN behaviour outside §21.1's rail IA note.

## Decisions

### D1. Routes are `/needs`, `/live` and `/chats`, outside `/w/$ws`

The acceptance criterion is "reachable without picking a workspace first". Putting them under a remembered `/w/$ws/…` would still require a workspace in the URL and would mark that group active.

A new `DaemonLayout` (or `AppShell` with `ws: string | null`) renders the rail, More, palette and outlet without a `WorkspaceProvider`. `/w/$ws/*` keeps `WorkspaceLayout` as it is.

`/` still redirects to the remembered workspace's Needs you (or onboarding). Global pages are destinations, not the new home.

**Rejected:** `/w/$ws/global-live` (fails "without picking a workspace"). **Rejected:** a query flag on the per-workspace pages (two metaphors on one route).

### D2. AppShell runs with no active workspace

When `ws` is null (global routes):

- `useWorkspaces()` still fills the rail.
- No workspace group is `active`; every group is collapsible; expansion memory is unchanged.
- `getWorkspaceId()` is the remembered workspace for section shortcuts, tab hrefs, and the palette's per-workspace commands. Visiting `/needs`, `/live` or `/chats` does not call `setWorkspaceId`.
- YOLO banner and workspace summary are omitted.
- Bottom-bar tab hrefs address the remembered workspace if one exists; More is the active tab on a global page.
- Connection chrome: a fan-in of `EventStream` per listed workspace while a global page is mounted (same `invalidateFor` / `qk.*(ws, …)` already used). Unmounting the global page stops the extra streams. The per-workspace layout keeps its single stream.

**Rejected:** keeping a hidden `WorkspaceProvider` for the remembered workspace on global pages (it would mark that group active unless the nav learned a third state, and `setWorkspaceId` would fire on mount). **Rejected:** one new daemon SSE (out of scope; N workspaces is small).

### D3. `WorkspaceProvider` gains `remember?: boolean` (default true)

```ts
WorkspaceProvider({ ws, remember = true, children })
```

`remember === false` still opens that workspace's `EventStream` and provides context; it does not write `conductor.ws`. Global chat panes wrap the existing `ChatPage` in `<WorkspaceProvider ws={id} remember={false}>`. Per-workspace Chat stays `<ChatPage key={ws} />` under the route provider.

**Rejected:** threading `ws` through every hook Chat calls (a thousand-line rewrite for no extra behaviour). **Rejected:** nested providers that keep calling `setWorkspaceId` (last pane wins, next launch opens the wrong workspace).

### D4. Global Live reuses the Live grid with an explicit workspace id

Extract the cell + grid from `Live.tsx` so both pages share membership (`liveWorkingAgents`), streaming (`useRunEventStream`), resize (`liveCellSize`) and phone expand.

Global Live:

1. `useWorkspaces()`
2. For each workspace id, `useWorkers` / `useTickets` / `useRuns` against that id (hooks take optional `ws` overriding `useWs()`)
3. Flatten `liveWorkingAgents` with `{ workspaceId, workspaceName, worker }`
4. Ticket links go to `/w/$ws/tickets/$ticketId` of that worker's workspace (that navigation *does* switch context — opening a ticket is leaving the global page)

`useRunEventStream` takes optional `ws` so a cell on the global page does not need a provider.

Cell sizes: session key `conductor.live.cellSizes.global`, keyed by worker id (ULIDs are already unique across workspaces). Per-workspace Live keeps `conductor.live.cellSizes.<wsId>`.

Partial failure is per workspace: one query error does not unmount the others.

**Rejected:** wrapping each cell in `WorkspaceProvider` (N streams × M cells). **Rejected:** polling instead of EventStream fan-in (the per-workspace page is live; this one must be too).

### D5. Global Chats is N chat panes, horizontal

Each pane: header (workspace name) + `<WorkspaceProvider ws={id} remember={false}><ChatPage /></WorkspaceProvider>`. `ChatPage` already keys itself; drafts stay `draftKey(ws, conversation)`; reading position stays per workspace.

Layout: a horizontal flex row, `min-w` per pane so they sit side by side and overflow-x scrolls. Phone uses the same row (snap-scroll), not a vertical stack — the ticket asked for horizontal.

Do not add radio/radiogroup controls in the pane chrome. Existing `queryByRole('radio')` in `chat.test.tsx` must stay scoped.

**Rejected:** iframes / separate windows. **Rejected:** one composer that targets a selected workspace (not side-by-side). **Rejected:** stacking on phone (different metaphor than the ticket).

### D6. Global Needs you is one inbox, grouped by workspace

`/needs` is a single scrolling list, not side-by-side panes. Group cards under a workspace heading so identity is obvious; flatten within a group in the same order per-workspace Needs you already uses (open human-owned first).

For each listed workspace: `useDecisions({ status: 'open', owner: 'human' }, ws)` and the conductor-owned list, with optional `ws` on `useDecisions` / `useAnswerDecision` / `useTickets` / `useProjects` / `useWorkspaceSummary`. `DecisionCard` already takes `ws`. `onAnswer` posts to that card's workspace. Hidden-from-chat stays per-workspace (`useHiddenDecisions(ws)`); a hidden decision still appears here.

Partial failure is per workspace, same as global Live. YOLO `autoApproving` reads that workspace's config.

The phone's Needs you tab stays the active workspace. Global Needs you is a More item, with Live and Chats.

**Rejected:** side-by-side Needs panes (the ticket asked to aggregate; chats are the horizontal metaphor). **Rejected:** a daemon-level `/decisions` (out of scope).

### D7. PLAN §21.1 gets a rail note; no API.md

These are UI routes, not HTTP routes. PLAN §21.1's information architecture currently starts at Chat as item 1 of the left rail. Add a line that a global Needs you, Live and Chats trio sits above the workspace list; the per-workspace rail is unchanged. No `docs/API.md` edit.

## Risks / Trade-offs

- [N EventSources while a global page is open] → accepted; typical daemon has a handful of workspaces. Stop them on unmount. Do not open them on per-workspace pages.
- [ChatPage is heavy to mount N times] → accepted for v1; each pane is the real chat, which is the point. If it hurts, later extract a slimmer pane — out of this ticket.
- [Opening a ticket from a global Live cell switches workspace] → correct; the human left the global page.
- [jsdom cannot prove horizontal layout] → tests assert pane count, labels, hrefs, that send is called with the pane's workspace id, and overflow-x class; visual packing is CSS.
- [Route-test mock of `../api/hooks` breaks when hooks gain a `ws` argument] → add the export in every wholesale mock, then re-run the ui suite.

## Migration Plan

None. No stored data, no API, no flag. Rollback is revert. Existing `conductor.ws` and per-workspace live cell sizes are untouched.

## Open Questions

None. Routes, remember-flag, fan-out, and phone-More are judgements inside the accepted contract.
