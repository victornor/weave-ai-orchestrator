## 1. The V2 column fold

- [x] 1.1 Add `packages/ui/src/v2/work/board.ts` with the six V2 columns (Backlog, Proposed, In
  progress, In review, Blocked, Done) and a pure fold mapping every ticket status to a column as the
  spec lists (`proposing` → Proposed), importing the version-neutral helpers from `lib/board.ts`.
  Verify with a unit test asserting each of the eleven statuses folds to its specified column.
- [x] 1.2 Add the precedence rule to the fold — a needs-you ticket is Proposed, else a live worker
  makes a non-human-owned ticket In progress, else the status maps — and verify with unit tests for
  the live-worker case and the needs-you case (including a `blocked` ticket with an open decision).
- [x] 1.3 Build the needs-you set from the open human-owned decisions, excluding those
  `isAutoApproving` will grant under the active policy, as V1's board does, and verify with a unit
  test that an auto-approvable decision does not move its ticket to Proposed.
- [x] 1.4 Add the V2 finished window over `done`/`cancelled` reusing `recentlyFinished` and the
  finished-mode URL helpers, and verify with a unit test that cancelled tickets appear under the
  finished window and not as an open column card.

## 2. Work: the kanban board

- [x] 2.1 Replace the `V2WorkPage` placeholder in `packages/ui/src/v2/pages.tsx` with the Work screen
  wiring the board queries (`useTickets` active and finished, `useWorkers`, `useDecisions`,
  `useProjects`, `useRoles`, `useModels`, `useWorkspaceSummary`), and verify the page renders real
  tickets from the workspace.
- [x] 2.2 Build the kanban columns from the fold, rendered as narrow (~108px) empty columns and wide
  populated columns with no tint and no "Empty" label, and verify with a test that an empty column
  is narrow and a populated one is wide.
- [x] 2.3 Build the card: identifier, project tag top-right in the project's hue, title, kind and
  tier tags, and the worker role and age on their own row under a hairline, with no status glyph;
  verify with a test asserting no glyph on a card and the project tag's hue.
- [x] 2.4 Render the column header as name plus count only (no glyph) and derive the count from the
  cards rendered; verify with a test that the header count equals the number of cards.
- [x] 2.5 Add the merge queue strip and the New ticket control, and verify with tests that the strip
  states landing/waiting consistently with the tickets and that creating a ticket calls the create
  endpoint.

## 3. Work: the table view, filters and phone

- [x] 3.1 Add the kanban/table toggle over the same loaded set, and verify with a test that both
  views render the same tickets and that toggling switches which one is shown.
- [x] 3.2 Build the table grouped under the same six columns, each group header carrying the glyph,
  name and count and each row carrying its status glyph plus identifier, title, kind, priority and
  age; verify with a test asserting a row's cells and that activating a row opens its ticket.
- [x] 3.3 Add the project, role, kind and priority filters applied to both views, and verify with a
  test that a filter narrows the kanban and the table to the same set.
- [x] 3.4 Render the phone list with a status glyph per row, and verify with a test that Work at
  phone width renders a list rather than columns or a table.

## 4. The ticket page

- [x] 4.1 Replace the `V2TicketPage` placeholder with the ticket page header — identifier, kind tag,
  status, title, project tag in its hue, worker, token/cost line and the link back to Work — and
  verify with a test that the header renders those facts and the not-found state for an unknown id.
- [x] 4.2 Present the tabs Overview, Plan and Artifacts (the last only when the ticket has an
  artifact), with `?tab=` accepting `overview`, `plan` and `artifacts` and mapping the old values
  (`activity`, `work`, `usage`, `knowledge`) to Overview; default to Artifacts when the ticket has one
  and Overview otherwise. Verify with tests for the tab set, an old value opening Overview, and a
  named tab opening directly.
- [x] 4.3 Build Overview as one scrolling page: row 1 a two-pane split — the overview pane (description,
  ticket and delivery facts, blockers, retry decision) beside the Activity pane (comments and turns in
  time order, merge decision, reply composer) which scrolls on its own — then row 2 Work (work
  products, OpenSpec tasks, worktree, runs), row 3 Usage (tokens, cost, runs, per-turn table) and row 4
  Knowledge (hub and document tokens, documents read). Verify with tests for the section order, the
  Activity pane scrolling independently, and the panes stacking overview-first on phone.
- [x] 4.4 Keep Plan as its own tab (document, revisions, held-state `DecisionCard` answering) and keep
  the ticket actions from group 5 unchanged. Verify with a test that Plan renders the document and its
  approval card.

## 5. The kept V1 ticket actions

- [x] 5.1 Add `useCancelTicket`, `useDiscardTicket`, `useAssignTicket` and `useSetTicketBlockers` to
  `packages/ui/src/api/hooks.ts`, each calling its existing endpoint and invalidating the ticket
  queries; verify with unit tests that each calls the right method and path.
- [x] 5.2 Build the ticket header's overflow actions — the auto-merge toggle, priority, retry,
  cancel, discard, reassign and blockers, with a confirmation for cancel and discard — and verify
  with tests that auto-merge, retry, cancel and discard each invoke their endpoint from the UI.
- [x] 5.3 Render the ticket's blockers and keep the assign/blockers controls reachable, and verify
  with a test that reassign and blockers are reachable and call their endpoints.

## 6. Artifacts

- [x] 6.1 Render the ticket's published artifacts inline, above the fold, on the Artifacts tab using
  `ArtifactViewer` with the work product's raw URL, offering a choice when there is more than one and
  a link-only row for one with no stored content; verify with tests that an artifact renders inline
  and a link-only artifact does not mount a frame.
- [x] 6.2 Add the sandbox note stating the frame is sandboxed and cannot call the daemon, and verify
  with a test that the note is present on the rendered artifact.
- [x] 6.3 Add the full-screen ticket-artifact reader route `/v2/w/$ws/tickets/$ticketId/artifacts/$key`
  whose header carries the artifact title and ticket context (identifier, project in its hue, worker)
  with a control back to the ticket, rendering the same sandboxed frame with revision selection and
  open/copy-link/download; verify with tests that the header shows ticket context and the ticket
  control opens the ticket.
- [x] 6.4 Keep the workspace-scoped reader at `/v2/w/$ws/artifacts/$key` rendering the artifact in
  the same frame and stating not-found for an unknown key; verify with tests for both.

## 7. Verification

- [x] 7.1 Run `pnpm lint` and `pnpm typecheck`; both clean.
- [x] 7.2 Run `pnpm test` (core/server suite) and `pnpm --filter @weave-ai/ui exec vitest run`
  separately; paste both suite blocks verbatim in the report and confirm both pass.
- [x] 7.3 Confirm no HTTP route, MCP tool, CLI command, database migration or daemon file changed,
  and that V1's touchpoints are only the additive API hooks and the additive V2 route.
- [x] 7.4 Run `openspec validate vs-346-weave-v2-ui-work-kanban-and-table-the-ti --json --strict`
  and confirm it is clean.
- [x] 7.5 Treat the acceptance list as the exit criteria: real tickets land in the columns and a
  ticket waiting on the human shows in Proposed with counts matching; kanban and table show the same
  tickets and empty columns render narrow; the ticket page shows every tab with real data and the
  auto-merge, retry, cancel and discard actions work; an artifact renders inline and in the
  full-screen reader, sandboxed.
