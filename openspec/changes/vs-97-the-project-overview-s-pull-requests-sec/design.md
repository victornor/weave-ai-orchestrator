# Design — the overview's Pull requests section

## Context

Everything this section joins already exists on the daemon, in four places that have never met:

| Fact | Where it is today |
|---|---|
| The pull requests themselves | The forge. `GhForge` (`packages/core/src/forge/gh.ts`) only knows `detect`, `prState` and `mergePr`, and only ever for one URL it was handed. Nothing lists. |
| Which pull request is a ticket's | `ticket_work_products` rows with `type = 'pull_request'`, and `tickets.delivery_json.prUrl`. The supervisor already refreshes their state every reconcile pass. |
| Which OpenSpec change a ticket implements | `tickets.openspec_change_name`, already served to the client on the ticket. |
| What is landing and what waits | `tickets.mergeQueue.forProject(projectId)` → `MergeQueueView` with `active`, `waiting` and each entry's `position`. |

Two constraints shape the approach. The forge is the `gh` CLI on the daemon host, so every call is a
process spawn against the GitHub API and cannot be made per render. And the section is a
`ProjectSectionDef.Body` under VS-95's contract: it is handed `{ project, ws }` and reads its own
data, so nothing above it may need to change.

## Goals / Non-Goals

**Goals:**

- One request from the page, one forge call per project per few minutes, and a section that is
  current the moment a ticket opens or lands a pull request.
- A project without a forge is a first-class, boring answer, not an error path.
- Every join is done on the daemon, where the ticket rows are, so the client renders what it is
  given and no client re-derives which pull request is whose.

**Non-Goals:**

- Writing to the forge from this page — approving, merging, reviewing, commenting. Merge approval
  stays the decision it is.
- Inline diff hunks. The file list with additions and deletions is the summary; the diff itself is
  the forge's job and there is a link to it.
- A forge other than GitHub. The capability is optional on the adapter precisely so a second forge
  can arrive later without this change assuming it.

## Decisions

### Listing is two optional methods on `ForgeAdapter`, not a required pair

`ForgeAdapter` is a `packages/plugin-sdk` interface, so every method on it is a contract a
third-party forge must satisfy. `listPullRequests(cwd, opts)` and `pullRequest(cwd, number)` are
therefore declared **optional**: a forge that implements neither is a forge that reports
`available: false, reason: 'unsupported'`, which is exactly the empty state criterion 4 asks for and
which the code has to have anyway. `GhForge` implements both.

Two calls, both in `project.clonePath`, both through the existing `sh` helper with `NO_COLOR=1`:

- list — `gh pr list --state all --limit 60 --json number,title,author,state,isDraft,url,headRefName,baseRefName,createdAt,updatedAt,mergedAt,closedAt,additions,deletions,changedFiles,statusCheckRollup,reviewDecision,mergeCommit`
- one — `gh pr view <number> --json <the same fields plus body,files>`

`--state all` with a limit, then the 30-day window applied on the daemon: `gh` has no "updated
since" filter, and asking for open and recent separately doubles the spawns to save nothing at this
size. `rollupState` already exists and is reused unchanged for the check summary; the detail view
keeps the individual rollup entries so it can list each check by name.

**Alternative rejected:** the GitHub REST API directly with a token. `gh` is what the daemon is
already authenticated as, on the host, per the ticket; a second credential path is a second thing to
expire.

### The join happens in a new `PullRequestsService`, and the client receives it done

`packages/core/src/pull-requests/` — `list(projectId)` and `get(projectId, number)`. It owns the
forge call, the cache, and the join to tickets, spec changes and the merge queue. The route is two
lines in `packages/server/src/routes/projects.ts`, registered before nothing that could shadow it
(`/:id/pull-requests` is a literal under an existing `/:id`, like `/:id/merge-queue` beside it).

The ticket for a pull request is resolved in two steps, in order:

1. **Work product.** `SELECT ticket_id FROM ticket_work_products WHERE type = 'pull_request' AND url = ?`
   — one query for the whole page, indexed by url in memory, not per pull request.
2. **Branch.** A worker branch is `ac/<identifier>-<slug>` (`ticketBranch`, `packages/core/src/workers/index.ts:27`),
   so `headRefName` matching `^ac/([a-z]+-\d+)-` yields the ticket identifier directly. Looking the
   ticket up by identifier is exact; matching the whole branch string is not, because a title edit
   changes the slug and the branch keeps the old one.

Anything that matches neither is listed with `ticket: null`, and its spec change and queue position
are null with it — the spec requires it to still appear.

**Alternative rejected:** joining in the client from `useTickets()`. The board's ticket query is
capped at 300 and is not project-scoped; a project whose tickets fall outside that page would show
pull requests that silently lost their ticket. The daemon has every row.

### The cache is per project, in memory, three minutes, and dropped on the events that would make it wrong

A `Map<projectId, { at: number; value: ProjectPullRequests }>` in the service, `PR_CACHE_TTL_MS =
180_000`. Within the window the forge is not called. A forge call that **fails** leaves an unexpired
entry in place and is reported as `stale: true` rather than replacing a good answer with an error —
the same rule `accounts.refresh()` follows for probe failures.

Freshness comes from the event bus, not from a shorter window: the service subscribes with
`ctx.events.on` and deletes a project's entry on `ticket.work_product`, `ticket.merged` and
`ticket.status`, resolving the event's ticket to its project. That is the only cache-invalidation
path, and it is the one criterion 3 names.

The client half is the matching half: `qk.pullRequests(ws, projectId)` under a
`qk.pullRequestsRoot(ws)`, invalidated in `api/events.ts` by those same three event types. Per the
VS-95 lesson, a query key with no event mapped to it is a page that shows whatever it fetched on
mount — so the key and the mapping land in the same commit as the hook.

The detail is cached the same way under the same project entry, keyed by number, so opening,
closing and re-opening one pull request is one `gh pr view`.

**Alternative rejected:** caching in the SQLite `events`/`activity` tables, or a new table. Nothing
here is worth surviving a daemon restart — the first request after a restart is one `gh` call — and
a table is a migration for a value with a three-minute life.

### Availability is a field, never a status code

The list response is `{ available: boolean; reason?: 'no_forge' | 'not_authenticated' | 'no_clone' | 'unsupported' | 'unreachable'; stale?: boolean; capturedAt: string; pullRequests: PullRequestSummary[] }`,
always `200`. A section that has to distinguish "this project has no forge" from "the request
failed" cannot do it from an HTTP error, and criterion 4 forbids showing an error for the first.
`detect()` — `gh auth status` — is itself cached per project for the same window, because it is
another spawn.

`unreachable` is the one that carries a message: the section says the forge could not be reached and
shows nothing else. Everything else is a settled statement about the project.

### The open pull request is `?pr=<number>` on the overview's own address

`projectRoute` is already declared with `searchPassthrough` (`packages/ui/src/router.tsx:77`), so the
section reads `?pr=` with `useSearchParams` from `app/link` and mirrors it into state — the pattern
Board uses for `?project=`, Settings for `?section=` (VS-51) and Knowledge for `?tab=` (VS-95). That
gives criterion 2's "opening a PR" a real address to link to and return to, without a new route, and
without the detail escaping the section's own column, which is what would break VS-95's contract.

The detail replaces the list inside the section, with a back control — the shape `SpecsPanel`
already uses for `ChangePage` and `CapabilityPage`. On a phone that is the only shape that fits; on
a desktop the section is the two-column `main` span and has the width.

**Alternative rejected:** a `/w/$ws/p/$project/pr/$number` child route. It is more addressable in
name only — the section still has to render inside the page — and it puts a route in the router for
a panel, which the page's other sections do not do.

### The plan is a link, not an embed

Criterion 2 asks for the plan "one click away". The ticket page already renders plan documents with
their revisions (`TicketPage.tsx:42`, `PlanTab`), addressed by tab. The detail links to
`/w/$ws/tickets/$ticketId?tab=plan` when the joined ticket has a `plan` document — which the ticket
summary already reports in its `documents` list, so no extra request is needed to know whether the
link should be there. Re-rendering the plan inside the section would be a second plan viewer to keep
in step with the first.

## Risks / Trade-offs

- **`CoreServices` grows a member.** Both `packages/core/src/testing/context.ts` and
  `packages/server/test/fakes.ts` proxy an unstubbed service into a synchronous throw, so every test
  that reaches the new one fails until each harness supplies it. Known trap; both harnesses are
  updated in the same task as the service.
- **`--limit 60` is a ceiling.** A repository with more than 60 pull requests touched recently would
  drop the oldest of them from the 30-day tail. At this workspace's rate that is far away, and the
  fix when it arrives is a larger limit or a second page, not a different design.
- **A cached list can be up to three minutes behind a pull request opened outside AgentConductor.**
  The event-driven drop covers everything a ticket does; a human opening a pull request by hand on
  GitHub is the case that waits for the window. The captured-at time is shown, so the section is
  never silently wrong about its own age.
- **The branch fallback assumes the `ac/<identifier>-` convention.** A pull request from a branch
  named any other way is listed without a ticket, which the spec explicitly allows. It is a missing
  link, never a wrong one: the identifier is looked up, not guessed.
- **`gh` is spawned by a read request.** The cache and the availability check bound it, but a burst
  of first-time requests for distinct projects is a burst of spawns. Each is a 60-second-timeout `sh`
  call, and a failure degrades to `unreachable` rather than hanging the response.

## Migration

None. No table, no column, no config key, no change to what any agent does. The section's key,
label and position in `PROJECT_SECTIONS` are unchanged; only `PullRequestsSection`'s body is
replaced.
