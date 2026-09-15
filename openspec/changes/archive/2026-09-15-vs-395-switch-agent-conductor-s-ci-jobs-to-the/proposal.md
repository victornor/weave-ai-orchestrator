# Run CI on the self-hosted runner

Tracker change for [VS-395](weave://tickets/VS-395). A `task` ticket, so this change carries tasks
only — `skip_specs: true`.

## Why

GitHub-hosted CI cost about **$14/day** (2,342 billed minutes in 24h, ~41 per merged PR). Captain
chose a self-hosted runner (VS-394) plus trimmed runs (VS-393). VS-393 has landed: CI now runs only
for non-draft PRs plus the daily `schedule` and `workflow_dispatch`, and workers open draft PRs.
VS-394 has stood up `weave-ci-01` — a containerised, resource-capped GitHub Actions runner on
captain's host, registered for the `victornor/agent-conductor` repository only, labelled
`self-hosted, linux, x64, weave-ci` and probe-verified green (run `34921614290`). The last step is
to point `ci.yml` at it.

## What changes

- `.github/workflows/ci.yml`: every job's `runs-on` becomes
  `[self-hosted, linux, x64, weave-ci]` — `lint`, `typecheck`, `test-core`, `test-core-shards`
  (added by VS-392 after this ticket was written) and `test-ui`.
- Job names, steps, timeouts, triggers and the draft guard are unchanged, so the four required
  checks (`lint`, `typecheck`, `test-core`, `test-ui`) and the merge flow's rollup still match.
- `docs/PLAN.md` §11.4 notes that CI runs on the self-hosted runner and where its status, logs and
  removal commands live.

## Out of scope

- Runner registration, repository settings, secrets, firewall rules (VS-394).
- CI triggers and the draft-PR behaviour (VS-393).
