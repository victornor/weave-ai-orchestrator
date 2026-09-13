## Context

See `proposal.md` — Why. Two facts shape the approach.

`GhForge.createPullRequest` (`packages/core/src/forge/gh.ts`, VS-327) is the only caller of `gh pr
create` in the daemon and the only forge method the OpenSpec backfill uses to open a PR. Its current
argument list ends `'--json', 'url,number'`; `gh pr create` has no `--json` flag, so the command
fails on every host before GitHub is even contacted. The rest of the file uses `--json` only on `gh
pr view` and `gh pr list`, both of which support it.

`OpenSpecService.archiveAfterMerge`'s `pr`-delivery path (`packages/core/src/openspec/index.ts`)
checks `git ls-remote --exit-code --heads origin ac/archive-<change>` and, when the branch exists,
returns `skipped: 'already pending'`. That is the only branch-existence check between "push" and
"open the PR", so an exception thrown by `createPullRequest` after the push leaves a branch that
makes every later sweep skip. `serialize` (the project land lock) means only one sweep per project
runs at a time, so the lookup and the open do not race each other.

## Goals / Non-Goals

**Goals:**

- `gh pr create` succeeds on a real host: valid arguments, and the PR's URL and number obtained from
  what `gh` prints.
- A sweep that finds an existing backfill branch converges: it records an open PR on the branch, or
  opens one from the pushed branch, instead of skipping.
- The behavior is testable with a fake `gh` that validates arguments and a fake forge, with no live
  GitHub, daemon or systemd.

**Non-Goals:**

- Changing the merge-time archive (`tickets.mergeDone` / `archive-before-merge`) or `local-branch`
  delivery's direct-commit backfill: neither is implicated.
- Retrying forever within one sweep, or scheduling the next sweep differently — the reconciliation
  sweep that already calls `archiveAfterMerge` is what retries.
- Adding a new spec capability for the forge adapters; the observable behavior lives in
  `ticket-delivery/openspec-archival`.

## Decisions

**1. Parse the PR URL `gh pr create` prints; do not request JSON from it.** `gh pr create` prints
the new pull request's URL on stdout and supports no `--json`. A new exported pure function
`parsePullRequestUrl(text)` matches the first `.../pull/<number>` URL in the output and returns
`{ url, number }`, or `null`. `createPullRequest` throws the existing `OcError('internal', 'gh pr
create failed: …')` on a non-zero exit and a new recorded error when no URL can be parsed.
*Alternative:* follow up with `gh pr view <branch> --json url,number` after create — rejected: an
extra round trip, and the two calls can disagree if something else touches the branch in between;
the printed URL is already the answer. *Alternative:* keep `--json` and switch to the REST API —
rejected: more surface, credentials and auth handling for no gain.

**2. Find an existing PR with a new optional `ForgeAdapter.pullRequestForBranch?`, implemented by
`gh pr list --head <branch> --state open --json url,number`.** `pr list` supports `--json` and
returns `[]` when there is none, so no error-string matching is needed. *Alternative:* reuse
`listPullRequests` and filter by `headRefName` — rejected: it returns a repo-wide, most-recent-first
window (default 60) that need not contain the backfill branch, and fetches aggregate fields the
caller does not need. *Alternative:* `gh pr view <branch> --json …` and treat "no pull requests
found" as absence — rejected: absence is reported as a non-zero exit, so the code would parse error
text rather than data.

The method is optional, like `createPullRequest`. A forge that omits it makes the sweep fall through
to attempting `createPullRequest` from the existing branch, so no forge can resurrect the
skip-forever behavior.

**3. The convergence lives in `archiveAfterMerge`, keyed on branch existence, not on a new state
column.** The algorithm for the `pr`-delivery path becomes:

1. Resolve the forge first (so both the lookup and the open can use it).
2. If the branch exists on the remote: look up an open PR on it. Found → record it (activity,
   `openspecArchivePendingPrUrl` event) and return `{ archivedAs: null, skipped: null, pendingPrUrl
   }`. Not found → open the PR from the branch via `createPullRequest`, record it, return the same
   shape. Either way, never `skipped`.
3. If the branch does not exist: archive on the scratch branch, commit, push, open the PR on the
   scratch path — the current flow, unchanged.

Recording reuses the exact activity action (`openspec.archive_pr_opened`), event
(`openspecArchivePendingPrUrl`) and return shape the fresh path already produces, so the weaver and
the ticket see no new state to learn.

*Alternative:* delete the pushed branch when the PR cannot be opened, so the next sweep re-archives
from scratch — rejected: it discards a correct archive commit and reruns `openspec archive`, and a
delete that itself fails reintroduces the same trap; recognising and reusing the branch is the
cheaper, converging choice. *Alternative:* record a separate "branch pushed, no PR" marker and check
it — rejected: another migration and another state to keep true, for information the remote already
holds.

**4. No behavior change for a forge that is genuinely absent.** If no forge can create a pull
request at all, the existing `OcError` ("no forge available that can open a backfill pull request")
still fires; the branch may exist or not, and the failure is recorded. The change only removes the
silent skip.

## Risks / Trade-offs

- **A merged or closed PR on the backfill branch is invisible to `--state open`, so the sweep might
  try to open a second PR.** → The change is only considered while the unarchived change still exists
  in the primary clone, and each sweep fast-forwards the clone first; if the backfill PR already
  merged, the archived change is no longer present and the sweep returns "change directory not
  present" before this code runs. If it somehow runs, `gh pr create` returns "already exists" and
  that is recorded, not silent.
- **`parsePullRequestUrl` takes the first URL in mixed output.** → `gh pr create` prints exactly the
  one URL; the parser is a pure function with its own tests, and an unparseable result is a recorded
  failure.
- **The new forge method is another optional capability a forge can forget.** → It is additive and
  optional; the fallback path still opens the PR from the existing branch, so the only cost of
  omitting it is an extra `createPullRequest` call that either succeeds or is recorded.

## Migration Plan

No database migration. The change ships in the daemon and applies from the next archive sweep after
an upgrade. The branch the incident already pushed (`ac/archive-vs-338-…`) and its hand-opened PR
#282 are exactly the shape scenario "A retry with an already-open pull request records it and opens
nothing" covers: the next sweep finds the open PR and records it. Rollback is a plain revert; no
stored state depends on the new code.

## Open Questions

None.
