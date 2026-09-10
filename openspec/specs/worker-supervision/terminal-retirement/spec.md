# worker-supervision/terminal-retirement Specification

## Purpose
Takes a worker out of the live set the moment its ticket reaches `done` or `cancelled`, so Live
cannot keep showing a leftover “waiting for the next turn” cell on a finished ticket.

## Requirements

### Requirement: A terminal ticket takes its worker out of the live set

When a ticket reaches `done` or `cancelled`, every worker still bound to that ticket SHALL leave
live statuses (`provisioning`, `active`, `running`) in that same transition, not on a later
supervisor pass. Wakes queued for that worker SHALL be cancelled so it does not take another turn.

The worker SHALL be `retired` when its worktree can be removed (work has landed, or there is no
worktree). When the worktree is unlanded, the worker SHALL be `done` and the worktree SHALL stay
until the work lands or is discarded, matching a human cancelling that worker.

A worker that is already `retired` or `done` SHALL be left as it is. A ticket with no worker SHALL
not fail the transition.

#### Scenario: Completing a ticket takes its worker out of the live set

- **WHEN** a ticket with a live worker reaches `done`
- **THEN** that worker's status is not `provisioning`, `active`, or `running`

#### Scenario: Cancelling a ticket takes its worker out of the live set

- **WHEN** a ticket with a live worker reaches `cancelled`
- **THEN** that worker's status is not `provisioning`, `active`, or `running`

#### Scenario: An unlanded worktree is kept

- **WHEN** a ticket reaches `cancelled` and its worker's worktree has not landed
- **THEN** the worktree is still present and marked dirty, and the worker is not live

#### Scenario: An already-retired worker is left alone

- **WHEN** a ticket reaches `done` and its worker is already `retired`
- **THEN** that worker stays `retired`
