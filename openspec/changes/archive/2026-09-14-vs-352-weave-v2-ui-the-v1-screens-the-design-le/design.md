## Context

See `proposal.md` — Why. V2 lives under `packages/ui/src/v2/`, mounted lazily at `/v2` in
`router.tsx`; workspace pages mount inside `V2Workspace`'s `WorkspaceProvider`, so `useWs` and the
workspace hooks resolve for `/v2/w/:ws/…`. The four screens in this ticket already have routes and
`V2Page` placeholders in `v2/pages.tsx`; `V2_KEPT` in `v2/nav.ts` already names Global Chats, Usage and
Changelog, and `v2/pages.tsx` exports the placeholders this change replaces (`V2ChatsPage`,
`V2UsagePage`, `V2ChangelogPage`, `V2ProjectPage`).

V1 is the data-and-behaviour reference, not to be changed: `routes/GlobalChats.tsx` (multi-pane,
VS-336/VS-199), `routes/project/**` (VS-95/96/97, VS-107, VS-344's diff fix), `routes/Usage.tsx`
(VS-110, PLAN §16.3), `routes/Changelog.tsx` (PLAN §13.6). The reusable pure models and helpers are
`lib/globalChatLayout`, `lib/projectOverview`, `lib/board`, `lib/commitGraph`, `lib/diffLayout`,
`lib/highlight`, and the `@weave-ai/render` view models. VS-349's `v2/ChatPage.tsx` is the pane
Global Chats runs.

These screens are not in the mockup, so their look is taken from the nearest captured screens captain
named on the ticket (2026-09-13): `shots/01-chat` for Global Chats panes, `shots/03-work` and
`shots/04-ticket` for the project pages, and `shots/11-runs` for Usage's tables, checked in all four
modes (`shots/INDEX.md`). `shots/18-design-notes` carries the status set.

## Goals / Non-Goals

- Goal: the four kept screens at their V2 addresses, showing the same real data and behaviour as V1,
  in V2's tokens, primitives, tags and 38px header.
- Goal: reuse V1's hooks, pure layout/graph models and shared primitives by import; do not fork the
  API layer or re-derive V1 logic.
- Goal: Global Chats panes resize, collapse, reorder and remember their layout.
- Non-goal: new features on any of these screens, the merge-queue page (dropped in V2), any backend
  change, and any change to V1 at `/`.

## Decisions

### Global Chats reuses V1's pure layout model, under V2's own storage key

The multi-pane rules already live in `lib/globalChatLayout.ts` as pure functions
(`reconcileLayout`, `movePane`, `placePane`, `setPairSplit`, `toggleCollapsed`, `nearestExpanded`, …).
The V2 screen imports those rather than reimplementing them. Only the persistence key is versioned:
`readGlobalChatLayout` / `writeGlobalChatLayout` gain an optional storage-key argument defaulting to
V1's `conductor.globalChats.layout`, and V2 passes `weave.v2.chats.layout`. This keeps V1's behaviour
byte-identical (`prefs.ts` already keeps V2's rail state out of V1's, and V2 must not read or write
V1's chat layout) while reusing the model once.

_Alternative considered:_ duplicate the model into `v2/`. Rejected: it forks non-obvious geometry
clamping and reconciliation logic and the two copies would drift.

### Each pane is VS-349's Chat, wrapped in its own workspace provider

`V2ChatPage` reads `useWs` and the workspace hooks, so each pane wraps it in
`WorkspaceProvider ws={id} remember={false} live={live}` exactly as V1's Global Chats wraps its
`ChatPage`; only the focused pane (VS-199: the expanded pane whose header was chosen last) gets
`live`, so the screen opens one `EventStream` regardless of how many workspaces are listed.

The event stream is not the only live resource a pane holds. V1's Global Chats renders
`<ChatPage focused={live} />`, and `focused` gates both `useRunEventStream(..., { live: focused && running })`
and the Cmd+Shift+F search hotkey (`routes/Chat.tsx:203, 427`). `V2ChatPage` today takes no props and
its `useRunEventStream(live?.id ?? null, { live: live?.running ?? false })` (`v2/ChatPage.tsx:277`) has
no such gate, so wrapping it only in `WorkspaceProvider live={…}` would leave every pane whose weaver
is running holding its own live run stream — more connections than VS-199 allows, and a shortcut
firing once per pane. The build therefore adds an optional `focused?: boolean` (default `true`) to
`V2ChatPage` and gates the run stream and any per-pane global listener or keyboard shortcut with it,
exactly as V1's `ChatPage` does; the standalone `/v2/w/:ws/chat` route passes nothing and keeps its
current behaviour. The pane's own 38px identity bar (workspace name, its needs-you count, the collapse
control with the arrow pointing right per VS-341, the reorder menu) is V2's; the body is `V2ChatPage`,
whose own status bar is kept, matching V1's pane-header-above-The-Chat structure.

_Alternative considered:_ rely on `WorkspaceProvider live={false}` alone to bound the panes' resources.
Rejected: it silences the workspace event stream but not `V2ChatPage`'s run stream or any shortcut, so
the pane would still open a live run stream while its weaver is running; the `focused` prop is what V1
uses and what keeps the budget.

### The project overview is rebuilt as V2 components over the same hooks and models

V1's section files carry V1 chrome (`ac-card`, `StatusGlyph`, `Badge`, `Button`, `/w/$ws/…` links).
Restyling means their visual trees change, so the build writes `v2/project/` section components that
use the same hooks (`useProjectHistory`, `usePullRequests`, `usePullRequest`,
`usePullRequestDiffFiles`/`File`/`Context`, `useChangelogRecent`, `useDecisions`, `useTickets`,
`useWorkers`, `useKnowledgeDoc`/`Docs`/`Health`) and the same pure models (`layoutGraph`,
`decisionsForProject`, `foldBoard`, `recentLandings`, `knowledgeSections`, `deliveryModeOf`,
`resolveProject`), with links under `/v2`. The header links to Work, Knowledge and Chat; the
merge-queue link is dropped because V2 has no merge-queue route, and the separate Specs link is
dropped because V2 has no specs route — a project's specs are browsed inside V2's Knowledge screen
(which takes `?project=<id>`), so a Specs link would either 404 or duplicate Knowledge. No route is
added in this ticket.

### The diff is the shared renderer, not a fork

The pull request diff's rows and hunks come from the shared `components/DiffHunks.tsx`
(`UnifiedHunk`, `SplitHunk`, `Code`), `lib/highlight` (`highlightLine`, `languageForPath`,
`useHighlighter`) and `lib/diffLayout` (`useDiffLayout`), driven by the same diff hooks V1 uses. V2
supplies only the file-row chrome (V2 tags and disclosure) around it. This is what keeps VS-344's
fit-to-column and wrap fix in V2 for free, rather than a second diff renderer that would miss it.

_Alternative considered:_ reuse V1's `PullRequestDiff` component wholesale. Rejected: it carries V1's
`Badge`/`Button` chrome and V1 links; wrapping the same primitives costs little more and is fully V2.

### Usage keeps the V1 primitives; the V2 page composes them

V1's Usage figures are rendered with token-driven primitives — `components/Chart`
(`StackedBars`, `RankedBars`, `LineSeries`, `ShareBar`, `StatTile`, `seriesColor`),
`components/WindowGrainPicker`, `components/PlanLimits`, `components/RuntimeCredentials`,
`components/Heatmap` — whose colours resolve from the `--bg-*`/`--text-*`/`--status-*` tokens V2
overrides under `.v2-root`. Reimplementing bar geometry or the picker would add no value and risk
diverging from V1. The V2 work is the page frame, the header actions (the window/grain picker), the
V2 section cards and headings, the empty/error/loading states, and the model-filter behaviour. Where a
primitive carries V1-only card chrome, the V2 page either supplies its own container or the primitive
is wrapped; the underlying query params and view models are unchanged.

_Alternative considered:_ build V2-only chart components. Rejected: the charts are pure geometry over
shared token names; a second copy would drift from PLAN §16.3's figures.

### Changelog reuses the timeline model and kind vocabulary

The screen renders V2 markup over `groupTimeline` (`@weave-ai/render`), the `useChangelog*` hooks and
`components/Heatmap`'s `ActivityHeatmap`, reusing `KIND_LABEL` / `KIND_TONE` exported by
`routes/Changelog.tsx` so the kind vocabulary has one source. Only the visual tree, the V2 links and
the V2 header are new. V1's `ChangelogPanel` is not reused directly because its links are `/w/$ws/…`
and its rows are V1's.

### `V2Page` gains an optional header `actions` slot

Usage's window/grain control, Changelog's nothing and the project overview's destination links belong
in the 38px header the frame already renders, as V1 puts them in its `PageHeader`. `V2Page` gains an
optional `actions?: ReactNode` rendered in the header's right area; the breadcrumb, label and
one-source counts stay in the frame. A screen supplying actions does not render a second header
(HANDOFF §15's one-source rule, and §3's single 38px bar).

_Alternative considered:_ render a screen-owned header for Usage. Rejected: it duplicates the
breadcrumb and the counts and makes the two headers disagreeable.

## Risks / Trade-offs

- **[Reimplementing four screens risks diverging from V1's data behaviour]** → Import V1's hooks and
  pure models; only the visual tree and the link addresses are V2's. Where V1 has non-obvious
  behaviour (the pane focus/refetch rules, a section's scroll cap, "cost only when billed"), call the
  same helpers and keep the same conditions.
- **[V1's chart primitives may still be visually V1 in a V2 frame]** → The primitives are token-driven;
  verify by eye against the nearest designed screens and replace any hardcoded V1 hex or pill shape
  that surfaces. Do not fork the geometry.
- **[Global Chats mounts VS-349's Chat once per workspace]** → Only the focused pane is live (one
  event stream), each pane has its own `WorkspaceProvider`, and panes still read from ordinary queries;
  keep the connection-budget invariant V1's Global Chats tests already pin.
- **[jsdom cannot measure pane widths]** → Test the pure `globalChatLayout` model and the component
  with injected workspaces; the layout is weights, not pixels, so no geometry is needed to test
  reconcile/resize/collapse/reorder. Verify the drag by eye.
- **[The diff renderer is shared with V1]** → Reuse the components and hooks without modifying them; if
  a V2 need appears, add it additively behind a prop so V1 is unchanged.

## Migration Plan

Frontend-only and additive. No data migration; deployment is the daemon's normal UI build. Rollback is
reverting the V2 modules; V1 is unaffected.

## Open Questions

_None that change the specs, approach or task breakdown. These screens are not in the design, so their
look is taken from the nearest designed screens (`docs/design/v2/Screens.dc.html`, Work and Knowledge)
and V2's shared primitives; a real discrepancy found against the mockup is raised with `weave_ask`,
not guessed._
