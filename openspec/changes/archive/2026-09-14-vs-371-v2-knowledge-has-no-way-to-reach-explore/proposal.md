# Give V2 Knowledge V1's Knowledge · Explorer · Changelog · Graph · Specs structure, restyled

Tracker change for [VS-371](weave://tickets/VS-371). A `task` ticket, so this change carries tasks
only — `skip_specs: true`.

## Why

Captain reports V2's Knowledge screen as a mess: one page mixes knowledge bases, artifacts and a
"Specs" list of capabilities with archived and active changes, shows no documents, and has no link
to the Explorer, Changelog or Graph views that VS-347 built. V1 has five clear tabs for these.
VS-343 decided V2 keeps V1's knowledge graph and explorer views, restyled; this ticket gives the
Knowledge screen V1's tab structure.

## What changes

- **`packages/ui/src/v2/knowledge/KnowledgeFrame.tsx`** (new) — the shared frame: the
  **Knowledge · Explorer · Changelog · Graph · Specs** tab row (V1's order) as links under the V2
  header, the `?project=` project picker in the header's actions slot, and the `KnowledgeScreen`
  wrapper that puts them around each tab's body.
- **`packages/ui/src/router.tsx` / `pages.tsx`** — the existing `/knowledge`, `/knowledge/explorer`
  and `/knowledge/graph` routes are joined by `/knowledge/changelog` and `/knowledge/specs`, so the
  address reflects the tab and survives reload and back/forward.
- **`KnowledgeHome.tsx`** — the Knowledge tab: the hub list with its budget meters, V1's
  `DocsPanel` documents catalogue (titles, folders, orphan health, last updated; opens a document to
  read it), the cross-knowledge search and the artifacts list. The `SpecsSection` and its
  capability/change pages move out.
- **`KnowledgeSpecs.tsx`** (new) — `SpecsSection`, `CapabilityPage` and `ChangePage`, moved
  unchanged out of the home, plus a one-line explanation of what specs are.
- **`KnowledgeChangelogPage.tsx`** (new) — the Knowledge changelog tab: V2's changelog timeline
  (extracted from `changelog/ChangelogPage.tsx` as `ChangelogTimeline`) scoped to the selected
  project.
- **`KnowledgeExplorerPage.tsx` / `KnowledgeGraphPage.tsx`** — wrapped in the shared frame; their
  bodies are unchanged.
- **Tests** — `v2knowledge.test.tsx` updated for the new Knowledge tab; new tests for the tab row,
  the specs tab and the changelog tab.

V1 is unchanged; the explorer and graph bodies are the kept V1 views reused as they are.

## Out of scope

Any daemon, API, CLI or schema change; the project-overview knowledge section; the V1 screens.
