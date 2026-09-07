# Design — project overview

## Context

Every fact this page needs is already served. The design decision that matters is therefore *not*
what to fetch but how to arrange it so the two follow-up tickets (VS-96 commit graph, VS-97 PR
viewer) can each add a section body without touching the page.

Where each section's data comes from, all through hooks that exist today:

| Section | Source |
|---|---|
| Header | `useProjects()` (name, `gitUrl`, `defaultBranch`, `policies.deliveryMode`), `useWorkspaceSummary().config.defaults.deliveryMode` for the inherited case, `useKnowledgeDoc('project', projectId)` for Current focus |
| Needs you | `useDecisions({status:'open', owner:'human'})` joined to `useTickets()` by `ticketId` → `projectId` |
| Work under way | `useTickets({limit:300})` filtered by `projectId`, folded with `foldBoard`/`liveWorkersByTicket` from `lib/board.ts`; last status line from `useRuns({limit:100})` grouped by `agentId` |
| Landing | `useMergeQueue(projectId)` |
| Recent landings | `useChangelogRecent(projectId)` — a bounded `GET /changelog?project=&limit=100`, `landed` entries within 14 days, joined to the same ticket's `pr_opened` entry for the URL |
| Activity | `useChangelogHeatmap(projectId)` + the same recent page |
| Knowledge | `useKnowledgeDoc('project', projectId)` for the hub, `useKnowledgeDocs(projectId)` for linked documents, `useKnowledgeIndex()` for the budget figure |
| History, Pull requests | nothing yet — reserved |

## Goals / non-goals

- **Goals.** One route, one page, one section contract. Every section live. No new server endpoint.
- **Non-goals.** Writing anything from this page; a project-scoped chat thread; deep links into an
  individual knowledge document (the knowledge area does not have them yet and this change does not
  add them).

## Decisions

### The route is `/w/$ws/p/$project`, and `$project` is a slug or an id

`GET /projects/:id` already resolves `id = ? OR slug = ?`, so both forms are legitimate addresses
for the same project. The page does the same resolution client-side against the project list that
`AppShell` has already loaded — first by `id`, then by `slug` — so opening the overview costs no
request of its own and works offline-of-the-network the same way the board does.

Links are built with the slug because it is what the sidebar already shows and what a human would
type. A project the list does not contain renders a not-found state (with a link back to the board),
*not* an `ErrorState`: nothing failed.

`p/` rather than `projects/` keeps the segment short and cannot collide with an existing child route.

**Alternative rejected:** a `useProject(id)` hook on `GET /projects/:id`. It is one more request per
navigation for data the shell already holds, and it would make the page's first paint depend on it.

### One section shell, one props contract

```ts
// packages/ui/src/routes/project/sections.tsx
export interface ProjectSectionProps {
  /** The resolved project row. Never null: the page renders not-found before any section. */
  project: Project;
  /** The active workspace's canonical id, for building links. */
  ws: string;
}

export interface ProjectSectionDef {
  /** Stable key; also the URL fragment the section is addressable by. */
  key: 'needs' | 'work' | 'landing' | 'landings' | 'history' | 'pulls' | 'activity' | 'knowledge';
  label: string;
  /** Which column the section takes at the desktop breakpoint. */
  column: 'main' | 'side';
  Body: (props: ProjectSectionProps) => React.ReactElement;
}

export const PROJECT_SECTIONS: readonly ProjectSectionDef[] = [...];
```

`ProjectSection` — the shell — owns the `<section id={key}>`, the heading, and on a phone the
disclosure button (`aria-expanded`, `aria-controls`). A body renders content only. VS-96 and VS-97
each replace one `Body` and change nothing else; the ordering, the layout and the other sections are
untouched. A test asserts `PROJECT_SECTIONS` contains `history` and `pulls` in order, so neither can
be quietly dropped while its ticket is open.

`column` is what the desktop layout reads: `main` sections stack in the wide column, `side` in the
narrow one. `history` and `pulls` are `main`, because both will want the width.

**Alternative rejected:** passing each body its data as props from the page. It would make the page
import every section's hooks and turn the page into the thing that has to change when a section
does — exactly what the follow-ups must not require.

### The last status line comes from the runs list, not from a per-worker request

`WorkerDetail` declares an optional `lastStatusLine` that no route ever sends, and
`GET /runs/traces` takes one agent at a time. `GET /runs?limit=100` returns `Run[]` with `summary`
and `agentId` in one request; grouping by `agentId` and taking the newest gives every live worker's
last line at once. Purely client-side, and `run.started` / `run.finished` already invalidate
`qk.runs`, so it is live for free.

### Two invalidation gaps are closed

Criterion 4 ("everything on the page is live") is not reachable without this, and both gaps affect
pages that already exist:

1. **The changelog is never invalidated.** No case in `invalidateFor` touches `qk.changelogRoot`,
   so the Changelog view has been showing whatever it fetched on mount. The events that *produce*
   changelog entries — `ticket.created`, `ticket.status`, `ticket.work_product`, `ticket.merged`,
   `role.hired` — invalidate `qk.changelogRoot(ws)`.
2. **The merge queue is keyed under `projects`.** `qk.mergeQueue` is
   `['w', ws, 'projects', id, 'merge-queue']`, which only `project.*` events reach, so no ticket
   event refreshes it. The key moves to `['w', ws, 'merge-queue', id]` with a `mergeQueueRoot(ws)`
   invalidated by `ticket.status` and `ticket.merged`. The hook is the key's only consumer.

Both are behaviour the overview's spec requires, and both fix the existing pages as a side effect.

### The Knowledge area takes `?project=` and `?tab=`

The overview's Knowledge and Activity links have to arrive with the project selected, or the claim
that they "link to the existing knowledge pages" is hollow. `KnowledgeRoute` mirrors the two search
params into the state it already keeps, the way `Board` does with `?project=` and `Settings` with
`?section=` (VS-51) — read with `useSearchParams` from `app/link`, mirrored so a tab click still
works without a router round-trip. Its five existing test files mock `../app/link` already.

### Phone reachability goes in the More sheet, not in `nav.ts`

`MORE_ITEMS` is pinned by a test against `RAIL` and `TABS`: it is "the rail's leftovers", and
projects are not a rail destination. The projects block is therefore rendered by `MoreSheet` from
`useProjects()` data, as its own labelled group beside the workspace list, and `nav.ts` is not
touched — so `moreSheet.test.tsx`'s existing pinning assertion still holds unchanged.

### Layout

One column below `md`, `md:grid-cols-3` above it with `main` spanning two columns. Sections are
collapsible on the phone only, with local state defaulting to expanded; there is no per-device
memory, because nothing in the ticket asks for one and an unfamiliar collapsed section is worse than
a scroll. The page is a `Page`/`PageHeader`/`PageBody`, so it inherits the `--ac-app-*` sizing and
the bar padding from the shell (VS-79, VS-80) without measuring anything itself.

## Risks

- **`useTickets({limit:300})` is the board's query and is shared.** Filtering it by project on the
  client means a workspace with more than 300 open tickets could under-report a project's work. That
  is the board's existing limit and the same trade-off it already makes; if it ever bites, the fix
  is a `project=` parameter on the query, which the route already supports.
- **A landing's pull request is only found when the `pr_opened` entry is inside the fetched page.**
  100 entries covers far more than 14 days at this workspace's rate; a landing whose PR entry falls
  outside is listed without a link, which the spec allows.

## Migration

None. No stored data, no config, no API. The sidebar's project entries change destination; the board
keeps accepting `?project=`, so old links keep working.
