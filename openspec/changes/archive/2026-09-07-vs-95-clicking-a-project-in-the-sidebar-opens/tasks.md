## 1. Data plumbing and liveness

- [x] 1.1 Move the merge-queue query key to `['w', ws, 'merge-queue', projectId]` and add
  `mergeQueueRoot(ws)` in `api/keys.ts`, updating the one consumer in `useMergeQueue`; verify
  `pnpm --filter @agent-conductor/ui exec vitest run mergeQueue` stays green.
- [x] 1.2 Invalidate `qk.changelogRoot(ws)` on `ticket.created`, `ticket.status`,
  `ticket.work_product`, `ticket.merged` and `role.hired`, and `qk.mergeQueueRoot(ws)` on
  `ticket.status` and `ticket.merged`, in `invalidateFor`; verify with cases in
  `test/events.test.tsx` asserting each event marks those keys stale.
- [x] 1.3 Add `useChangelogRecent(project, limit)` in `api/hooks.ts` — one bounded
  `GET /changelog?project=&limit=` under `qk.changelogRoot`, beside the existing infinite hook;
  verify it is invalidated by 1.2's events in the same test file.

## 2. Pure folding, with its own tests

- [x] 2.1 Add `packages/ui/src/lib/projectOverview.ts` with `resolveProject(projects, param)`
  (by id then slug), `decisionsForProject(decisions, tickets, projectId)`,
  `lastLinesByAgent(runs)`, `recentLandings(entries, now, days)` joining each `landed` entry to the
  same ticket's `pr_opened` link, and `deliveryModeOf(project, config)` returning the mode and
  whether it is inherited; verify each with unit cases in `test/projectOverview.test.tsx`.
- [x] 2.2 Add `knowledgeSections(markdown)` to the same module, returning the hub file's
  `## ` sections with their bodies, plus a `currentFocus` convenience; verify against a fixture
  hub file, a file with no Current focus, and an empty body.

## 3. The section shell and the page

- [x] 3.1 Add `routes/project/sections.tsx` with `ProjectSectionProps`, `ProjectSectionDef`,
  the `ProjectSection` shell (`<section id>`, heading, phone disclosure with `aria-expanded` and
  `aria-controls`) and the empty `PROJECT_SECTIONS` registry; verify a test asserts the registry's
  keys and their order, including `history` and `pulls`.
- [x] 3.2 Add `routes/project/ProjectOverview.tsx`: resolve the route param, render the header
  (name, repository, default branch, delivery mode with its inherited marker, Current focus) and the
  links to board, merge queue, knowledge, specs and chat; render the not-found state for an unknown
  project; verify with tests covering slug, id, unknown project and the inherited delivery mode.
- [x] 3.3 Register `/w/$ws/p/$project` in `router.tsx` with search passthrough; verify
  `test/router.test.tsx` covers that the path renders the overview.

## 4. The sections that have data

- [x] 4.1 Needs-you section: this project's open human-owned decisions, each opening its ticket, and
  a "nothing waiting" state; verify from fixtures including a decision belonging to another project.
- [x] 4.2 Work-under-way section: unfinished tickets folded by status with the live worker's name
  and last status line; verify from fixtures covering a ticket with a worker and a line, a ticket
  with a worker and no line, and a ticket with no worker.
- [x] 4.3 Landing section: the project's merge queue, what is merging and what waits in order;
  verify from a fixture queue and from an empty one.
- [x] 4.4 Recent-landings section: the last 14 days, newest first, each with its ticket link and its
  pull-request link where one exists; verify from fixtures covering a landing with a PR, one
  without, one older than 14 days (excluded) and an empty window.
- [x] 4.5 Activity section: the project's changelog heatmap and newest entries, reusing the existing
  heatmap and changelog components; verify the section renders from a fixture heatmap and page and
  that the entries shown are the project's.
- [x] 4.6 Knowledge section: the project hub file's sections with its budget use, and the project's
  linked documents each opening the knowledge area with that project selected; verify from fixtures
  including a project with no documents.

## 5. The reserved sections

- [x] 5.1 Add `routes/project/HistorySection.tsx` rendering only the empty state naming the commit
  graph and branches; verify a test asserts the section is present, named History, and renders no
  list, spinner or error.
- [x] 5.2 Add `routes/project/PullRequestsSection.tsx` rendering only the empty state naming pull
  requests with their tickets and spec changes; verify the equivalent test.

## 6. Getting there

- [x] 6.1 Point the sidebar's project entries at `/w/$ws/p/$project`; verify `test/workspacenav.test.tsx`
  asserts the new destination and that a non-active workspace's group lists no projects.
- [x] 6.2 Add the Projects block to `MoreSheet` from `useProjects()`, without touching `nav.ts`;
  verify `test/moreSheet.test.tsx` covers choosing a project and that the existing assertion pinning
  `MORE_ITEMS` against `RAIL`/`TABS` still passes unchanged.
- [x] 6.3 Make `KnowledgeRoute` read `?project=` and `?tab=` and mirror them into its state; verify
  a test opens the route with both and gets that project's changelog tab.

## 7. Layout and verification

- [x] 7.1 Lay the page out single-column with collapsible sections below `md` and multi-column above,
  sized through `Page`/`PageBody` rather than viewport units; verify a test toggles a section and
  asserts `aria-expanded` and that the body is hidden, and that no raw `vh`/`dvh`/`svh` is
  introduced.
- [x] 7.2 Run `pnpm typecheck`, `pnpm lint`, `pnpm test` and
  `pnpm --filter @agent-conductor/ui exec vitest run` and verify all four are green, including the
  pre-existing board, chat, appshell, router and knowledge suites.
