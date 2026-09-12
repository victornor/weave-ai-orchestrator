## Context

See `proposal.md` — Why. The current frame is one `div` at
`packages/ui/src/routes/KnowledgeExplorer.tsx:84` (`mx-auto flex max-w-4xl flex-col gap-4`) holding
the tree card, then the selected entry's panel (`DocPanel`, `KnowledgeDocPanel`, `ArchivePanel`,
`ArtifactPanel`) rendered as a sibling *below* it. The tree rows, the archive row, the artifact
section and all four detail viewers work and must be reused, not replaced.

Constraints that shape the approach:

- **Height chain.** `Knowledge.tsx` renders the explorer inside `PageBody`
  (`ac-scroll min-h-0 flex-1`, plus `p-4 md:p-5`), inside `Page` (`flex h-full min-h-0 flex-col`).
  `PageBody` therefore already has a definite height; a child with `h-full min-h-0` gets a bounded
  box, which is what makes per-pane `overflow-y-auto` possible. `GlobalChats.tsx` is the existing
  precedent for exactly this (`PageBody` → `h-full min-h-0` child → independently scrolling panes).
- **The detail viewers are panels, not pages.** `DocPanel` renders body + links/backlinks + edit/move/
  delete; `KnowledgeDocPanel` renders a hub + revisions; `ArchivePanel` renders an archived markdown
  file read-only; `ArtifactPanel` renders the sandboxed `ArtifactViewer` iframe. None is aware of the
  explorer's frame, so any of them can be placed in the right pane unchanged.
- **URL is a passthrough.** `router.tsx` sets `searchPassthrough` on the knowledge route, and
  `Knowledge.tsx` reads `?tab=` and `?project=` into state. There is no document parameter today;
  `?doc=` is additive and needs no route change.
- **Pointer drag already has a pattern.** `Live.tsx`'s `ResizeHandle` installs `window` pointermove/
  pointerup listeners after a `pointerdown` and commits on release; a divider can follow the same
  shape.
- **Breakpoint hooks already have a pattern.** `KnowledgeGraph.tsx` / `Live.tsx` / `GlobalLive.tsx`
  each define a local `useMediaQuery`; tests override `window.matchMedia`.

## Goals / Non-Goals

**Goals:**
- A full-width two-pane frame with independent scrolling and a draggable divider.
- Every existing entry kind keeps opening through its existing viewer, now in the content pane.
- A default `PROJECT.md` selection and URL-addressable document selection.
- One pane at a time on phones, with a way back.

**Non-Goals:**
- Any server/API/CLI/DB change; the explorer's data comes from the same hooks as today.
- Editing, moving or deleting documents (the viewer already offers these; the frame neither adds nor
  removes them).
- Changing the tree's contents, folder derivation, the knowledge graph, or the Artifacts listing's
  behavior.
- Persisting the pane width across sessions, or drag-and-drop anywhere.
- Giving hubs, archived files or artifacts a `?doc=` URL (only documents, per the ticket).

## Decisions

### Frame: `h-full min-h-0` explorer root, `ac-scroll min-h-0` panes — no route change

The explorer root becomes `flex h-full min-h-0 gap-0`. The left pane is `min-h-0 min-w-0
overflow-y-auto` (via `ac-scroll`), the right pane is `flex-1 min-w-0 min-h-0 ac-scroll`. The
`min-h-0` on every flex row between the root and the scroll containers is the part that actually
makes independent scrolling work: without it a flex child defaults to `min-height: auto` and grows to
its content, so the outer `PageBody` scrolls instead and neither pane ever does. `PageBody` keeps its
existing `ac-scroll`/padding behavior; because the explorer root is exactly `h-full`, it does not
overflow, so `PageBody` never scrolls. This is the same structure `GlobalChats.tsx` uses.

**Alternative considered:** change `PageBody` (or the route's `className`) to `overflow-hidden p-0`
so the explorer is edge-to-edge. Rejected: it touches a shared component and the Knowledge page's
other tabs, for a cosmetic gain; the existing padding already satisfies "fills the available width"
rather than a centred column.

### Layout and the draggable divider

Tree pane width defaults to 20% of the frame, clamped to 15%–40%. Width is applied through a CSS
variable (`style={{ '--tree-w': `${pct}%` }}` on the root, tree pane `w-full md:w-[var(--tree-w)]`)
so the narrow-viewport rule (`w-full`) and the desktop proportion coexist without a JS branch for
width. The divider is a `role="separator"` element with `aria-orientation="vertical"` and
`aria-valuenow`; a `pointerdown` records the origin, `window pointermove` sets the clamped percentage,
`pointerup`/`pointercancel` releases, and `ArrowLeft`/`ArrowRight` when focused step the width.
Double-click resets to 20%. This mirrors `Live.tsx`'s `ResizeHandle` mechanics.

**Alternative considered:** a fixed one-fifth proportion with no drag. Rejected only because the
repo already has the pointer-drag pattern, so "cheap" is satisfied; the clamp plus reset keeps it from
being done badly. If implementation reveals the gesture is fighting the rest of the change, the fixed
proportion remains a spec-valid fallback (the spec requires a draggable divider within bounds, so
dropping drag would be a scope change to surface, not a silent choice).

### One selection union, rendered by the existing viewers

Replace the four independent `openDoc`/`openHub`/`openArchive`/`openArtifact` states with one
`selection` discriminated union (`doc | hub | archive | artifact | null`) and a single
`renderSelection(selection)` that returns the matching existing panel (`DocPanel`,
`KnowledgeDocPanel`, `ArchivePanel`, `ArtifactPanel`). `DocPanel`'s `onOpen` and
`KnowledgeDocPanel`'s `onOpenDoc` set `selection` to the new document; every panel's `onClose` clears
it. This keeps exactly one "what is open" fact (today's four booleans can disagree) and makes the
mobile rule one predicate: the content pane is shown when `selection !== null`.

The tree row for the open document/hub gets `aria-current` and the accent tint, so the left pane
reflects the right.

### Default selection is a project's PROJECT.md, computed, not stored

When `selection === null`, the content pane renders `{ kind: 'hub', scope: 'project', project }` where
`project` is the explorer's `project` prop, falling back to `useProjects().data?.[0]?.id` — the same
fallback `SpecsPanel` already uses. Because it is computed rather than written into `selection`:

- desktop always has content (proposal criterion 2), and
- a phone at rest still has `selection === null`, so it shows the tree, not the default document
  (proposal criterion 5).

The default hub is rendered by the existing `KnowledgeDocPanel` (scope `project`, project id), so
`?doc=` selection and the default share one rendering path. With no project selected and no projects
existing, the content pane shows a short prompt instead of a spinner or an error.

**Alternative considered:** default to `WORKSPACE.md` in multi-project ("all") mode. Rejected — the
ticket names `PROJECT.md`.

### Narrow viewport: one pane at a time, chosen in JS

A local `useMediaQuery('(max-width: 767px)')` (the app's `md` breakpoint minus one) decides. Narrow:
render only the tree when `selection === null`, and only the content pane when it is set, with a
`md:hidden` "← tree" button at the top of the content pane. Desktop: both panes always.

**Alternative considered:** pure CSS (`hidden md:flex` toggled by selection). Rejected — it keeps both
panes mounted, so the content pane's `useKnowledgeDoc`/artifact queries would fire while the user is
looking at the tree, and jsdom cannot evaluate media queries, leaving the acceptance behaviour
unverifiable in tests. `useMediaQuery` is the established, mockable pattern in this app.

### URL: `?doc=<scope>:<slug>`, additive and reversible

`parseDocParam(param, projectId)` / `serializeDocParam(ref)` go in
`packages/ui/src/lib/knowledgeExplorer.ts` as pure functions with unit tests (slug grammar already
excludes `:`). The explorer lazily initializes `selection` from `url.doc` on first render, and when
the URL's `doc` changes from outside (back/forward, a pasted link) a small effect adopts it. Selecting
a document calls `useGo('/w/$ws/knowledge', { search: (prev) => ({ ...prev, tab: 'explorer', doc:
serializeDocParam(ref) }), replace: true })`; selecting a non-document clears `doc` from the search.
`replace: true` keeps back/forward from stepping through every tree click. Hubs/archives/artifacts
are deliberately not URL-addressable in this change.

**Alternative considered:** hold `doc` in `Knowledge.tsx` alongside `tab`/`project`. Rejected — the
selection union includes non-URL kinds, and duplicating it at the route would put the explorer's
internal state in two places.

### Tests and visual verification split

jsdom performs no layout, so the acceptance criteria that are geometric (five-to-four proportions,
independent scroll) are verified by class/structure assertions where meaningful and by the project's
UI screenshot harness (see `[[ui-screenshot-harness]]`) at a desktop width and at 390px for the rest,
in both themes. Behavioural criteria (default `PROJECT.md`, selection swapping the pane, mobile pane
rule, URL round-trip, artifact iframe unchanged) are covered in `knowledgeExplorer.test.tsx`, whose
existing mock of `../app/link` must gain `useSearchParams`/`useGo` and whose existing assertions are
updated for the new DOM rather than dropped.

## Risks / Trade-offs

- [Independent scrolling silently fails, the single most common way this layout is built wrong] →
  every flex row in the chain carries `min-h-0` and each pane owns `overflow-y-auto`; a test asserts
  the tree and content containers are siblings with their own scroll containers, and the desktop
  screenshot is checked for a fixed tree while the document scrolls.
- [`DocPanel`'s internal `lg:grid-cols-[1fr_15rem]` keys off the viewport, not the pane, so at a wide
  viewport with a narrow content pane the links sidebar stays side-by-side and squeezes the body] →
  accepted as reuse; the pane has `min-w-0`, so the body wraps rather than overflowing, and the
  alternative (editing `DocPanel`'s breakpoints) risks the document catalogue and ticket pages that
  also render it.
- [Draggable divider breaks under `setPointerCapture` in jsdom or fights React re-renders] → clamp is
  a small pure function tested on its own; the gesture degrades to the fixed default if no pointer
  events arrive.
- [`h-full` on the explorer root collapsing if `PageBody`'s height is not definite in some shell
  state] → `GlobalChats.tsx` and `Live.tsx` already rely on the same chain; the skeleton/error/empty
  early returns stay in-flow and are unaffected.
- [Existing `knowledgeExplorer.test.tsx` renders `<KnowledgeExplorer>` directly with a mocked
  `../app/link`; new imports and a media-query hook change what the mock must provide] → the test
  file is updated in this change; that is expected, not a regression.

## Migration Plan

Pure UI change: no data migration, no route registration, no feature flag. Rollback is a plain revert
of the UI files. The only persisted artifact is the `?doc=` search parameter, which older builds
simply ignore.

## Open Questions

- Whether hub, archive and artifact selections should also become URL-addressable (the ticket asks
  only for documents). Deferrable: the selection union and the URL sync are structured so adding a
  parameter for another kind later is local to `KnowledgeExplorer.tsx`.
