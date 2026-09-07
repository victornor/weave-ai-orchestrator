# Design — the project overview's commit graph

## Context

Everything this needs is already on disk. `projects.clone_path` is a real clone, and the built-in
worktree provider creates every worker's worktree with `git worktree add` **from that clone**
(`packages/core/src/worktrees/git.ts:23`), so the clone's `refs/heads` already contains the default
branch *and* every live worker branch. One repository, one set of reads — no walking the worker
directories, no second object store.

The rest is relational: `worktrees` rows carry `branch`, `ticket_id` and `agent_id`, and `tickets`
carry `identifier` and `status`. Joining those to the refs is what turns a branch name into "VS-96,
held by Platform Engineer #91".

The two things that do not exist are a read-only git surface and a lane-layout algorithm. Both are
the substance of this change; everything else is wiring.

## Goals / non-goals

- **Goals.** A graph that is honest about the repository, a reading surface that provably cannot
  write or reach the network, a layout algorithm that is a pure function and therefore testable, and
  a section that slots into VS-95's contract by replacing one `Body`.
- **Non-goals.** Any write (no fetch, no checkout, no branch delete — VS-95's page writes nothing and
  neither does this). Patches or file content. Pull requests: VS-97. Blame, tags-as-a-feature, or
  cross-project history.

## Decisions

### The reads hang off `ProjectsService`, not a new core service

`GET /projects/:id/history` and `GET /projects/:id/commits/:sha` are project routes, so
`ProjectsService` gains `history(id, query)` and `commit(id, sha)` in `packages/core/src/api.ts`,
implemented by a new `packages/core/src/projects/history.ts`. The route returns exactly what the
service interface declares, which is the only thing that typechecks the wire shape.

**Alternative rejected:** a `GitHistoryService` member on `CoreServices`. Both test harnesses proxy
an unstubbed service into a synchronous throw, so adding a member fails every test that reaches it
until each harness supplies one — a known cost with no benefit here, since the surface is two read
methods on data the projects service already owns the path to.

### One allowlist, and no caller-supplied git argument

`history.ts` exposes exactly five operations, each a fixed argv built in code:

| Operation | argv |
|---|---|
| refs | `for-each-ref --format=… refs/heads` |
| resolve | `rev-parse --verify --quiet <ref>^{commit}` |
| log | `log --date-order --max-count=<n> --skip=<n> --pretty=format:… <tip…> --` |
| commit meta | `show --no-patch --pretty=format:… <sha> --` |
| commit files | `show --numstat --format= -m --first-parent <sha> --` |

Every one of these is run through the existing `git()` helper (`packages/core/src/util/git.ts`),
which uses `execFile` — an argv array, no shell — with `GIT_TERMINAL_PROMPT=0` and a timeout. There
is no code path where a request value becomes a subcommand, an option, or a ref: `<tip…>` comes from
`for-each-ref` output, and `<sha>` is rejected unless it matches `/^[0-9a-f]{7,40}$/`. The trailing
`--` means a ref that somehow collided with a path is still read as a revision.

The guarantee is tested, not asserted: a test enumerates the argvs the module can build and requires
every first element to be in the read-only allowlist and no element to be a mutating or network verb
(`fetch`, `pull`, `push`, `clone`, `remote`, `checkout`, `reset`, `commit`, `branch`, `worktree`,
`gc`, `config`). That test is the reason the allowlist is a named constant rather than five inline
string arrays.

### The cursor pins the tips it was read against

`git log --skip` is only stable if the ref set is. A branch advancing between page one and page two
would shift every subsequent row by one and silently duplicate a commit — the exact failure the spec
forbids. So the first page resolves the covered refs to object names and returns them inside an
opaque cursor:

```
cursor = base64url(JSON.stringify({ tips: string[], skip: number }))
```

The next page runs `git log … --skip=<skip> <tips…>`, so it continues the same walk. A page with
fewer rows than asked for reports `cursor: null`. The tips are full object names, which makes the
token ~60 bytes per covered branch; a project with fifty live branches produces a ~4 KB query
parameter, which is well inside every limit involved and is the price of correct paging.

**Alternative rejected:** a time-based cursor (`--before=<iso>`). Commits share timestamps — a rebase
or a squash-merge produces several within the same second — so it can only be made correct with a
tie-break the walk does not expose.

### Which refs are covered

`refs/heads` from `for-each-ref`, filtered to: the default branch; every branch of a `worktrees` row
for this project with `removed_at IS NULL`; and every branch recorded as a work product for a ticket
of this project that is not `done` or `cancelled`. A recorded branch the repository no longer has is
dropped — a deleted branch is not an empty branch. Remote-tracking refs are read for decoration only
(`%D` gives them for free) and are never walk tips: `origin/main` behind the local default branch
would only add rows nobody asked for.

### Layout is a pure function in `packages/ui/src/lib/commitGraph.ts`

```ts
export interface GraphRow { sha: string; lane: number; edges: GraphEdge[]; laneCount: number }
export function layoutGraph(commits: { sha: string; parents: string[] }[]): GraphRow[]
```

The standard sweep, in display order, over an array of open lanes each holding the object name it is
waiting for:

1. The commit's lane is the first lane waiting for its object name; if none is, the first free lane,
   appending one if there is no free lane.
2. Any other lane also waiting for it collapses into that lane — this is what draws a merge's
   convergence.
3. The lane is replaced by the commit's first parent; each further parent takes a lane already
   waiting for it, else the first free one.
4. The edges from this row to the next are one per open lane, `{ fromLane, toLane }`, plus one per
   parent that opened a new lane.

Deterministic by construction: the only choice made is "first free lane", and it is made in a fixed
order. That is what makes the four fixture histories the ticket names — linear, one merge, two
concurrent branches, a squash landing — a real test rather than a snapshot. The squash case is the
interesting one: a squash-merged branch has no merge commit, so its lane simply ends, and the test
pins exactly that (its commits keep their own lane, no edge joins them to the default branch).

Doing this on the client rather than the server keeps the endpoint a plain projection of `git log`
and keeps the algorithm testable without a repository — the fixtures are literals.

**Lane capping on a phone** happens at render, not in the layout: `layoutGraph` returns true lane
indices and the renderer clamps to `min(laneCount, capacity)`, folding everything beyond into the
last drawn lane. The layout stays the same function on both viewports, so a narrow screen cannot
disagree with a wide one about which commit is a merge.

### The section is one `Body`, and it is live off existing events

`HistorySection.tsx` is replaced; `sections.tsx`, `ProjectOverview.tsx`, the order and every other
section are untouched — which is exactly the property VS-95's contract exists to provide.

New keys, deliberately not nested under `projects` (VS-95 hit that trap with the merge queue):

```ts
historyRoot: (ws) => ['w', ws, 'history'],
history:     (ws, projectId) => ['w', ws, 'history', projectId],
commit:      (ws, projectId, sha) => ['w', ws, 'history', projectId, 'commits', sha],
```

`invalidateFor` invalidates `qk.historyRoot(ws)` on `worker.spawned`, `worker.retired`,
`ticket.status`, `ticket.merged`, `ticket.work_product` and `project.updated` — the events that
change which branches exist or where they point. Paging is `useInfiniteQuery`, so an invalidation
refetches the pages already loaded rather than collapsing to the first, which is what keeps the
reader's place.

**Honest limit, stated because the spec's live requirement is bounded by it:** a worker committing
mid-turn emits no event, so a commit is picked up at the next event above rather than the instant it
is written. That is the same liveness the board has, which is what criterion 4 asks for; nothing here
polls the repository on a timer, because a git process per project per interval is a cost the page
does not justify.

### The forge link is derived, not fetched

`projectKeyFromUrl` (`packages/core/src/util/git.ts:44`) already turns any remote form — SCP, SSH,
HTTPS — into `<host>/<owner>/<repo>`. A commit link is `https://<key>/commit/<sha>` for hosts whose
commit path is that (github.com, gitlab.com, codeberg.org, and a self-hosted GitLab is
indistinguishable from one so it is not guessed). An unrecognised host gets no link. Nothing calls
the forge: `GhForge` shells out to `gh`, which is a network call this page has no business making.

### Layout inside the section

`history` is already a `main` section, so it spans two of the three desktop columns. Above `md`:
graph on the left, the selected commit's detail in a panel on the right. Below `md`: graph only, and
selecting opens the detail as a sheet. The row is a grid — lane column at a fixed width, then
subject, then a right-aligned author/time — so no row can be pushed off screen by a wide subject, and
the subject truncates rather than wrapping.

## Risks

- **A very wide history.** A repository with dozens of concurrent branches produces dozens of lanes.
  The layout handles it; the phone renderer folds it. The failure mode is a crowded column, not a
  broken page.
- **A clone that is missing or mid-add.** A project in `adding` or `error` has no usable clone. The
  service reports it and the section shows the failure state rather than an empty graph.
- **`--numstat` on a large merge.** Bounded by `-m --first-parent` and the command timeout; a commit
  touching thousands of files returns a long list, so the detail caps the rendered file list and says
  how many more there are.

## Migration

None. No database change, no config, no stored state. The reserved History requirement is withdrawn
as the graph replaces it; the reserved Pull requests section and the section contract are untouched,
so VS-97 lands the same way.
