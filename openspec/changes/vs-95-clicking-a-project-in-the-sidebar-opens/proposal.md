## Why

A project is the unit the workspace actually works in — its tickets, its workers, its landings, its
changelog, its knowledge and its repository all belong to it — and the app has nowhere that shows
one. Clicking a project in the sidebar today filters the board and nothing else, so answering "what
is happening in this project?" means visiting the board, the merge queue, the changelog tab, the
knowledge tab and the team page in turn, each time re-selecting the same project.

Captain (2026-09-07): *"Each project should have a project overview page, which aggregates
information like changelog, knowledge, git history (a very polished GitKraken-like user experience),
branch visualization, PR viewer with specs and ticket links etc. Basically a very thorough overview
of what is happening in a given project."*

This change is the container: the route, the page architecture, and every section whose data the
daemon already serves. The two heavy viewers — the commit graph (VS-96) and the PR viewer (VS-97) —
are separate tickets blocked on this one, and this page is designed so each drops in as a section
body without the page being reshaped.

## What Changes

- **A project overview route**, `/w/$ws/p/$project`, addressed by the project's slug (its id is
  accepted too, the way the daemon's own `GET /projects/:id` accepts either). The project is
  resolved out of the already-cached project list, so opening the page costs no extra request.
- **The sidebar's project entries open it** instead of the board's project filter. Board, merge
  queue, chat, knowledge and the project's specs stay one click away from the overview's header, so
  nothing that was one click from the sidebar becomes three.
- **The phone reaches it too.** The More sheet grows a Projects block listing the active workspace's
  projects, each opening that project's overview. Its five tabs, their geometry and every existing
  item are untouched.
- **Sections, all scoped to the one project**: header (name, repository, default branch, delivery
  mode, and Current focus read from the project's knowledge file); Needs you (that project's open
  human decisions); Work under way (tickets folded by status with their live worker and that
  worker's last status line); Landing (the merge queue: what is merging and what waits); Recent
  landings (the last 14 days of landed tickets, each with its pull request where one was recorded);
  Activity (the changelog heatmap and the newest entries); Knowledge (the project's hub file
  sections and its linked documents).
- **Two reserved sections, `History` and `Pull requests`**, present and named, each with an empty
  state that says what will appear there and nothing invented. Every section — reserved or not —
  is rendered through one `ProjectSection` shell against one documented props contract, which is
  what VS-96 and VS-97 implement against.
- **Responsive by the same rules as the rest of the app**: one column on a phone with every section
  collapsible, two columns from the medium breakpoint, sized against the `--ac-app-*` custom
  properties so the phone keyboard work from VS-79 still holds.
- **The page is live.** Two gaps stop that being true today and are closed here: no workspace event
  invalidates the changelog queries, and the merge-queue query is keyed under `projects` where no
  ticket event reaches it. Both are wired into `invalidateFor`, which also makes the existing
  Changelog view and Merge queue page live for the first time.
- **The Knowledge area accepts `?project=` and `?tab=`** so the overview's Knowledge and Activity
  links land on that project's knowledge and that project's changelog, the way Settings takes
  `?section=` (VS-51) and the board takes `?project=`.

No new server endpoint, no new daemon behaviour and no change to what workers do: every section
reads an existing route.

## Capabilities

### New Capabilities

- `project-overview/overview-page`: what the project overview is, how it is addressed and reached,
  what each of its sections shows for that project alone, that it stays current from the workspace
  event stream, and how it lays out on a phone and on a desktop.
- `project-overview/reserved-sections`: the two sections the page holds open for the commit graph
  and the PR viewer — that they are present and named before anything implements them, what their
  empty states must say, and the props contract a section body is given.

### Modified Capabilities

- `workspace-navigation/sidebar-workspaces`: adds a requirement for the sidebar's project entries
  and where they lead, and modifies the phone requirement so the More menu also carries the
  active workspace's projects.

## Impact

- `packages/ui/src/router.tsx` — the `/w/$ws/p/$project` route.
- `packages/ui/src/routes/project/` — new: `ProjectOverview.tsx` (the page), `sections.tsx` (the
  section shell and the ordered registry), and one file per section body, including the two
  reserved ones.
- `packages/ui/src/app/WorkspaceNav.tsx` — project entries link to the overview.
- `packages/ui/src/app/MoreSheet.tsx` — the Projects block; `nav.ts` is unchanged, so the test that
  pins `MORE_ITEMS` against `RAIL` and `TABS` still holds.
- `packages/ui/src/api/keys.ts`, `api/events.ts`, `api/hooks.ts` — the merge-queue key moves out
  from under `projects`, changelog and merge-queue invalidation, and a bounded recent-changelog
  hook beside the existing infinite one.
- `packages/ui/src/routes/Knowledge.tsx` — reads `?project=` and `?tab=`.
- `packages/ui/src/lib/projectOverview.ts` — new: the pure folding (decisions for a project, last
  status line per worker, landings joined to their pull requests, the knowledge hub's sections).
- `packages/ui/src/test/` — `projectOverview.test.tsx` and additions to `workspacenav.test.tsx`,
  `moreSheet.test.tsx`, `router.test.tsx` and `events.test.tsx`.
- Nothing outside `packages/ui`.

## Out of scope

- The commit graph and branch visualisation (VS-96) and the PR viewer (VS-97); this change gives
  them their sections and their contract, not their content.
- Any write action on the page: it reads, and links to the pages that already own the writes.
- Project settings, which stay in Settings → Projects.
