## ADDED Requirements

### Requirement: A turn cut off by daemon shutdown is interrupted whatever its exit says, and resumes on its own

While the daemon is shutting down, or draining for a restart — a plain `SIGTERM` stop, `POST /api/daemon/drain`, or a deferred upgrade whose wait for idle expired and whose restart stops the daemon — it SHALL record that fact before any child process can be terminated, and every turn still active at that moment SHALL be finalized as `interrupted` regardless of the child's exit code or of any error the runtime attached to its result. A turn that had already succeeded SHALL keep its success.

The interrupted turn's worker SHALL be left able to run again and its wakes SHALL be left to start again rather than being marked failed, so that the next daemon's dispatcher resumes the turn with no human approval. A wake a human cancelled, or a failure that happened without a shutdown, SHALL keep its existing behavior and raise no resume.

#### Scenario: A runtime reports an error on a SIGTERM exit during shutdown

- **WHEN** the daemon is shutting down and a turn's runtime returns a non-zero exit with an error attached, as the claude adapter does for exit 143
- **THEN** the turn is recorded `interrupted`, not `failed`

#### Scenario: A runtime exits 1 as its process group is stopped

- **WHEN** the daemon is shutting down and a turn's runtime returns exit 1, as the opencode adapter does when its parent is terminated
- **THEN** the turn is recorded `interrupted`, not `failed`

#### Scenario: An interrupted turn resumes without a human

- **WHEN** a turn is recorded `interrupted` because of a shutdown
- **THEN** its wake is left queued and its worker active, and the next daemon starts the turn again without a retry approval

#### Scenario: A deferred upgrade's restart covers the runs its wait left executing

- **WHEN** a deferred upgrade's wait for idle expires with turns still running and its restart stops the daemon
- **THEN** each of those turns is recorded `interrupted` and left queued to resume, not `failed`, whichever runtime it used

#### Scenario: A genuine failure outside shutdown is unchanged

- **WHEN** a turn fails while the daemon is neither shutting down nor draining
- **THEN** it is classified exactly as before, with no resume

#### Scenario: A drain that is undone resumes rather than strands

- **WHEN** `POST /api/daemon/drain` cancels a turn and the restart never happens, so dispatch is resumed
- **THEN** the cancelled turn becomes eligible to run again on the ordinary dispatcher cadence
