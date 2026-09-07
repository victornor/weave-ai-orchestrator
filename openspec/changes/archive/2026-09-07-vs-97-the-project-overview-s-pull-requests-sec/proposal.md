## Why

The project overview reserves a "Pull requests" section that says what will be there and shows
nothing (VS-95). Everything the section needs to be true already exists but nowhere joins it up:
the forge knows the pull requests, the ticket knows which pull request is its work product, the
ticket knows which OpenSpec change it implements, and the merge queue knows what is landing. Today
answering "what is in flight on this project, and which of it is mine to look at" means the GitHub
web UI, the board and the specs page in three tabs, with nothing linking them.

## What Changes

- The `gh` forge learns to **list** a repository's pull requests and to **read one** — number,
  title, author, branch, state, checks, review decision, body, and the changed files with their
  additions and deletions. Both are optional capabilities on the forge adapter, so a forge that
  cannot do either is a forge that reports nothing rather than one that breaks.
- A new read-only server endpoint serves a project's pull requests, **joined** to the ticket whose
  work product records that pull request, to that ticket's OpenSpec change, and to the project's
  merge queue. A second endpoint serves one pull request with its body, its checks and its file
  list.
- Forge answers are **cached for a few minutes** per project, and the cache entry for a project is
  dropped when a ticket's work product or merge state changes, so the page is current without
  polling the GitHub API on every render.
- The overview's Pull requests section renders that list — open first, then merged and closed
  within the last 30 days — with the ticket and the spec change as links, and opens one pull
  request in place, addressed by the page's URL so it can be linked to. Where the ticket has a plan
  document, the plan is one click away.
- A project with **no forge** — no remote, no `gh`, or `gh` not authenticated — gets a plain
  statement that pull requests are not available for it, not an error and not a retry.

## Capabilities

### New Capabilities

- `project-overview/pull-requests`: what the overview's Pull requests section lists, what each entry
  is joined to, what opening one shows, how forge data is refreshed and cached, and what a project
  without a forge sees.

### Modified Capabilities

- `project-overview/reserved-sections`: the requirement that the Pull requests section is reserved
  and empty is removed — the section now has content, which `project-overview/pull-requests`
  specifies. The section contract and the reserved History section are unchanged.

## Impact

- `packages/plugin-sdk` — two optional methods on `ForgeAdapter`.
- `packages/core/src/forge/gh.ts` — `gh pr list` and `gh pr view` behind them.
- `packages/core` — a new `PullRequestsService` (cache, forge call, ticket/spec/queue join) added to
  `CoreServices`, which both test harnesses must then supply.
- `packages/server/src/routes/projects.ts` — `GET /projects/:id/pull-requests` and
  `GET /projects/:id/pull-requests/:number`.
- `packages/ui` — `PullRequestsSection`, two hooks, one query key and its event mapping.
- No database migration, no config, no write path. Nothing an agent does changes.
