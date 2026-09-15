# web-v2/navigation — delta

## ADDED Requirements

### Requirement: A retired address redirects to the destination that replaced it

The app SHALL resolve an address from a previous URL scheme to the destination that replaced it,
rather than to a not-found page, keeping the address's query values. The retired addresses and their
destinations SHALL be:

| Retired address | Destination |
|---|---|
| `/v2/*` | the same path without the `/v2` prefix |
| `/w/$ws/board` | `/w/$ws/work` |
| `/w/$ws/merge-queue?project=X` | `/w/$ws/work?project=X` |
| `/w/$ws/team` | `/w/$ws/roles` |
| `/w/$ws/live` | `/live?ws=$ws` |
| `/w/$ws/runs` | `/runs?ws=$ws` |
| `/w/$ws/runs/$runId` | `/runs/$runId` |
| `/w/$ws/settings` | `/settings?scope=$ws` |

An address whose shape already matches its destination SHALL load directly rather than redirect.
`/` SHALL resolve as the app root does (the remembered workspace's Needs you, else onboarding or
sign-in). The redirect SHALL apply both to an address typed into the address bar and to a hard
reload, and SHALL NOT be served as a page of its own.

#### Scenario: An interim prefixed address

- **WHEN** `/v2/w/acme/work` is opened
- **THEN** the app lands on `/w/acme/work`

#### Scenario: A prefixed address with a query

- **WHEN** `/v2/runs?ws=acme` is opened
- **THEN** the app lands on `/runs?ws=acme`

#### Scenario: Board to Work

- **WHEN** `/w/acme/board` is opened
- **THEN** the app lands on `/w/acme/work`

#### Scenario: Merge queue to Work, keeping the project

- **WHEN** `/w/acme/merge-queue?project=proj1` is opened
- **THEN** the app lands on `/w/acme/work?project=proj1`

#### Scenario: Team to Roles

- **WHEN** `/w/acme/team` is opened
- **THEN** the app lands on `/w/acme/roles` with Acme's Roles page shown

#### Scenario: A workspace's Live to the global Live, scoped

- **WHEN** `/w/acme/live` is opened
- **THEN** the app lands on `/live?ws=acme` with Acme's scope applied

#### Scenario: A workspace's Runs to the global Runs, scoped

- **WHEN** `/w/acme/runs` is opened
- **THEN** the app lands on `/runs?ws=acme`

#### Scenario: A run detail drops the workspace segment

- **WHEN** `/w/acme/runs/run_1` is opened
- **THEN** the app lands on `/runs/run_1`

#### Scenario: A workspace's settings to the global settings, scoped

- **WHEN** `/w/acme/settings` is opened
- **THEN** the app lands on `/settings?scope=acme`

#### Scenario: A shape that already matches loads directly

- **WHEN** `/w/acme/tickets/VS-1` is opened
- **THEN** the ticket page renders without a redirect through another address

#### Scenario: A hard reload

- **WHEN** a retired address is opened directly (a fresh document load, not an in-app navigation)
- **THEN** the app lands on the destination address
