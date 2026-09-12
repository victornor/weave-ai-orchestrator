## 1. URL document parameter (pure helpers first)

- [x] 1.1 In `packages/ui/src/lib/knowledgeExplorer.ts` add `parseDocParam(param: string | undefined,
      projectId?: string): DocRef | null` and `serializeDocParam(ref: DocRef): string`, encoding
      `project|shared|workspace` scopes as `<scope>:<slug>` (a project-scoped ref takes its project id
      from the caller/`?project=`). Unit-test in `packages/ui/src/lib/knowledgeExplorer.test.ts`:
      round-trip for all three scopes, `project:` with an id, and that malformed input (missing colon,
      unknown scope, empty slug) returns `null` rather than throwing. Verify `vitest run
      packages/ui/src/lib/knowledgeExplorer.test.ts` passes.

## 2. Two-pane frame with independent scrolling

- [x] 2.1 Rebuild the frame in `KnowledgeExplorer.tsx`: root `flex h-full min-h-0`, carrying a
      `--tree-w` CSS variable (default `20%`). Left pane: `w-full min-w-0 min-h-0 ac-scroll
      md:w-[var(--tree-w)]`; right pane: `flex-1 min-w-0 min-h-0 ac-scroll`. Keep the existing tree,
      archive and artifact content in the left pane and render the selected entry's existing panel
      (`DocPanel`/`KnowledgeDocPanel`/`ArchivePanel`/`ArtifactPanel`) in the right pane, not below the
      tree. Verify with a component test asserting the tree and content panes are siblings and each
      carries its own scroll container, and with a desktop screenshot that the tree stays fixed while
      a long document scrolls. Confirm no `min-h-0` is missing on any flex row in the chain.
- [x] 2.2 Add the draggable divider between the panes: `role="separator"` /
      `aria-orientation="vertical"` / `aria-valuenow`, pointerdown + window pointermove/pointerup
      following `Live.tsx`'s `ResizeHandle` shape, clamped to 15%–40%, double-click resets to 20%,
      and `ArrowLeft`/`ArrowRight` step it when focused. Add a small pure `clampTreeWidth(pct)` helper
      and unit-test the clamp bounds; assert the separator's role/valuenow in the component test.

## 3. Selection union, content rendering and default PROJECT.md

- [x] 3.1 Replace the four independent `openDoc`/`openHub`/`openArchive`/`openArtifact` states with one
      `selection` discriminated union (`doc | hub | archive | artifact | null`), render the matching
      existing panel in the right pane, and wire every panel's `onClose`/`onOpen`/`onOpenDoc` to it.
      Verify the updated nested-document, hub-distinct, and archive tests still pass, and add a test
      that selecting a document swaps the right pane without the explorer navigating away.
- [x] 3.2 Compute the default selection when `selection === null`: `{ kind: 'hub', scope: 'project',
      project }` where `project` is the explorer prop, falling back to `useProjects().data?.[0]?.id`;
      render it through `KnowledgeDocPanel`. When no project exists, show a short prompt. Verify by
      test: opening with a project and no selection shows `PROJECT.md`; opening with no project and
      one project shows that project's `PROJECT.md`; no projects shows neither a spinner nor an
      error.
- [x] 3.3 Mark the open document/hub's tree row with `aria-current` and the accent tint. Verify by
      test that the selected row is marked and the previous one is not.

## 4. Narrow-viewport behaviour

- [x] 4.1 Add a local `useMediaQuery('(max-width: 767px)')` to `KnowledgeExplorer.tsx` (the same
      local-hook pattern as `KnowledgeGraph.tsx`). Narrow: render the tree alone when
      `selection === null`, render the content pane alone with a `md:hidden` "← tree" control when a
      selection exists; desktop: always both. Verify with tests that mock `window.matchMedia` to
      narrow: at rest only the tree is shown; after selecting a document only the content is shown and
      the back control returns to the tree. Verify at 390px in the screenshot harness that a document
      is readable and the tree is reachable.

## 5. URL deep-linking

- [x] 5.1 Wire `?doc=` in `KnowledgeExplorer.tsx`: initialize `selection` from `url.doc` via
      `parseDocParam`, adopt external `doc` changes (back/forward, pasted link), write the parameter
      with `useGo('/w/$ws/knowledge', { search: prev => ({ ...prev, tab: 'explorer', doc }), replace:
      true })` when a document is selected, and clear it when a hub/archive/artifact is selected.
      Verify by test: selecting a document updates the URL's `doc` (and keeps `project`/`tab`); opening
      the explorer with `?tab=explorer&project=…&doc=project:<slug>` preselects and renders that
      document without navigating away.

## 6. Preserve artifact behaviour

- [x] 6.1 Confirm in the component tests that the Artifacts entry is unchanged in behaviour: entries
      list with ticket identifiers, selecting one renders `ArtifactViewer`'s iframe with the same
      `title`/`src`, and the entry is still omitted entirely when there are no artifacts. No change to
      the sandbox/CSP path or the artifact API.

## 7. Verification

- [x] 7.1 `pnpm lint && pnpm typecheck` clean.
- [x] 7.2 `pnpm test` green; paste **both** suite blocks (core/server and UI) verbatim with their real
      totals in the delivery report — never one alone, never a retyped combined figure.
- [x] 7.3 Screenshot the explorer in the UI screenshot harness (no live daemon) at a desktop width and
      at 390px, in light and dark mode; confirm full-width panes, independent scrolling, default
      `PROJECT.md`, a readable phone document with a way back, and no hardcoded colour. Deliver the
      screenshots as uncommitted files under this worktree and report their absolute paths.
