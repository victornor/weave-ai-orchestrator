## 1. Work cards: no self-tagging status

- [x] 1.1 In `packages/ui/src/v2/work/Work.tsx`, remove the `folded` branch that renders
  `statusText(ticket.status)` as a card tag, keeping the `needs you` tag and the kind and tier tags.
  Verify with a test in `packages/ui/src/test/v2work.test.tsx` that a Backlog card shows no tag equal
  to its column's status (`backlog`/`Backlog`) and that an `in_progress` card shows no `in progress`
  tag, while a card whose column is overridden by a live worker still renders.
- [x] 1.2 Confirm the tier tag still renders for a ticket with no worker-model option when the
  catalog holds two or more options (`WorkerModelTag`'s `default` fallback) and does not render when
  the catalog has fewer than two; verify with a test for both.

## 2. Work columns: the width is asserted

- [x] 2.1 Replace the `data-empty`-only assertion in the empty-column test with one that reads the
  rendered element's own width style (`flex`/`min-width` = the narrow value) for an empty column and
  the wide value for a populated one; verify it fails if the narrow style is removed.
- [x] 2.2 Add a test that a column which was empty becomes wide once a ticket lands in it while a
  still-empty column stays narrow (render with the ticket set empty, then re-render with a card in
  that column; both reads come from the rendered element).
- [x] 2.3 No production change is expected in `KanbanColumn` (VS-346 already narrows empty columns).
  If the rendered check finds a real browser showing an empty column wide, fix the width there and
  keep both tests.

## 3. Map: a shape per node kind

- [x] 3.1 In `packages/ui/src/v2/map/MapCanvas.tsx`, render a `<circle>` for a workspace node, a
  `<rect>` for a project node and a `<polygon>` for a worker node, sized from the existing
  `CORE_RADIUS`, keeping `data-kind`, the fill from `nodeHue`, the label, the tooltip and `onOpen`
  unchanged.
- [x] 3.2 Add a test in `packages/ui/src/test/v2map.test.tsx` that a rendered node of each kind
  contains the shape element its kind owns (and not the others), for a model with a workspace, a
  project and a worker.
- [x] 3.3 Confirm that activating a node of each kind still routes as before (worker → Live, project
  → that project's Work, workspace → Chat); cover it in the same test file if not already covered.

## 4. Chat: a decision renders where it can be answered (captain, 2026-09-14)

- [x] 4.1 In `packages/ui/src/v2/ChatPage.tsx`, keep a decision-card thread message in the
  conversation while a decision it names is known, and never render its prose fallback as a message.
  Do not change `lib/dispatch.ts` or `chatEntries`, and do not touch V1.
- [x] 4.2 Where the decisions pane is absent (phone, and any chat region below the 620px split),
  render the full answerable `V2DecisionCard` inline where the card message sits; where the pane is
  present (desktop), render nothing for it. Derive ticket and project labels from the tickets and
  projects the screen already has.
- [x] 4.3 Switch on the pane's own signal (`shouldSplit(shellWidth)`), guarded by `shellWidth > 0`,
  so a desktop never flashes the inline card before the region is measured.
- [x] 4.4 Answering the inline card SHALL swap it to its note in place: record the answer in a local
  answered map used by the conversation, and clear it when a non-closed refusal comes back.
- [x] 4.5 Tests in `packages/ui/src/test/v2chat.test.tsx`: an open decision renders an answerable
  inline card on phone; an open decision renders nothing in the desktop conversation and is still in
  the pane; answering the inline card swaps it to the note in place; a real message still renders.
  VS-369's `v2decisionAnswer.test.tsx` suite stays green.

## 5. Chat: an answered decision leaves one note

- [x] 5.1 Read answered decisions on a second call to the existing `useDecisions` route
  (`status: 'answered'`), separate from the pane's open list, so an answered card still clears from
  the pane optimistically. No daemon or API change.
- [x] 5.2 Render one muted note line where an answered card sat, at both widths: `You decided:
  <answer> — <title>` for an approval kind, `You answered: <answer> — <title>` otherwise, where
  `<answer>` is the chosen option's label else the first line of the free text; link it to the
  decision's ticket, or to Needs you when it has no ticket.
- [x] 5.3 Tests: an answered question renders exactly one note with the option label and title; an
  answered approval reads `You decided`; both at phone and desktop widths; the note links to Needs
  you when it has no ticket.

## 6. Rendered check against the design

- [x] 6.1 Start an isolated scratch daemon (own `--config-dir` outside the live config, a loopback
  port other than 7433, a recorded PID, stopped only by that PID) with two or more seeded workspaces
  and tickets that leave at least one Work column empty; seed a real chat thread, an open decision
  and an answered decision. Never the live daemon, a systemd unit or port 7433.
- [x] 6.2 Capture Work and Map at desktop width and Chat at both widths, in dark and light, and
  compare each with the matching `docs/design/v2/shots/` capture (the reference set lives at
  `/home/user/Downloads/Weave Control Plane Redesign/shots/`; the in-repo `docs/design/v2/shots/` holds
  no captures). List every comparison and its result in the report.
- [x] 6.3 Confirm from the captures: phone Chat shows an open decision as an inline answerable card
  and an answered decision as one note line; desktop Chat shows the pane beside a conversation with
  no inline card and the same note; a real conversation message renders at both; include the capture
  paths in the report.

## 7. Verification

- [x] 7.1 Run `pnpm lint` and `pnpm typecheck`; both clean.
- [x] 7.2 Run `pnpm test` (core/server suite) and `pnpm --filter @weave-ai/ui exec vitest run`
  separately; paste both suite blocks verbatim and confirm both pass.
- [x] 7.3 Run `openspec validate vs-387-v2-departs-from-the-design-in-four-place --json --strict`
  and confirm it is clean.
- [x] 7.4 Confirm no daemon, HTTP route, MCP tool, CLI, migration or V1 file changed, and that
  `git status --porcelain` in the worktree is empty before requesting review.
