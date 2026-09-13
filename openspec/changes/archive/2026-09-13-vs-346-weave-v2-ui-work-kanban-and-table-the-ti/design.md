## Context

VS-343 mounted the V2 subtree at `/v2` and registered a route and a header for every destination;
the Work, ticket and artifact pages are placeholder bodies in `packages/ui/src/v2/pages.tsx`. V1
already has all the plumbing this ticket needs, so the work is V2 layout and a V2 column rule on top
of reused hooks and components:

- `packages/ui/src/lib/board.ts` — the V1 fold (`STATUS_COLUMN`, `columnFor`), the live-worker
  lookup, the finished window (`recentlyFinished`, `finishedMode*`) and `mergeStrip`.
- `packages/ui/src/routes/Board.tsx` — the data wiring: two ticket queries (active and finished),
  workers, human decisions, projects, roles, models and the workspace summary for the auto-approve
  exclusion.
- `packages/ui/src/routes/TicketPage.tsx` — the V1 ticket page and its tab components, all built
  from exported hooks (`useTicket`, `useTicketDocument*`, `useTicketComments`, `useTicketRuns`,
  `useTicketUsage`, `useTicketKnowledgeUsage`, `useTicketWorkProducts`, `useDecision`/`useAnswerDecision`).
- `packages/ui/src/components/ArtifactViewer.tsx` — the single sandboxed rendering path (VS-270),
  fed an already-prefixed raw URL; the route table already has `/v2/w/$ws/artifacts/$key`.
- `packages/ui/src/api/hooks.ts` — `usePatchTicket`, `useRetryTicket` and the ticket queries exist;
  the cancel, discard, assign and blockers endpoints exist in the API but V1's UI never exposed them.

See proposal.md for motivation and `specs/web-v2/{work,ticket-page,artifacts}/spec.md` for the
behavior this design implements.

## Goals / Non-Goals

**Goals:**

- A V2 column fold, pure and unit-tested, that keeps V1's live-worker rule and adds the needs-you
  override without changing V1's behavior.
- Work, the ticket page and the artifact reader at their existing V2 routes, reusing V1's hooks and
  its one artifact-rendering path.
- Kept ticket actions — including cancel, discard, reassign and blockers, which V1 never surfaced in
  the web UI — driven through the existing endpoints.

**Non-Goals:**

- Any change to V1's board, ticket page, components, tokens or tests.
- The Knowledge screen's own artifact listing; this ticket ships the workspace-scoped reader address
  that the Knowledge ticket links into.
- Any daemon, HTTP API, MCP, CLI or database change. The four added mutations call endpoints that
  already exist.
- Needs you, Chat, Live, Runs, or any other V2 screen.

## Decisions

**The V2 fold is a new pure module, not a change to `lib/board.ts`.** `v2/work/board.ts` declares
the six V2 columns (Backlog · Proposed · In progress · In review · Blocked · Done) and
`v2ColumnFor(ticket, { live, needsYou })` with precedence **needs-you > live > stored status**:
a needs-you ticket is Proposed, else a live worker makes it In progress when its column is not
human-owned, else the status maps as the spec lists — including `proposing → Proposed`, which
differs from V1's `proposing → In progress`. Mutating `columnFor` in place would change V1's board
and risk its tests; a second pure function keeps each version's contract independent and lets the
needs-you rule be tested without a browser. The shared, version-neutral helpers (`liveWorkersByTicket`,
`pausedWorkersByTicket`, `mergeStrip`, `recentlyFinished`, `finishedModeFromSearch/Search`) are
imported from `lib/board.ts` rather than copied.

**Work reuses V1's board data wiring verbatim.** The same queries (`useTickets({limit:300})`, the
finished query with `sort:'finished'`, `useWorkers({})`, `useDecisions({status:'open',owner:'human'})`,
`useProjects`, `useRoles`, `useModels`, `useWorkspaceSummary`) feed the V2 page. The needs-you set is
computed exactly as V1's autoApproving set is: mapping open decisions to their tickets and excluding
those `isAutoApproving(decision, config, project)` will grant under the active policy, so an
auto-approved ticket is not shown as waiting for the human. The design's card shows no activity line,
so V2 skips the VS-328 `worker.activity` stream V1's cards use.

**Kept ticket actions add four mutation hooks in `api/hooks.ts`.** `useCancelTicket` (`POST
/tickets/:id/cancel`), `useDiscardTicket` (`POST /tickets/:id/discard`), `useAssignTicket` (`POST
/tickets/:id/assign`) and `useSetTicketBlockers` (`PUT /tickets/:id/blockers`) join the existing
`usePatchTicket` and `useRetryTicket`. They live in the shared API module because they are the
version-neutral plumbing the proposal says to reuse, not V2 UI. They change no V1 render path. The V2
header renders its actions in an overflow menu; the toggle, priority and retry remain directly
reachable, and cancel/discard/reassign/blockers sit behind it with a confirmation for the
destructive ones.

**The ticket page keeps one rendering path per artifact.** The Artifacts tab reuses
`ArtifactViewer` unchanged and feeds it the work product's already-prefixed raw URL, exactly as V1's
`ArtifactsTab` does, so ticket artifacts and workspace artifacts keep rendering identically. V2 only
adds the sandbox note around it. The ticket tabs are V2 layout over V1's hooks and heavy components
(`Markdown`, `DecisionCard`, `Composer`, `RunTranscript`, `Table`, `StatTile`), which recolor under
`.v2-root`; V2 does not fork those components.

**The full-screen ticket-artifact reader gets a nested route; the workspace reader keeps its own.**
Adding `/v2/w/$ws/tickets/$ticketId/artifacts/$key` puts the ticket in the address, so the reader
header has real ticket context and the rail highlights Work where the reader was opened from. The
alternative — one `/artifacts/$key` address with a `?ticket=` search — was rejected because it
cannot distinguish a ticket artifact key from a workspace one without a second lookup and highlights
Knowledge while reading a ticket's document. `/v2/w/$ws/artifacts/$key` stays the workspace-scoped
reader (already routed by VS-343) for Knowledge to link into.

**Artifacts default the ticket's tab; a ticket with none defaults to Overview.** The Artifacts tab is
rendered only when the ticket has one, the same hide-when-absent rule V1 uses, and opening a ticket
lands on it when present because the artifact is what the design puts above the fold. Tab selection
round-trips through `?tab=`, as V1's does, so the merge-approval and worker links keep working.

## Risks / Trade-offs

- **The needs-you override changes where a ticket appears compared with V1** (a `blocked` ticket with
  an open retry approval moves to Proposed). → This is the captain's stated rule and the mockup's
  behavior; the fold is pure and tested, and V1 is untouched.
- **Adding a nested route touches the shared router.** → The route is additive and only matches under
  `/v2/w/$ws/tickets/…/artifacts/…`; V2's route test is updated, and V1's route table and tests are
  unchanged.
- **New mutation hooks in `api/hooks.ts` are shared with V1.** → They are new exports used only by
  V2; no V1 component imports them, so no V1 render or test changes.
- **Discard and cancel are destructive.** → Both go through the existing endpoints, which already
  gate discard on an approval and record a reason; the V2 UI confirms before sending.

## Migration Plan

No migration and no data change. The change ships in the web build and appears at `/v2` on deploy;
rolling the UI release back removes it. V1 at `/` and its stored keys are unaffected.
