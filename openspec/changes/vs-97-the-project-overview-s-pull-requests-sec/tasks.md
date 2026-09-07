## 1. The forge learns to list

- [x] 1.1 Add optional `listPullRequests(cwd, opts)` and `pullRequest(cwd, number)` to `ForgeAdapter`
  in `packages/plugin-sdk`, with the summary and detail shapes they return; verify `pnpm typecheck`
  is green and no existing forge implementation is broken by the addition
- [x] 1.2 Implement both in `GhForge` (`packages/core/src/forge/gh.ts`) over `gh pr list --state all
  --limit 60 --json …` and `gh pr view <number> --json …`, reusing `rollupState` for the check
  summary and keeping the individual rollup entries on the detail; verify with a unit test that maps
  recorded `gh` JSON fixtures through both and asserts number, title, author, branch, state, draft,
  additions/deletions, per-file counts, check state and review decision
- [x] 1.3 Cover the failure paths in the same test file — `gh` exiting non-zero, and `gh` returning
  invalid JSON — and verify each surfaces as a thrown `OcError` rather than a malformed result. No
  test in this group calls GitHub: every one runs against fixture JSON

## 2. The service that joins and caches

- [x] 2.1 Add `PullRequestsService` (`packages/core/src/pull-requests/`) with `list(projectId)` and
  `get(projectId, number)`, its response types on `packages/core/src/api.ts`, and its member on
  `CoreServices`; supply it in `packages/core/src/testing/context.ts` and in
  `packages/server/test/fakes.ts` in the same commit, and verify the existing core and server suites
  are still green (an unstubbed service throws synchronously in both harnesses)
- [x] 2.2 Implement the ticket join — work-product URL first, then the `ac/<identifier>-` branch
  prefix resolved by identifier — plus the spec change from `openspec_change_name` and the queue
  position from `mergeQueue.forProject`; verify with a test that a pull request matched by work
  product, one matched by branch, and one matching neither each come back with the right ticket,
  change and queue fields
- [x] 2.3 Implement the 30-day window and the ordering (open first, then merged and closed within
  30 days, most recently updated first in each group); verify with a fixture list spanning both
  groups and one pull request closed 40 days ago that is excluded
- [x] 2.4 Implement the per-project cache (`PR_CACHE_TTL_MS = 180_000`), including the detail cached
  under the same entry by number, and the rule that a failed forge call leaves an unexpired entry in
  place and reports `stale: true`; verify with a fake forge counting its calls that a second request
  inside the window makes no forge call, that the window expiring makes one, and that a throwing
  forge does not evict a good cached answer
- [x] 2.5 Subscribe to `ctx.events` and drop a project's cache entry on `ticket.work_product`,
  `ticket.merged` and `ticket.status`, resolving each event's ticket to its project; verify with a
  test that emitting each of the three re-fetches on the next request and that an unrelated event
  does not
- [x] 2.6 Implement availability: `{ available, reason }` for `no_forge`, `not_authenticated`,
  `no_clone`, `unsupported` and `unreachable`, always answered as a normal result, with `detect()`
  cached for the same window; verify with tests for a project with no clone on disk, a forge that
  implements neither optional method, a `gh` that reports itself unauthenticated, and a forge call
  that throws

## 3. The endpoint

- [x] 3.1 Add `GET /projects/:id/pull-requests` and `GET /projects/:id/pull-requests/:number` to
  `packages/server/src/routes/projects.ts` beside `/:id/merge-queue`, read-only, resolving the
  project by id or slug the way its neighbours do; verify with a server test that both answer 200
  for a project with a fake forge, that the list carries the joined ticket and change, and that a
  project with no forge answers 200 with `available: false` rather than an error status

## 4. The section

- [x] 4.1 Add `usePullRequests(projectId)` and `usePullRequest(projectId, number)` hooks,
  `qk.pullRequests` / `qk.pullRequestsRoot` in `api/keys.ts`, the response types in `api/types.ts`,
  and the `ticket.work_product` / `ticket.merged` / `ticket.status` mapping to `pullRequestsRoot` in
  `api/events.ts`; verify with a test over `invalidateFor` that each of the three invalidates the key
- [x] 4.2 Replace `PullRequestsSection`'s reserved body with the list — open group then recent group,
  each entry showing number, title, author, branch, state, check state, review state, the linked
  ticket, the linked spec change (`/w/$ws/knowledge?project=&tab=specs`) and the queue position when
  queued; verify with a jsdom test rendering a fixture list that asserts the grouping, the two links
  and the queue badge
- [x] 4.3 Add the detail: `?pr=<number>` read with `useSearchParams` and mirrored into state, showing
  the description, the changed files with their additions and deletions and the total, each check by
  name, a link to the forge, and — when the joined ticket has a `plan` document — a link to that
  ticket's plan tab, with a back control returning to the list; verify with a test that arriving with
  `?pr=` opens that pull request, that the plan link appears only when the ticket has a plan, and
  that nothing offers to approve, merge, review or comment
- [x] 4.4 Render each unavailable reason as its own plain statement, with no spinner, no error state
  and no retry, and the empty window as "no pull requests in the last 30 days"; verify with tests for
  `no_forge`, `not_authenticated`, `unreachable` and the empty list
- [x] 4.5 Verify the section still satisfies VS-95's contract and reads at both widths: the existing
  `PROJECT_SECTIONS` pinning test and the project route tests stay green unchanged, and a test
  asserts the section renders in a single column with no horizontal overflow classes at the phone
  breakpoint

## 5. Green

- [x] 5.1 Run `pnpm typecheck` (the full chained one, not the ui filter alone), `pnpm lint`, `pnpm
  test` and the ui suite separately, and verify all four are green with no test reaching the real
  GitHub API
