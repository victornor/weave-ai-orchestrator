## Why

The project overview (VS-95) reserves a History section that says the project's commit graph and its
branches will appear there, and shows nothing. The daemon already has everything needed to fill it:
each project is a real clone on disk, every worker worktree is a `git worktree` of that same clone,
so one repository holds the default branch and every live worker branch, and the `worktrees` and
`tickets` rows say which branch belongs to which ticket and which worker.

Reading that back is the missing half of "a very thorough overview of what is happening in a given
project": the board says which tickets are moving, the changelog says what landed, and neither shows
the shape of the work — which branches exist, where they diverged, what has been merged and what is
still hanging off the side. A commit graph is the one view that shows all of that at once.

## What Changes

- The project overview's History section renders a commit graph for the project's clone: the default
  branch and every branch a live worktree or an open ticket owns, drawn as lanes with branch and
  merge lines, newest first, each row carrying author, relative time, subject, its refs, and the
  ticket its branch or message names, linked to that ticket.
- A new read-only server surface under the project routes serves that history in pages: the refs it
  covers, one page of commits with their parents, and one commit's full message and changed files
  with per-file additions and deletions. It runs a fixed allowlist of read-only `git` subcommands
  against the clone and can neither mutate a repository nor reach the network.
- Selecting a commit opens its detail — full message, changed files with additions and deletions,
  and a link to the commit on the forge when the project's remote is a recognised one. Selecting a
  branch highlights its lane and names the ticket and worker it belongs to.
- The section is live off the events the board already receives, compresses its lanes on a phone and
  opens detail as a sheet there, and lays out side by side on the desktop.
- The reserved History requirement — "until a commit history is rendered, the section says one will
  appear here and shows nothing" — is withdrawn, because a commit history is now rendered. The
  reserved Pull requests section and the one section contract both stay exactly as they are.

## Capabilities

### New Capabilities

- `project-overview/commit-graph`: what the History section shows — the lanes and their branch and
  merge lines, the ref and ticket labels, selecting a commit and selecting a branch, staying live,
  and behaving on a phone and on a desktop.
- `project-overview/repository-reads`: the read-only reading of a project's repository — which refs
  are covered, how a history is paged, what a commit's detail contains, and the standing guarantee
  that this surface never writes to a repository and never touches the network.

### Modified Capabilities

- `project-overview/reserved-sections`: the requirement reserving an empty History section is
  removed; it described the state this change ends.

## Impact

- `packages/core`: a new read-only history module under `packages/core/src/projects/`, reached
  through two new methods on the existing `ProjectsService` (`api.ts`), so no member is added to
  `CoreServices`.
- `packages/server`: two new `GET` routes under `routes/projects.ts`.
- `packages/shared`: the wire types for a ref, a commit row, a page and a commit detail.
- `packages/ui`: a pure graph-layout module under `src/lib/`, the `HistorySection` body, its query
  keys and hooks, and the events that invalidate them.
- No database change, no migration, no config, no new dependency.
