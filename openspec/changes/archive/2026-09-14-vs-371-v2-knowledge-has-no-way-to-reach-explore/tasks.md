# Tasks

## 1. The shared frame and the five tab routes

- [x] 1.1 Add `KnowledgeFrame.tsx`: `KNOWLEDGE_TABS` (Knowledge · Explorer · Changelog · Graph ·
      Specs, V1's order), `KnowledgeTabs` as a row of links carrying `?project=`, a
      `KnowledgeProjectPicker` select for the header actions slot, and `KnowledgeScreen({tab})`
      wrapping `V2Page`.
- [x] 1.2 Add the `/v2/w/$ws/knowledge/changelog` and `/v2/w/$ws/knowledge/specs` routes in
      `router.tsx` and the matching exports in `pages.tsx`, each rendering the shared frame with its
      body; wrap the existing explorer and graph routes in the frame.

## 2. Knowledge tab

- [x] 2.1 In `KnowledgeHome.tsx`, drop the everything/knowledge/specs/artifacts filter chips and the
      `SpecsSection` capability/change state; keep the search box and hits, the hub list filtered by
      `?project=`, add V1's `DocsPanel` documents catalogue (opens a document), and the artifacts
      list.

## 3. Explorer and Graph tabs

- [x] 3.1 Wrap `KnowledgeExplorerPage` and `KnowledgeGraphPage` bodies in `KnowledgeScreen` with
      their tabs; no change to the bodies themselves.

## 4. Changelog tab

- [x] 4.1 Extract the timeline body of `changelog/ChangelogPage.tsx` into `ChangelogTimeline({project})`
      and have both `V2ChangelogScreen` and the new `KnowledgeChangelogPage` use it.

## 5. Specs tab

- [x] 5.1 Move `SpecsSection`, `CapabilityPage`, `ChangePage` and their helpers from
      `KnowledgeHome.tsx` into `KnowledgeSpecs.tsx`; add `KnowledgeSpecsPage` with a one-line
      explanation at the top and the project picker wired across tabs.

## 6. Verify

- [x] 6.1 Tests: each tab renders its view and survives a remount; the Knowledge tab lists a seeded
      hub's documents and opens one; Explorer and Graph are reachable from the tab row; the
      Changelog tab renders seeded entries; the home no longer lists specs.
- [x] 6.2 Rendered check of each tab in dark and light at desktop and phone width, against
      `08-knowledge` for the parts it covers; recorded in the delivery comment.
- [x] 6.3 Run `pnpm lint`, `pnpm typecheck` and both suites; paste both suite blocks verbatim in the
      delivery comment.
