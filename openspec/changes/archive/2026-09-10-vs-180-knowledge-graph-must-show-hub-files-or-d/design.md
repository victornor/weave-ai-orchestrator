## Context

See proposal.md for motivation. `KnowledgeService.graph(projectId)` in
`packages/core/src/knowledge/service.ts` currently:

1. Loads every `knowledge_files` row for the workspace.
2. Filters with `!pid || f.projectId === pid || f.scope === 'shared'` — so a
   project graph always injects SHARED.md, and the unscoped graph emits every
   hub including seed skeletons.
3. Emits one node per remaining row and one edge per resolved
   `knowledge_links` row whose endpoints are both visible.

Hub files are almost never wiki-linked (PROJECT.md Documents is the usual
`[[slug]]` source; SHARED / decisions / WORKSPACE typically have none), so
those three hubs draw as degree-0 chips. VS-175 already made chips labeled;
this change is membership and edges, not chrome.

The UI (`KnowledgeGraph.tsx`, `lib/graph/model.ts`) draws whatever
`GET /knowledge/graph` returns. No payload shape change is needed: structural
edges are ordinary `{ from, to }` rows.

## Goals / Non-Goals

**Goals:**

- Stub workspace hubs disappear from the graph.
- Populated workspace hubs stay as single nodes (openable, same as today).
- Unscoped graph connects workspace → shared and workspace → decisions when
  both ends exist.
- `graph(projectId)` is a project document graph, not a dump of workspace hubs.

**Non-Goals:**

- Not exploding dated notes into child nodes.
- Not adding `entries` / preview fields to `KnowledgeGraph`.
- Not changing layout, zoom, chip chrome (VS-175).
- Not Telegram / TUI. Not the health view's hub list (health still reports
  every hub's budget, stubs included).
- Not inventing wiki-links in the files themselves.

## Decisions

### Filter in `graph()`, not in the UI

The CLI (`conductor knowledge graph`) and the web view share the same
payload. Membership belongs in `KnowledgeService.graph` so both stay honest.
The UI keeps drawing every node it is given; existing canvas tests that feed
a fixture graph do not need to encode stub logic.

*Alternatives considered.* Hide degree-0 workspace hubs in `buildModel`:
would leave the CLI and any other consumer showing dummies, and would hide a
populated SHARED that happens to have no wiki-links. Rejected.

### Stub = no section entries and no resolved wiki-links

Reuse `parseDoc` from `files.ts`. A line is an entry when it is non-blank,
not an HTML comment, and not a parenthetical fill-in hint (`^\([^)]*\)\s*$`).
Title / `##` headings do not count. Seed `decisions.md` (title + comment) is
a stub. Seed `SHARED.md` from `loader.ts` already has house-rule bullets, so
it counts as populated — matching "SHARED.md with convention notes is not an
empty node". Dated `ac_knowledge_note` lines (`- YYYY-MM-DD · …`) are entries
under this rule without a special case.

Resolved wiki-links also keep a hub: a SHARED.md that only points at a
shared document is not a stub.

*Alternatives considered.* Dated-entry-only (`- YYYY-MM-DD ·`): would drop
the seed house-rule bullets until someone added a dated note, and would miss
wiki-only hubs. Rejected. Token-count vs skeleton size: brittle across
budget-marker rewrites. Rejected.

### Structural edges are synthetic, not stored

`graph()` appends `{ from: workspace/WORKSPACE.md, to: workspace/SHARED.md }`
and `{ from: workspace/WORKSPACE.md, to: workspace/decisions.md }` when both
nodes survived the filter. They are not written to `knowledge_links` (that
table is wiki-links only; health's unresolved-link measure must not see
these). `buildModel` already treats them as ordinary directed edges.

If WORKSPACE.md is a stub but SHARED or decisions survived, still emit the
workspace node so the parent exists. That is the one exception to "omit
stubs".

Never add shared/decisions → `projects/<slug>/PROJECT.md`. A real wiki-link
between those paths would already be in `knowledge_links` and stays.

*Alternatives considered.* Child nodes per `##` section or per dated line:
noisy (SHARED can hold a dozen notes) and a new node kind the chip renderer
does not have. The ticket allows "or links into that hub"; opening SHARED.md
is the existing double-click / Open page path. Rejected explosion.

### Project filter drops workspace scopes

Change the visible-row predicate from
`!pid || f.projectId === pid || f.scope === 'shared'` to
`!pid || f.projectId === pid`.

A project's graph is then that project's hub + docs, same as the ticket's
"keep the per-project document graph". SHARED.md with notes is visible on
the unscoped ("all") graph, which is where workspace hubs belong.

Health's visibility rule (`project hub plus shared`) is left alone — that
view is budgets, not the graph.

*Alternatives considered.* Keep injecting populated SHARED into the project
graph with no edge: still a disconnected node, which is the complaint.
Rejected.

### Tests

In `knowledge.test.ts`, next to the existing `graph(projectId)` assertion:

- Unscoped graph, stub decisions.md, SHARED with a convention note: SHARED
  present, decisions absent, edge workspace → SHARED, no edge SHARED →
  project hub.
- Unscoped graph, both SHARED and decisions stubs, no wiki-links: neither
  hub present; workspace hub present only if it has entries or is needed as
  a parent (it is not).
- `graph(projectId)` with a populated SHARED.md: no SHARED / decisions /
  WORKSPACE nodes; project hub → its docs still there.

UI fixture graphs that include SHARED.md as a populated stand-in stay; they
do not go through `graph()`.

`docs/API.md` gets one sentence on stub omission and the two structural
edges.

## Risks / Trade-offs

- [Seed SHARED with house-rule bullets always appears on "all"] → Intended.
  Those bullets are real conventions, not a dummy. A truly empty SHARED
  (comments and headings only) still drops.
- [Workspace hub included as a stub parent looks like a dummy] → It has at
  least one edge to a populated child, so it is a connector, not an isolated
  blob. Opening it still opens WORKSPACE.md.
- [Project graph no longer shows SHARED] → Workspace-scoped by design; the
  Knowledge tab still lists SHARED.md as a budget card. Readers who want it
  on the graph use project = all.
- [Health still lists stub hubs] → Different view; out of scope.

## Migration Plan

None. Payload is additive in edges and subtractive in dummy nodes. Rollback
is revert. No data migration.

## Open Questions

None.
