## 1. Chrome that does not need a workspace in the URL

- [x] 1.1 Register `/needs`, `/live` and `/chats` as root siblings of `/w/$ws` in `packages/ui/src/router.tsx`, sharing chrome that renders without a `WorkspaceProvider`. Verify the router test (or a new one) can navigate to all three paths without a `$ws` param.
- [x] 1.2 Teach `AppShell` / `WorkspaceNav` to run with no active workspace: global Needs you, Live and Chats links (in that order) above the Workspaces heading; no group marked active on those pages; visiting them does not call `setWorkspaceId`. Verify `workspacenav.test.tsx` covers the global section above the list, current-page marking, and that a remembered workspace is unchanged.
- [x] 1.3 Add Global Needs you, Global Live and Global Chats to the phone More menu above the per-workspace leftovers, without growing the five tabs. Verify `moreSheet.test.tsx` (or equivalent) lists them and still asserts five tabs.

## 2. Provider and hooks for explicit workspace ids

- [x] 2.1 Add `remember?: boolean` (default true) to `WorkspaceProvider` so a pane can open that workspace's `EventStream` without writing `conductor.ws`. Verify a unit/route test that mounting `remember={false}` leaves `getWorkspaceId()` untouched.
- [x] 2.2 Let `useWorkers`, `useTickets`, `useRuns`, `useDecisions`, `useAnswerDecision`, `useRunEventStream` (and any other hook the global pages need) take an optional `ws` that overrides `useWs()`. Verify existing needsyou, live-floor and chat tests still pass, and that a call with an explicit id hits `api.ws` for that id.
- [x] 2.3 While a global page is mounted, open an `EventStream` per listed workspace so membership, decisions and chat queries invalidate; stop them on unmount. Verify streams are created for each listed workspace on `/needs`, `/live` or `/chats` and not on a per-workspace page.

## 3. Global Live

- [x] 3.1 Build the `/live` page: flatten `liveWorkingAgents` across every hosted workspace, each cell named with workspace + worker + ticket, streaming through `useRunEventStream`, reusing the per-workspace resize/expand behaviour with session key `conductor.live.cellSizes.global`. Verify `liveFloor.test.tsx` still passes and a new `globalLive.test.tsx` covers two workspaces' cells, conductor excluded, empty workspace silent, one workspace failing while another renders, empty/loading, and ticket links addressing that worker's workspace.
- [x] 3.2 Per-workspace `/w/$ws/live` still shows only that workspace's working set. Verify the existing Live route test (or live-floor) still opens `/w/$ws/live` with only that workspace's cells.

## 4. Global Chats

- [x] 4.1 Build the `/chats` page: one pane per workspace, horizontal overflow-x row, each pane `<WorkspaceProvider ws={id} remember={false}><ChatPage /></WorkspaceProvider>` with the workspace name as the pane label. Verify a new `globalChats.test.tsx` shows two labelled panes side by side (overflow-x class), creates a missing web thread per pane, and does not rewrite `conductor.ws`.
- [x] 4.2 Sending in a pane posts to that pane's workspace thread only; a live turn streams in that pane only. Verify the test drives send against the pane's workspace id and that a message in Alpha does not appear in Beta.
- [x] 4.3 Per-workspace `/w/$ws/chat` still works, including the VS-166 workspace-switch case. Verify existing `chat.test.tsx` stays green.

## 5. Global Needs you

- [x] 5.1 Build the `/needs` page: flatten open human-owned decisions across every hosted workspace, grouped under a workspace heading, each card the same `DecisionCard` with the same actions, `ws` set to that decision's workspace. Verify a new `globalNeeds.test.tsx` covers two workspaces' cards, answering posts to that workspace only, empty workspace silent, one workspace failing while another renders, empty/loading, and that a hidden-from-chat decision still appears.
- [x] 5.2 Per-workspace `/w/$ws/needs` still shows only that workspace's waiting decisions. Verify existing `needsyou.test.tsx` stays green.

## 6. Cover it

- [x] 6.1 Update `docs/PLAN.md` §21.1 so the left-rail IA mentions the global Needs you, Live and Chats trio above the workspace list. Verify the paragraph exists and still describes per-workspace Live as item 3 of a workspace group.
- [x] 6.2 `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm --filter @agent-conductor/ui exec vitest run` are green.
