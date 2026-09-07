## 1. The unified-diff parser

- [x] 1.1 Add `parseUnifiedDiff(text: string): ParsedDiffFile[]` to `packages/render/src/diff.ts`
  (types: `DiffFileStatus`, `DiffLine`, `DiffHunk`, `ParsedDiffFile`, as `design.md` lays out), reading
  `diff --git a/… b/…` headers, `new file mode` / `deleted file mode` / `rename from` / `rename to` /
  `similarity index`, `Binary files … differ`, `@@ -o,ol +n,nl @@` hunk headers and `\ No newline at
  end of file`; verify with fixture patches covering added, deleted, renamed, binary, a file with
  several hunks, and a file with no trailing newline — one fixture per case, each asserted against its
  exact parsed shape
- [x] 1.2 Mark a file `tooLarge: true` (hunks omitted) when its own diff segment's changed-line count
  exceeds `DIFF_FILE_TOO_LARGE_LINES`; verify with a generated fixture over the threshold and one just
  under it
- [x] 1.3 Export the module from `packages/render/src/index.ts`; verify `pnpm typecheck` is green

## 2. A small per-language line tokenizer

- [x] 2.1 Add `packages/render/src/highlight.ts`: `highlightLine(text: string, lang: DiffLanguage |
  null): HighlightSpan[]` and an extension-to-language table covering this workspace's own languages —
  ts/tsx/js/jsx/mjs/cjs, json, yaml/yml, md, css, sql, sh, html — keywords, strings, comments and
  numbers per language, regex-based; verify with a fixture line per language asserting the exact span
  list, and one fixture for an unrecognised extension asserting a single unhighlighted span
- [x] 2.2 Export `languageForPath(path: string): DiffLanguage | null` alongside it; verify with a
  table-driven test over every extension in 2.1 plus one unmatched extension

## 3. The forge and the clone learn to produce a diff

- [x] 3.1 Add optional `pullRequestDiff(cwd: string, number: number): Promise<string | null>` to
  `ForgeAdapter` (`packages/plugin-sdk`); verify `pnpm typecheck` is green and no existing forge
  implementation is broken by the addition
- [x] 3.2 Implement it in `GhForge` over `gh pr diff <number>`, returning `null` on gh's "no pull
  requests found" message and throwing `OcError` on any other failure, mirroring `pullRequest`'s error
  handling; verify with a unit test feeding recorded `gh pr diff` stdout through it, and one asserting
  the not-found case returns `null` without a call to GitHub
- [x] 3.3 Add `computeCloneDiff(clonePath: string, base: string, head: string): Promise<string>` to
  `packages/core/src/pull-requests/` running `git diff --no-color <base>...<head> --` through the
  existing `git()` helper, with `DIFF_GIT_SUBCOMMANDS = ['diff'] as const` and an allowlist test in the
  style of `history.allowlist.test.ts`; verify against a scratch git repo fixture with a real commit
  either side of a branch point (no network, no `gh`)

## 4. The service: manifest, per-file read, and expand-context

- [x] 4.1 Add `diffFiles(projectId, number): Promise<PullRequestDiffFilesResult>` and
  `diffFile(projectId, number, path): Promise<PullRequestDiffFileResult>` to the existing
  `PullRequestsService` (`packages/core/src/pull-requests/index.ts`) and their response types on
  `packages/core/src/api.ts` — no new `CoreServices` member; verify existing core and server test
  suites are unaffected by the interface addition
- [x] 4.2 Implement the diff-text source order — forge `pullRequestDiff` first, then
  `computeCloneDiff` guarded by `branchExists(clonePath, headRefName)`, else `unavailable` with reason
  `no_local_branch` added to `PullRequestUnavailable` — parsing the result once with `parseUnifiedDiff`
  and caching `{ text, parsed }` under the pull request's cache entry (VS-97's `CacheEntry`, one more
  map); verify with a fake forge and a fake clone: forge success, forge absent with a local branch,
  forge absent with no local branch, and forge throwing with a local branch present
- [x] 4.3 `diffFiles` returns the manifest (`path`, `previousPath`, `status`, `additions`,
  `deletions`, `binary`, `tooLarge`) with no hunks; `diffFile` slices the same cached parse to one
  path's hunks; verify a second call for either within the cache window makes no further forge or git
  call, and that requesting a file the diff does not contain answers `available: true` with a null file
  rather than an error
- [x] 4.4 Add `readBaseContext(projectId, number, path, side, start, end): Promise<string[]>` reading
  `git show <baseRef>:<path>` once per entry (cached with the rest) and slicing the requested line
  range, returning an empty result for a range the file does not have (an added file, or a range past
  its end); verify with a fixture file at a known base sha, asserting a mid-file range, a range past
  the end, and an added file
- [x] 4.5 Subscribe the diff cache to the same three invalidating events VS-97 already subscribes to
  (`ticket.work_product`, `ticket.merged`, `ticket.status`) — it is the same cache entry, so verify this
  falls out of 4.2's map living on `CacheEntry` rather than needing its own listener, with a test that
  emitting one of the three drops a project's cached diff alongside its cached list

## 5. The endpoints

- [x] 5.1 Add `GET /projects/:id/pull-requests/:number/diff` and `GET
  /projects/:id/pull-requests/:number/diff/file?path=` to `packages/server/src/routes/projects.ts`
  beside the existing pull-request routes, read-only; verify with a server test that both answer 200
  for a fixture forge and for a fixture clone with no forge, and that a project whose pull request has
  neither answers 200 with `available: false` and reason `no_local_branch`
- [x] 5.2 Add `GET /projects/:id/pull-requests/:number/diff/file/context?path=&side=&start=&end=`
  over `readBaseContext`; verify with a server test for a mid-file range and for an added file's empty
  result

## 6. The file tree and per-file loading

- [x] 6.1 Add `usePullRequestDiffFiles(projectId, number)` and `usePullRequestDiffFile(projectId,
  number, path)` hooks, `qk.pullRequestDiffFiles` / `qk.pullRequestDiffFile` in `api/keys.ts`, their
  response types in `api/types.ts`, and the same `ticket.work_product` / `ticket.merged` /
  `ticket.status` mapping `pullRequestsRoot` already has; verify with a test over `invalidateFor`
  asserting each of the three invalidates both new keys
- [x] 6.2 Turn the "Files" list in `PullRequestsSection.tsx`'s `PullRequestDetail` into a file tree:
  each row shows path, status and counts from `usePullRequestDiffFiles`, opens that file on click, and
  can be collapsed independently; verify with a jsdom test that opening a file fetches its content
  (`usePullRequestDiffFile` becomes enabled) and collapsing does not discard the react-query cache
- [x] 6.3 Verify with a jsdom test that a pull request with several files renders no file content
  until a file is opened — the client-side half of per-file loading

## 7. Rendering a file's diff

- [x] 7.1 Render one file's hunks unified — line numbers on both sides, add/remove/context coloring,
  syntax highlighting per `languageForPath` — and side-by-side on desktop when that layout is chosen;
  verify with a jsdom test rendering a fixture file's hunks in each layout
- [x] 7.2 Persist the layout choice in `localStorage`, offered only at desktop width, defaulting to
  unified and forced to unified at phone width; verify with a test that a stored `split` choice renders
  side-by-side at desktop width and unified at phone width regardless
- [x] 7.3 Render the gap between two hunks as a collapsed control that fetches
  `usePullRequestDiffFileContext` on activation and shows the returned lines in place of the control;
  verify with a test that activating it renders the fetched lines and that a file with one hunk shows
  no such control
- [x] 7.4 Render a `binary` file as stated rather than rendered, and a `tooLarge` file with its header
  shown and no hunk content; verify with tests for both
- [x] 7.5 Verify the section still reads at a phone width with no horizontal-scroll trap — a test
  asserting no overflow-inducing classes on the diff view at the phone breakpoint, alongside the
  existing `PROJECT_SECTIONS` pinning test staying green unchanged

## 8. The merge-approval card's "Show PR" control

- [x] 8.1 Add a "Show PR" link to `DecisionCard`'s merge-approval header, alongside the existing
  external forge link, targeting the project overview at `?pr=<number>` for that ticket's project,
  shown only when `target.prNumber` is present; verify with a component test asserting the link's
  presence and `href`/route params when a pull-request work product exists, and its absence when it
  does not

## 9. Green

- [x] 9.1 Run `pnpm typecheck` (the full chained one), `pnpm lint`, `pnpm test`, and the ui suite
  separately (`pnpm --filter @agent-conductor/ui exec vitest run`), and verify all are green with no
  test calling the real GitHub API and no test launching a real coding CLI
