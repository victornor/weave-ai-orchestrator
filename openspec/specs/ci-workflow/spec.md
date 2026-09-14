# ci-workflow Specification

## Purpose
Defines when this repository's GitHub Actions CI runs: it evaluates the head a landing will produce,
once, rather than re-checking every push to a draft, and it keeps a scheduled safety net on the
landing branch in place of a run on every push to it.

## Requirements

### Requirement: CI evaluates a pull request only once it is out of draft

The workflow SHALL trigger on the `pull_request` events `opened`, `reopened`, `synchronize` and
`ready_for_review`, and every job SHALL be skipped when `github.event.pull_request.draft` is true. A
push to a draft pull request SHALL start no run. The transition out of draft SHALL start a run on the
head that is current at that moment, and a later push to a non-draft pull request SHALL start one
too.

#### Scenario: A push to a draft pull request starts nothing

- **WHEN** a commit is pushed to a pull request that is still a draft
- **THEN** no workflow run starts for that push

#### Scenario: Marking the pull request ready starts one run

- **WHEN** a draft pull request is marked ready for review
- **THEN** one run starts, on the pull request's current head

#### Scenario: A push after the pull request is ready starts a run

- **WHEN** a commit is pushed to a pull request that is not a draft
- **THEN** one run starts, on that new head

### Requirement: The landing branch gets a scheduled safety net, not a run on every push

The workflow SHALL NOT trigger on `push` to the landing branch. It SHALL trigger on a daily
`schedule` and on manual `workflow_dispatch`, so the landing branch still gets evaluated periodically
and on demand.

#### Scenario: A merge to the landing branch starts no run

- **WHEN** a pull request is merged and the landing branch advances
- **THEN** no run is started by that push

#### Scenario: The safety net still runs

- **WHEN** the daily schedule fires, or a maintainer dispatches the workflow
- **THEN** the workflow runs against the landing branch

### Requirement: The required check names and cancellation are unchanged

The workflow's jobs SHALL keep the names the merge flow rolls up (`lint`, `typecheck`, `test-core`,
`test-ui`), and concurrent runs for the same ref SHALL still cancel the run in progress.

#### Scenario: The merge flow still finds its checks

- **WHEN** a pull request is marked ready and its required checks are read
- **THEN** the rollup names `lint`, `typecheck`, `test-core` and `test-ui`, exactly as before
