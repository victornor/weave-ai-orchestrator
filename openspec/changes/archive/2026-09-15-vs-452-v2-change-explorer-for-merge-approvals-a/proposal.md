# V2 change explorer for merge approvals

Tracker change for [VS-452](weave://tickets/VS-452). A `task` ticket, so this change carries tasks
only — `skip_specs: true`.

## Why

Captain, 2026-09-14: before approving a merge, they want to look through the pull request's changed
files inside Weave, explorer-style — a file tree of everything added, removed and modified with
+N/–N, and a whole-file diff view on the right, the way GitHub or VS Code show one. Today the only
place to read a pull request's diff in V2 is the project overview's **Pull requests** section, which
is buried behind a project page and only shows hunks, not the whole file.

The data is all there: `api/hooks` exposes `usePullRequest`, `usePullRequestDiffFiles`,
`usePullRequestDiffFile` and `usePullRequestDiffContext` over the core pull-requests service, and a
merge card already knows its ticket, whose `pull_request` work product carries the PR URL.

## What changes

1. **Entry point.** A `Review changes` control on every V2 `merge_approval` card — chat, Needs you
   and the ticket page all render `V2DecisionCard`, so it is one addition. The card resolves the PR
   number from the ticket's `pull_request` work product (already loaded for the Artifact link) and
   the project slug it was given; when either is missing the control is absent.
2. **A deep-linkable, read-only route** `/v2/w/$ws/p/$project/changes/$number?file=<path>`, with the
   PR title, `head → base`, the head SHA and totals in the header. A `Back` control uses the browser
   history. Nothing here approves, merges, comments or edits.
3. **File tree (left).** Paths grouped into collapsible folders, a status badge per file (`added` ·
   `removed` · `modified` · `renamed` with `old → new`), per-file and per-folder +N/–N, a filter
   box, the selected file highlighted, and up/down + enter keyboard navigation.
4. **File view (right).** Whole file by default (added, removed and unchanged context lines marked),
   a `Changes only` toggle back to hunks, and unified/split via the existing `DiffHunks` and
   `useDiffLayout`. Binary and too-large files state themselves; deleted and added files render from
   their one side.
5. **Layout.** Tree and panel side by side on desktop; on a phone the panel replaces the tree with a
   back step. V2 tokens and motion, reduced motion respected.

## Whole-file source: no new endpoint

The whole-file view is assembled on the client from data the service already serves, so no server
route is added:

- the file's hunks (`GET …/diff/file`), which carry every added and removed line plus three context
  lines each side, already numbered;
- the file's base-revision content (`GET …/diff/file/context` with `start=1` and a large `end`),
  read once for the whole file, which fills the unchanged regions between, before and after the
  hunks.

A pure function walks the base lines and the hunks, emitting context lines from the base and the
hunks' own lines in order; an added file has no base content, so its hunks (all additions) are the
whole file; a deleted file's hunks (all removals) are the whole base. A renamed file reads its base
content at `previousPath`. The existing per-hunk expand control and the `Pull requests` section are
untouched.

## Tests

- the merge card shows `Review changes` when a `pull_request` work product resolves a number, and
  hides it when there is none;
- the tree groups folders, counts and badges files, and filters;
- selecting a file loads its whole-file view, with base context between hunks;
- the changes-only and unified/split toggles switch the render;
- binary and too-large files state themselves and request no hunks;
- the route reads `?file=` and deep-links to that file;
- up/down + enter move and open the selection.

## Evidence required

Real-browser captures, dark and light, desktop and phone width: a merge card with the button; the
explorer with the tree and a modified file in whole-file view; the same file in split view; an added
file and a removed file.

## Out of scope

Commenting on lines, approving from the explorer, and non-merge decisions. The `changed only / all`
tree toggle is omitted: the manifest is the changed files, and there is no endpoint for a pull
request's unchanged tree, so `all` is not cheap. VS-445's syntax highlighting and VS-448's V1
removal are left as they are.