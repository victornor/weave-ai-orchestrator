## MODIFIED Requirements

### Requirement: The merging worker is told it holds the queue

The wake that admits a ticket to the active merge step SHALL tell the worker that it now holds the
project's merge slot and that its base may have moved while it waited, so that the worker syncs its
branch with that ticket's effective landing branch — its own declared landing branch, or otherwise its
project's — resolves conflicts, and re-runs the project's checks before requesting landing.

The worker SHALL prepare its branch — synced, conflict-free, checks passing, pushed — and then request
landing rather than merge the pull request itself. The daemon performs the archive (for a ticket
carrying an OpenSpec change) and the merge as one sequence once the request is made, itself bringing the
branch up to date first when it is merely behind rather than rejecting on staleness alone. A request the
daemon rejects — because the branch has a real conflict the daemon's own rebase could not resolve,
because archiving failed, or because a required check failed on the archived branch — SHALL be treated
by the worker the same way it already treats a rebase conflict: re-sync (or resolve the flagged issue)
and request again.

#### Scenario: The merge turn names the queue

- **WHEN** a worker is woken because its ticket reached the front of the merge queue
- **THEN** its turn states that the ticket holds the project's merge slot and that its effective
  landing branch must be re-synced before requesting landing

#### Scenario: A ticket's own override is named, not its project's landing branch

- **WHEN** a worker is woken because a ticket that declares its own landing branch, overriding its
  project's, reached the front of the merge queue
- **THEN** its turn states that the ticket's own declared landing branch must be re-synced before
  requesting landing

#### Scenario: The worker requests landing instead of merging the pull request itself

- **WHEN** a worker's branch is synced, conflict-free and passing checks
- **THEN** the worker pushes the branch and requests landing, and does not itself merge the pull
  request

#### Scenario: A rejected request is retried like a rebase conflict

- **WHEN** the daemon rejects a worker's landing request because its branch has a real conflict, its
  archive failed, or a required check failed on the archived branch
- **THEN** the worker re-syncs its branch, or resolves the flagged failure, and requests landing again

#### Scenario: Mere staleness never reaches the worker

- **WHEN** a worker requests landing for a branch that is behind the current landing tip but rebases
  onto it with no conflict
- **THEN** the daemon lands the ticket without rejecting the request or waking the worker again
