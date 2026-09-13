## Why

On the first release carrying VS-327's archive backfill, VS-338's change was archived on the daemon's
scratch branch and pushed, and then the sweep called `forge.createPullRequest`, whose `gh` arguments
included `--json url,number` — a flag `gh pr create` does not have. The PR was never opened, the
failure was recorded, but the pushed branch stayed. Because the backfill treats any existing
`ac/archive-<change>` branch as proof that "a backfill pull request … is already pending", every
later sweep skips, so the change can never be archived through the normal path and PR #282 had to be
opened by hand. Two independent defects: an invalid forge invocation, and a retry that cannot
converge after a partial failure.

## What Changes

- **The backfill's PR creation uses an invocation `gh` accepts.** `GhForge.createPullRequest` stops
  passing `--json` to `gh pr create` (which has no such flag), and derives the pull request's URL and
  number from the URL `gh pr create` prints on stdout. A response it cannot parse is still a recorded
  failure, never a silent one.
- **A pushed branch with no PR is no longer treated as a pending PR.** When the backfill branch
  already exists on the remote, the sweep looks for an open pull request whose head is that branch:
  if one exists it records it (activity, `pendingPrUrl`, event) and opens nothing; if none exists it
  opens the pull request from the already-pushed branch. Only a genuinely recorded open PR suppresses
  a second one.
- **The lookup is a new optional forge capability.** `ForgeAdapter` gains
  `pullRequestForBranch?(cwd, branch)`, implemented by `GhForge` with
  `gh pr list --head <branch> --state open --json url,number`. A forge that does not implement it
  still attempts to open the PR from the existing branch rather than skipping — the skip-forever
  path is gone either way.
- **The rest of `forge/gh.ts` is checked for the same mistake.** `gh pr view` and `gh pr list` do
  support `--json`; `gh pr merge`, `gh pr diff`, `gh auth status` do not use it. Only `pr create` is
  wrong.
- **No live GitHub, daemon or systemd is used to verify.** Tests use a fake `gh` on `PATH` that
  validates its arguments, plus a fake forge for the backfill.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `ticket-delivery/openspec-archival`: the backfill's pull-request creation records the PR it opens,
  recognises an already-open PR on an existing backfill branch instead of skipping forever, opens
  one from the pushed branch when none exists, and only ever suppresses a second PR for a PR it has
  actually found.

## Impact

- `packages/core/src/forge/gh.ts` — `createPullRequest` no longer passes `--json url,number` and
  parses the printed URL through a new exported `parsePullRequestUrl`; new
  `pullRequestForBranch(cwd, branch)`.
- `packages/plugin-sdk/src/index.ts` — the optional `ForgeAdapter.pullRequestForBranch?`.
- `packages/core/src/openspec/index.ts` — `archiveAfterMerge`'s `pr`-delivery branch: the
  exists-but-no-PR path opens/finds the PR instead of returning `skipped: 'already pending'`.
- Tests: `packages/core/src/forge/gh.test.ts` (exact create args, URL parsing, branch lookup) and
  `packages/core/src/openspec/service.test.ts` (retry convergence, existing-PR recognition).
- `openspec/specs/ticket-delivery/openspec-archival/` — the modified capability.
- No HTTP route, MCP tool, CLI command, database migration or prompt change. The change applies from
  the next archive sweep after a daemon upgrade; the already-pushed branch from the incident is the
  case the new retry path is written for.
