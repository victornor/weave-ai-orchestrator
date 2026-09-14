## Why

CI costs ~$14/day on GitHub-hosted runners: 2,342 billed minutes in 24h, ~41 per merged PR. The same
head is evaluated up to four times — on every worker push, again after every merge-queue rebase, and
again on `main` after the merge — though the merge queue lands exactly the head that was just checked.
Captain chose to cut that to one run per landing (plus a self-hosted runner, a separate ticket).

See [VS-393](weave://tickets/VS-393).

## What Changes

- **A ticket's pull request is opened as a draft, by the daemon, through the forge adapter.** A new
  worker tool (`weave_ticket_open_pull_request`) opens the PR for the branch the worker pushed, as a
  draft, against the ticket's effective landing branch. It is idempotent per branch, refuses a
  project that is not on `pr` delivery or has no forge that can open PRs, and records the
  `pull_request` work product itself. The worker's delivery skill stops running `gh pr create`.
- **The forge gains `draft` on create and a `markReady` step.** `ForgeAdapter.createPullRequest` takes
  `draft?: boolean`; a new optional `markPullRequestReady` brings a draft out of draft. A draft is
  passed only for pull requests the daemon itself lands: a ticket's own PR through the new tool, and
  OpenSpec archive backfill (VS-389). The pull requests the daemon opens for a human to merge on
  GitHub — the knowledge-repo switch and knowledge delivery (VS-359) — stay non-draft, so captain
  needs no manual "mark ready" step.
- **The merge step marks the ticket's PR ready before it reads required checks.** Once the ticket is
  admitted to the merge queue and its branch is rebased/archived/pushed, the daemon marks the PR ready
  for review (a no-op on an already-ready PR), and then evaluates the checks — so a rebase push to a
  draft PR starts no run, the transition to ready starts exactly one on the head that will land, and
  an absent rollup immediately after that transition is treated as checks still to come, never as
  passed.
- **`ci.yml` stops running on push and on draft PRs.** It runs for `pull_request` `opened`,
  `reopened`, `synchronize` and `ready_for_review`, with every job guarded on
  `github.event.pull_request.draft == false`; the `push: branches: [main]` trigger is removed and
  replaced by a daily `schedule` run plus `workflow_dispatch` as the safety net. The four required
  check names (`lint`, `typecheck`, `test-core`, `test-ui`) and `cancel-in-progress` are unchanged.
- **Docs.** `docs/PLAN.md` §11.4 and the worker delivery skill describe the tool and when CI runs.

**BREAKING:** none to the daemon's public HTTP API. The worker delivery procedure changes (workers no
longer run `gh pr create`); the `weave_ticket_open_pull_request` tool is new.

## Capabilities

### New Capabilities

- `ticket-delivery/pull-request`: how a ticket's pull request is opened through the daemon as a draft,
  idempotently per branch and only for `pr`-delivery projects with a forge adapter, and that the
  daemon records the work product.
- `ci-workflow`: when this repository's GitHub Actions workflow runs — non-draft pull requests only,
  no push-to-main run, a scheduled/dispatch safety net, and the check names the merge flow rolls up.

### Modified Capabilities

- `ticket-delivery/archive-before-merge`: the landing sequence marks the ticket's draft pull request
  ready before it reads required checks, and never reads an absent rollup on a just-ready PR as a
  pass.

## Impact

- `packages/plugin-sdk/src/index.ts` — `ForgeAdapter.createPullRequest` gains `draft?`, and a new
  optional `markPullRequestReady`.
- `packages/core/src/forge/gh.ts` — `--draft` on `gh pr create`, a new `gh pr ready` path, and
  `isDraft` exposure needed by the landing decision; `gh.test.ts` extended.
- `packages/core/src/tickets/archive-before-merge.ts` — mark the PR ready before reading checks;
  treat a just-ready absent rollup as pending.
- A new ticket-delivery service method and its tests (fake forge), plus the archive-backfill call site
  (`packages/core/src/openspec/index.ts`) opening a draft; the human-merged knowledge sites
  (`packages/core/src/knowledge/repoSwitch.ts`, `repoDelivery.ts`) stay non-draft.
- `packages/server/src/tools.ts`, `packages/shared/src/tools.ts` — the new worker tool and its
  registration.
- `skills/weave-ai-worker/references/delivery.md`, `docs/PLAN.md` — the delivery procedure.
- `.github/workflows/ci.yml` — the trigger set.
