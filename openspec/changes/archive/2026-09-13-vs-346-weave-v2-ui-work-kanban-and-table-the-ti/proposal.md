## Why

VS-343 laid the V2 shell: `/v2` renders, the rail and theme exist, and every destination has a route
and a header over a placeholder body. The Work screen, the ticket page and the artifact reader are
still placeholders. They are the screens a person actually uses to see and steer the workspace's
work, so they are the next self-contained screen group to fill — and they need the V2 column fold,
the ticket header's kept V1 actions, and the artifact rendering path agreed before other screen
tickets start leaning on them.

## What Changes

- **Work at `/v2/w/$ws/work`.** A switchable **kanban and table** view over the workspace's real
  tickets. Six columns — Backlog · Proposed · In progress · In review · Blocked · Done — with the
  new **needs-you** rule: any ticket with an open decision the daemon will not auto-approve shows in
  **Proposed**, whatever its status and even if a worker is live. Empty columns render ~108px wide
  and widen when they hold cards; no tint and no "Empty" label. No status glyph on cards or column
  headers (glyphs stay on table rows and the phone list). The project tag sits top-right of each
  card in the project's hue; the worker role sits on its own bottom row under a hairline with the
  age. **New ticket** uses the existing create endpoint, and the **merge queue strip** replaces the
  dropped Merge queue page. On phone the board is a list.
- **The ticket page at `/v2/w/$ws/tickets/$ticketId`.** The design's header — identifier, kind tag,
  status, title, project in its hue, worker and token/cost line — and its tabs: **Artifacts,
  Overview, Plan, Activity, Work, Usage**. V1's Knowledge-usage tab folds into Usage. V1's ticket
  actions the design omits are kept, restyled, in an overflow menu or equivalent: **auto-merge
  toggle, priority, retry, cancel, discard, reassign and blockers**.
- **Artifacts.** Rendered **inline on the ticket, above the fold**, on the Artifacts tab, and in a
  **full-screen reader** whose header carries the ticket context and a way back to the ticket. The
  frame is the same sandboxed, no-network V1 frame (`/tickets/:id/artifacts/:key` and
  `/artifacts/kit.css`), with the UI saying so. The workspace-scoped artifact reader stays at
  `/v2/w/$ws/artifacts/$key` so Knowledge can link into it.
- **Tests** cover the column fold (including the needs-you rule), the kanban/table toggle, and the
  kept actions.
- Frontend only: no daemon, API, MCP, CLI or migration change. **V1 at `/` is untouched.**

## Capabilities

### New Capabilities

- `web-v2/work`: the Work screen — the kanban and table views, the six-column fold with the
  needs-you override, card and column anatomy, the merge queue strip, New ticket, filters, and the
  phone list.
- `web-v2/ticket-page`: the V2 ticket page — its header, its tabs and their real content, the folded
  Knowledge usage, and the kept V1 ticket actions.
- `web-v2/artifacts`: artifact rendering — inline above the fold on a ticket, the full-screen reader
  with ticket context, the shared sandboxed no-network frame, and the workspace-scoped reader route
  Knowledge links into.

### Modified Capabilities

_None. This ticket fills placeholder bodies; it changes no V1 requirement and no requirement of
`web-v2/shell`, `web-v2/theme` or `web-v2/navigation`, which already promise a route, a header and a
scope for every one of these destinations._

## Impact

- **New:** `packages/ui/src/v2/work/**` (the board model, kanban and table views, cards and rows),
  `packages/ui/src/v2/ticket/**` (the ticket page and its tabs), `packages/ui/src/v2/artifact/**`
  (the shared reader and its wrapper), plus their tests under `packages/ui/src/test/`.
- **Modified:** `packages/ui/src/v2/pages.tsx` (the Work, ticket and artifact placeholders become
  the real screens), `packages/ui/src/router.tsx` (a nested ticket-artifact reader route),
  `packages/ui/src/api/hooks.ts` (additive mutation hooks for the existing cancel, discard, reassign
  and blockers endpoints, which the V1 UI never exposed).
- **Reused, not forked:** `packages/ui/src/lib/board.ts` (the fold's constants and helpers),
  `packages/ui/src/components/ArtifactViewer.tsx` (the one sandboxed rendering path),
  `packages/ui/src/lib/projectColor.ts`, and the `packages/ui/src/api/**` queries
  (`useTickets`, `useWorkers`, `useDecisions`, `useProjects`, `useRoles`, `useModels`,
  `useWorkspaceSummary`, `useMergeQueue`, `useTicket*`, `useTicketWorkProducts`,
  `useWorkspaceArtifacts`).
- **Tests:** new UI tests for the V2 fold (including needs-you and the auto-approve exclusion), the
  kanban/table toggle showing the same ticket set, the ticket tabs and kept actions, and artifact
  inline plus reader rendering. V1's suite must stay green unchanged.
- No HTTP route, MCP tool, CLI command, database migration or daemon file changes.
