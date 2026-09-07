## 1. Wire types

- [x] 1.1 Add the history wire types. **Deviation from the plan:** landed in
      `packages/core/src/api.ts` next to `ProjectsService`, not `packages/shared/src/types.ts` —
      VS-97 (merged after this design was written) established that a response envelope with no
      cross-package reuse (nothing in `cli` or `tui` needs a commit graph) belongs beside the service
      interface that returns it, mirrored by hand into `packages/ui/src/api/types.ts` for the wire,
      exactly as `ProjectPullRequest` does. `ProjectRef`, `HistoryCommit`, `HistoryQuery`,
      `HistoryPage`, `CommitFile`, `CommitDetail` — all as designed, just relocated.

## 2. The read-only repository surface

- [x] 2.1 Add `packages/core/src/projects/history.ts` with the named read-only allowlist and the
      argv builders, each run through the existing `git()` helper with a timeout and
      `GIT_TERMINAL_PROMPT=0`. **Deviation:** four operations, not five — `for-each-ref` returns
      each branch's object name directly, so the separate `rev-parse --verify` "resolve" step the
      design sketched was redundant and dropped; `HISTORY_GIT_SUBCOMMANDS` names the four that remain
      (`for-each-ref`, `log`, and two `show` invocations).
- [x] 2.2 Implement ref coverage: `for-each-ref refs/heads` intersected with the default branch, live
      `worktrees` rows for the project, and branches recorded for the project's unfinished tickets;
      join each ref to its ticket identifier and its worker name; drop a recorded branch the
      repository no longer has.
- [x] 2.3 Implement `history(id, { cursor?, limit? })`: resolve tips on the first page, encode
      `{tips, skip}` as the base64url cursor, run `git log --date-order` over the pinned tips, parse
      sha/parents/author/date/subject, derive each commit's refs by matching its sha against the
      already-resolved ref list (no decoration parsing needed), and report `cursor: null` at the end.
- [x] 2.4 Implement `commit(id, sha)`: reject a sha that is not `/^[0-9a-f]{7,40}$/`, read metadata
      and `--numstat -m --first-parent` files, cap the file list, and derive the forge URL from the
      project's `gitUrl` for the recognised hosts only (github.com, gitlab.com, codeberg.org).
- [x] 2.5 Report a missing clone as a plain `not_found` failure and never create anything to make a
      read succeed; an empty repository (no branches yet) reads as a valid, empty page rather than an
      error, since that is its honest state.
- [x] 2.6 Declare `history` and `commit` on `ProjectsService` in `packages/core/src/api.ts` and wire
      them through `packages/core/src/projects/index.ts`.
- [x] 2.7 Tests in `packages/core/src/projects/history.test.ts` (14 tests, all passing): a temp
      repository built by the test for each shape (linear, a merge, two branches, a squash landing);
      ref coverage including a deleted branch and a worker-held branch; paging continuity across a
      branch that moves between pages; a merge's first-parent numstat; a rejected sha; a missing
      clone; and the allowlist test enumerating every argv the module can build against a
      forbidden-verb list.

## 3. The routes

- [x] 3.1 Added `GET /projects/:id/history` (`cursor`, `limit`) and `GET /projects/:id/commits/:sha`
      to `packages/server/src/routes/projects.ts`; documented in `docs/API.md`.
- [x] 3.2 Server tests in `packages/server/test/app.test.ts` (6 tests, all passing): the first page
      and the second continue correctly, an out-of-range `limit` is a validation error, an unknown
      project 404s, a malformed sha is refused, an unknown sha 404s, and a commit detail carries its
      files and forge URL. `createHistoryReader` exported from core and wired real into
      `packages/server/test/fakes.ts`'s `projects` fake (`history`/`commit`), the same way the
      changelog and pull-requests fakes run their real service over the harness's real sqlite db.

## 4. The graph layout

- [x] 4.1 Added `packages/ui/src/lib/commitGraph.ts` with `layoutGraph(commits)` returning per-row
      lane, edges and lane count, by the sweep in the design.
- [x] 4.2 Tests in `packages/ui/src/test/commitGraph.test.tsx` (7 tests, all passing): the four
      fixture histories the ticket names — linear (one lane), one merge (an edge to each parent's
      lane), two concurrent branches (two lanes plus the branch point), a squash landing (the
      squashed commit itself carries exactly one edge, never a merge diamond) — plus determinism, a
      parent below the last row, and a root commit ending its lane with no continuation edge.

## 5. The History section

- [x] 5.1 Added `qk.historyRoot`, `qk.history` and `qk.commit` to `packages/ui/src/api/keys.ts` and
      the `useProjectHistory` (infinite, mirrors `useChangelog`) and `useCommit` hooks to
      `api/hooks.ts`, plus mirrored wire types in `api/types.ts` (VS-97's precedent).
- [x] 5.2 Invalidate `qk.historyRoot(ws)` in `api/events.ts` on `worker.spawned`, `worker.retired`,
      `ticket.status`, `ticket.merged`, `ticket.work_product` and `project.updated`; extended
      `src/test/events.test.tsx` (6 new cases, all passing).
- [x] 5.3 Replaced `HistorySection.tsx`: the ref bar with selection, the graph rows (lane SVG via
      `layoutGraph`, extended with a `lanesAfter` field so idle lanes still draw through a row),
      subject, author, relative time, abbreviated sha, refs with the default branch distinguished,
      and the ticket identifier from the ref's own ticket or a `PREFIX-123` match in the subject,
      linked.
- [x] 5.4 Incremental loading: a first page on open, a "Load more" action (mirrors `Changelog.tsx`'s
      `loadOlder` — no scroll-sentinel convention exists in this codebase to build on), a loading
      line while it loads, an end line when there is no more, and an `ErrorState` with a retry that
      never reads as an empty history.
- [x] 5.5 Commit selection: the detail panel beside the graph above `md` and a `Sheet` below it
      (`useMediaQuery`, mirroring `KnowledgeGraph.tsx`'s local hook), with full message, changed
      files and their additions and deletions, the forge link when there is one.
- [x] 5.6 Branch selection: highlight the lane (ring on matching rows) and name the ticket and the
      worker with links, or say the branch belongs to no ticket.
- [x] 5.7 The narrow layout: the lane column is capped at `PHONE_MAX_LANES` and rendering folds
      extra lanes to the cap; the row is a flex line with `truncate` on the subject, so there is no
      horizontal scroll.
- [x] 5.8 UI tests: `src/test/historySection.test.tsx` (15 tests) — rows and refs from fixtures, a
      ticket identifier from the branch and from the message, selecting a commit shows its files,
      selecting a branch names its ticket and worker, the end-of-history/loading/error states, and a
      second page appending without collapsing. `src/test/projectRoute.test.tsx` updated: its stale
      "reserved" assertion replaced with a smoke test (mirrors how VS-97 treats Pull requests there),
      `../api/hooks` mock extended with `useProjectHistory`/`useCommit` so the whole page still
      renders. `PROJECT_SECTIONS` order is still pinned by the existing test, unchanged.

## 6. Verification

- [x] 6.1 `pnpm typecheck`, `pnpm lint` green. `pnpm exec vitest run packages/core packages/server`:
      908 passed (one `engine.test.ts` timing flake on a shared run, reproduced as a clean pass in
      isolation and on a second full run — pre-existing, unrelated to this change: neither
      `runs/engine.ts` nor `sessions/index.ts` is touched here).
      `pnpm --filter @agent-conductor/ui exec vitest run`: 832 passed across 54 files.
      First-page read time measured directly against this repository's own clone (its primary
      worktree, `git for-each-ref` plus one bounded `git log --max-count=31`): ~5-8ms combined,
      well under the "well under a second" criterion — no different in cost from `worktreeState`'s
      existing per-worktree git calls this daemon already makes on every prompt render.
