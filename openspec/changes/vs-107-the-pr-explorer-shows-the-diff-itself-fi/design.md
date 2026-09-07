## Context

VS-97 already answers "what pull requests does this project have, and what is each one joined to."
This change answers the next question a reviewer actually asks: "what changed, file by file." Two
constraints shape everything below:

- **Read-only, and the daemon never launches a coding CLI or touches live runtime credentials** — this
  is `gh` (already exec'd throughout `packages/core/src/forge`) and `git` (already exec'd throughout
  `packages/core/src/util/git.ts` and `projects/history.ts`), neither of which the credential rule
  covers.
- **A worker's own pull request must be reviewable with no forge at all**, because a project can be
  used entirely without `gh` — its branches still live in the project's own clone, the same clone every
  worker worktree is created from (`worktrees/git.ts`; `history.ts` already relies on this).

## Where the diff text comes from

One pull request, one plain-text unified diff, from one of two sources, tried in order:

1. **Forge**: `ForgeAdapter.pullRequestDiff(cwd, number)` — implemented in `GhForge` as `gh pr diff
   <number>`, which prints the same unified-diff format `git diff` would. `unsupported` when the forge
   lacks the method, the same shape `listPullRequests`/`pullRequest` already use.
2. **Clone fallback**: `git diff --no-color <base>...<head> --` in `project.clonePath`, where `head` is
   the pull request's `headRefName` and `base` is its `baseRefName`, resolved with the same
   `resolveBaseRef`/`branchExists` helpers `util/git.ts` already exports. This only ever runs when
   `branchExists(clonePath, headRefName)` — true for every worker branch, false for an external
   contributor's fork branch we never fetched. When it is false and the forge also failed, the PR's
   diff is `unavailable` with reason `no_local_branch`, one more member of the existing
   `PullRequestUnavailable` union.

Both sources produce the *same text format*, so exactly one parser handles both. There is no
`DiffService`; two methods (`diffFiles`, `diffFile`) join `PullRequestsService`, because a second
`CoreServices` member would mean extending both test harnesses' unstubbed-throw proxies for a service
that shares its cache, its cache-invalidation events and its `unavailable()` reasoning with the one
that already exists (`packages/core/src/pull-requests/index.ts`).

## Caching and the two endpoints

The existing per-project `CacheEntry` (`pull-requests/index.ts`) grows one more map:
`diffs: Map<number, { text: string; parsed: ParsedDiffFile[] } | { unavailable: PullRequestUnavailable }>`,
filled lazily the first time either diff method is asked for that PR number, cleared exactly when the
rest of the entry is (the same `PR_CACHE_TTL_MS` window, the same three invalidating ticket events).
Fetching and parsing the whole PR's diff once and slicing it in memory is what makes both endpoints
cheap:

- `GET /projects/:id/pull-requests/:number/diff` — the **manifest**: `{ available, reason, message,
  stale, files: DiffFileSummary[] }`, `DiffFileSummary = { path, previousPath, status, additions,
  deletions, binary, tooLarge }`. Cheap because it never sends a hunk.
- `GET /projects/:id/pull-requests/:number/diff/file?path=<path>` — one file's hunks: `{ available,
  reason, message, file: (DiffFileSummary & { hunks: DiffHunk[] }) | null }`. `hunks` is `[]` when
  `binary` or `tooLarge`.

This is what "large diffs load per file rather than all at once" means at the wire level: the client
never receives a byte of hunk content for a file it has not opened, whatever the daemon did internally
to answer the manifest request.

`tooLarge` is decided per file while parsing, from the changed-line count in that file's own diff
segment (`DIFF_FILE_TOO_LARGE_LINES`, picked generously enough that nothing in this repository's own
history trips it, and revisited if that assumption turns out wrong) — the same "state it, don't render
it" rule a binary file already gets from the `Binary files a/… and b/… differ` line.

## The parser (`packages/render/src/diff.ts`)

Pure, no I/O, golden-tested — the same shape as `render/src/decision.ts` or `render/src/transcript.ts`.

```ts
export type DiffFileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'binary';
export interface DiffLine { kind: 'context' | 'add' | 'remove'; oldLine: number | null; newLine: number | null; text: string }
export interface DiffHunk { oldStart: number; oldLines: number; newStart: number; newLines: number; header: string; lines: DiffLine[] }
export interface ParsedDiffFile {
  path: string; previousPath: string | null; status: DiffFileStatus;
  binary: boolean; noNewlineAtEnd: boolean; additions: number; deletions: number;
  hunks: DiffHunk[]; tooLarge: boolean;
}
export function parseUnifiedDiff(text: string): ParsedDiffFile[]
```

It reads `diff --git a/… b/…` file headers, `new file mode` / `deleted file mode` / `rename from` /
`rename to` / `similarity index` for status, `Binary files … differ` for `binary`, `@@ -o,ol +n,nl @@`
hunk headers, and `\ No newline at end of file`. Fixtures cover added, deleted, renamed, binary, a file
with several hunks, and a file with no trailing newline — the exact list VS-107's acceptance criteria
name, so the fixtures *are* the acceptance test.

## Highlighting: no new dependency

This repository hand-rolls its markdown renderer (`packages/ui/src/lib/markdown.ts`) rather than take a
dependency for a deliberately bounded subset of syntax. The diff viewer follows the same rule: a small
line tokenizer (`packages/render/src/highlight.ts`) covering the languages this workspace's own
repositories actually contain — TS/TSX/JS/JSX, JSON, YAML, Markdown, CSS, SQL, shell, HTML — keyed off
file extension, regex-based (keywords, strings, comments, numbers), applied per line so it composes
trivially with the add/remove/context coloring the diff already needs. A file whose extension is not
in the table renders unhighlighted, which is correct, not degraded: acceptance criterion 1 asks for
highlighting "for the languages in this workspace's repositories at minimum," not for every language
anyone might push. Revisit with a real grammar library (Shiki, at real cost to bundle size and
highlight accuracy) only if a workspace's repositories outgrow this list — an ADR, not a silent
decision, if it happens.

## Expanding a collapsed region

A unified diff already omits everything more than a few lines from a change; "expand" needs the
omitted lines' actual content. The insight that keeps this cheap: **an unchanged region is unchanged
precisely because base and head agree there**, so its content can always be read from the *base*
revision — which is always in the project's own clone, even for a pull request whose head branch is
not (a fork we never fetched, reviewed via the forge diff). No new endpoint class: `GET
/projects/:id/pull-requests/:number/diff/file/context?path=&start=&end=` reads `git show
<baseRef>:<path>` once (cached alongside the rest of the entry) and returns the requested line range.

Caveat, stated rather than hidden: if the project's local base branch has moved past the exact commit
the pull request was diffed against, an expanded region reflects the base branch's current content,
not the commit the diff was actually taken from. For this workspace's own pull requests — reviewed
close to when they are opened, against a base that a worker's own branch was cut from recently — that
is not a real-world problem; it is written down here so it is a known limitation rather than a silent
one. An expand request for a file with no base-side content (an added file) is refused with an empty
result rather than an error: there is nothing to expand into.

## Endpoint placement

Both new routes are literal suffixes of an already-parameterized path
(`/pull-requests/:number/diff…`), so the Hono route-ordering trap that bit `GET /runs/traces` (VS-74)
does not apply here: there is no sibling literal route at the same segment for `:number` to shadow.

## UI

The Pull requests section's existing file list (`PullRequestsSection.tsx`, the plain path/+/− rows
under "Files") becomes the entry point into the tree: each row opens that file's diff in place, with a
collapse control, rather than being a dead list. `usePullRequestDiffFiles(projectId, number)` reads the
manifest; `usePullRequestDiffFile(projectId, number, path)` is enabled only once a row is expanded, so
a file nobody opens is never fetched — the client-side half of "load per file."

Layout choice (`unified` | `split`) is a `localStorage` value the same way other per-device UI choices
already are (push preferences in `Settings.tsx`), read once and offered only at desktop width; the
phone width is always unified, per acceptance criterion 1. Neither choice, nor opening or collapsing a
file, changes the overview's URL — only which pull request is open does, exactly as VS-97 left it.

## What stays exactly as VS-97 built it

The PR list, the ticket/spec/queue joins, the availability reasons, the cache TTL and its invalidating
events, the description and checks panel, and the "no editing, no comments, no approving" rule are
unchanged. This change is additive to what opening a pull request shows.
