## Why

Captain (2026-09-07): "I think we should have a file diff / PR diff tool embedded in our PR explorer.
Similar to how GitHub shows it."

VS-97 shipped the Pull requests section with each PR joined to its ticket, spec change, checks and
queue position, and a list of changed files with their additions and deletions — but the diff itself
links out to GitHub. Reviewing therefore means leaving the app, which is the one step that matters
most when deciding a merge, and it is the surface VS-106's conversation with the PR's author hangs
off. A merge-approval card already carries the pull request's number and URL but sends the human to
the forge for it rather than into the app's own explorer.

## What Changes

- The `gh` forge learns to read a pull request's **unified diff** (`gh pr diff <number>`) as one more
  optional capability, alongside a read-only git fallback in the daemon's own clone
  (`git diff <base>...<head>`) for a pull request whose head branch is local — every worker branch
  always is, so a worker's own pull request is reviewable even with no forge or an unauthenticated
  one.
- A shared, pure unified-diff parser (`packages/render`) turns that text into per-file hunks with
  status (added, modified, deleted, renamed, binary), line numbers on both sides, and a "too large to
  render" flag for a file whose changes exceed a fixed line count — used identically whichever source
  produced the diff.
- Two read-only additions to the pull-requests endpoint: a per-PR **file manifest** (cheap: path,
  status, counts, binary/too-large) built once from the diff text, and a **per-file** read that slices
  that same parse to one file's hunks — so opening a PR does not pull its whole diff onto the wire, and
  opening one file does not either. Both share the pull requests cache's TTL and event-driven
  invalidation from VS-97.
- The PR explorer's file list becomes a file tree the reader can jump through, each file collapsible,
  loading its hunks only when opened. A file's diff renders unified on the phone, unified or
  side-by-side on desktop (remembered per device), with syntax highlighting for the languages already
  in this workspace's repositories, line numbers for both sides, and a control that expands a
  collapsed unchanged region using the base revision's own content — base and head agree there by
  definition, so the daemon's own clone always has it even when the head branch does not.
- A very large or binary file states so instead of rendering. Nothing here edits, comments, approves
  or reviews: that stays the decision card's job.
- A merge-approval card gets a **"Show PR"** control that opens the explorer at that ticket's pull
  request, shown only when the ticket has a pull-request work product — the piece VS-97 left out.

## Capabilities

### New Capabilities

- `project-overview/pull-request-diff`: what opening a pull request's diff shows, file by file — the
  tree, per-file loading, unified and side-by-side layouts, highlighting, collapsed-region expansion,
  binary/too-large handling, where the diff comes from and how it is kept current, and that it is
  read-only.

### Modified Capabilities

- `project-overview/pull-requests`: "opening a pull request" now includes its diff, and a
  merge-approval card offers a way into the explorer at that ticket's pull request.

## Impact

- `packages/plugin-sdk` — one optional method on `ForgeAdapter` (`pullRequestDiff`).
- `packages/core/src/forge/gh.ts` — `gh pr diff <number>` behind it.
- `packages/core/src/pull-requests/` — a diff-manifest and per-file read added to the existing
  `PullRequestsService` (no new `CoreServices` member), the clone-diff fallback over the existing
  `git()` helper with its own named subcommand allowlist (mirroring `history.ts`), and the base-revision
  read behind the expand-context control.
- `packages/render` — a new pure unified-diff parser and a small per-language line tokenizer, both
  golden-tested against fixture patches; no new runtime dependency.
- `packages/server/src/routes/projects.ts` — two read-only routes under
  `/projects/:id/pull-requests/:number/diff`.
- `packages/ui` — the Pull requests section's file list becomes the diff viewer; two hooks, two query
  keys reusing the existing invalidation events; `DecisionCard`'s merge-approval header gets the "Show
  PR" link.
- No database migration, no config, no write path.
