## ADDED Requirements

### Requirement: A project's repository is read, never written or fetched

The surface that serves a project's history SHALL only read the project's repository. It SHALL NOT
create, move or delete a ref, a commit, an object, a worktree, a stash or a configuration value, and
SHALL NOT contact a remote — no fetch, no pull, no clone, no ref advertisement.

Only a fixed, closed set of read-only repository operations SHALL be reachable from it, and what a
request supplies SHALL NOT be able to widen that set: a caller SHALL NOT be able to name an
operation, an option, or a ref, and a caller-supplied commit identifier SHALL be rejected unless it
is a plain abbreviated or full object name.

A repository operation that fails or exceeds its time limit SHALL be reported as a failure of the
read, and SHALL NOT leave the repository changed.

#### Scenario: Only read-only operations exist

- **WHEN** the set of repository operations this surface can perform is enumerated
- **THEN** every one of them only reads, and none of them writes to the repository or reaches a
  remote

#### Scenario: A caller cannot name an operation

- **WHEN** a request carries a value where a repository operation, option or ref could be expected
- **THEN** it is treated as data, and the operation performed is one of the fixed read-only set

#### Scenario: A commit identifier that is not one

- **WHEN** a commit is requested by something that is not a plain object name
- **THEN** the request is refused and no repository operation is performed

#### Scenario: The repository is not there

- **WHEN** a project's clone is missing, is not a repository, or has no commits
- **THEN** the read reports that plainly and nothing is created to make it succeed

### Requirement: The history covers the default branch and the project's working branches

A project's history SHALL be read across its default branch together with every branch that a live
worktree of that project holds and every branch recorded for a ticket of that project that has not
finished, so that work in progress is visible beside what has landed. A branch that no longer exists
in the repository SHALL be left out rather than reported as empty.

Each covered ref SHALL be reported with its name, the commit it points at, whether it is the default
branch, and — where one is known — the ticket it belongs to and the worker that holds it.

#### Scenario: A worker's branch is covered

- **WHEN** a worker holds a worktree on a branch of the project
- **THEN** that branch is among the refs the history covers, named with its ticket and its worker

#### Scenario: A branch that was deleted

- **WHEN** a ticket records a branch that no longer exists in the repository
- **THEN** that branch is not reported and the rest of the history is unaffected

#### Scenario: Only the default branch

- **WHEN** a project has no live worktree and no unfinished ticket with a branch
- **THEN** the history covers the default branch alone

### Requirement: A history is served in pages, newest first

A history SHALL be served a page at a time, newest commit first, each page bounded to a caller-set
size within a fixed maximum and defaulting to a size a client can render immediately.

Each commit in a page SHALL carry its object name, its parents' object names in order, its author's
name, when it was authored, its subject, and the refs that point at it. Parents SHALL be reported
whether or not the parent is itself in the page, so that the reader can draw the connection.

A page SHALL carry a way to ask for the page after it, and SHALL say when there is none. Paging
SHALL be against the set of ref tips resolved for the first page, so that a branch moving while the
reader pages does not silently drop or duplicate a commit.

#### Scenario: The first page

- **WHEN** a project's history is requested without a position
- **THEN** the newest commits across the covered refs are returned, newest first, with their parents
  and their refs

#### Scenario: Paging on

- **WHEN** the position a page reports is used to ask for the next one
- **THEN** the commits that follow it are returned, and no commit of the previous page is repeated

#### Scenario: A branch moves mid-page

- **WHEN** a new commit is pushed onto a covered branch between one page and the next
- **THEN** the next page continues from the same tips the first page was read against

#### Scenario: The end

- **WHEN** the last commit reachable from the covered refs has been served
- **THEN** the page says there is no page after it

### Requirement: One commit's detail is served on request

A single commit of a project SHALL be readable on its own, carrying its full message, its author and
committer with when each acted, its parents, and every file it changed with that file's added and
removed line counts and whether it was added, modified, deleted or renamed.

A merge commit's changed files SHALL be reported against its first parent, so that a merge does not
report the whole side branch as its own change.

No file content and no patch text SHALL be served.

#### Scenario: A commit's files

- **WHEN** one commit is requested
- **THEN** its full message and each changed file with its added and removed line counts are
  returned

#### Scenario: A merge commit

- **WHEN** the commit requested is a merge
- **THEN** its changed files are those against its first parent

#### Scenario: No patch is served

- **WHEN** a commit's detail is returned
- **THEN** it contains no file content and no patch text

#### Scenario: An unknown commit

- **WHEN** a commit that the repository does not contain is requested
- **THEN** the request is answered as not found
