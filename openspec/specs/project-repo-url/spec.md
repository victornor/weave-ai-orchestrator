# project-repo-url Specification

## Purpose
Let an operator re-point an existing project at a different git remote while keeping its tickets, roles, knowledge and release pipeline.

## Requirements

### Requirement: Re-pointing a project's repo URL
Updating a project's `url` SHALL change the stored `gitUrl`, the config entry and the clone's `origin` (fetch and push) together, after verifying the new remote.

#### Scenario: Successful re-point
- **WHEN** a project on repo A is patched with `{ url: <repo B> }` and B is reachable and has the project's default branch
- **THEN** the row's `gitUrl` is B, the clone's `origin` is B, and a following fetch returns B's default branch

#### Scenario: Unreachable remote
- **WHEN** the new URL cannot be reached
- **THEN** the request fails with a validation error naming the URL, and the row, config and `origin` are unchanged

#### Scenario: Default branch missing
- **WHEN** the new remote lacks the project's default branch
- **THEN** the request fails with a validation error naming the branch, and nothing changes

#### Scenario: Old repo untouched
- **WHEN** a project is re-pointed
- **THEN** no write is made to the old remote

#### Scenario: Push URL follows
- **WHEN** the clone has a `remote.origin.pushurl` on repo A and the project is re-pointed to repo B
- **THEN** both the fetch and the push URL of `origin` are B

#### Scenario: Failed re-point restores both URLs
- **WHEN** the fetch from B fails after the URLs were changed
- **THEN** the fetch URL and the push URL are back to their previous values

### Requirement: Settings exposes the repo URL
Settings → Projects SHALL show the project's current URL and save a changed one via `PATCH /projects/:id`, displaying the server's error on refusal.

#### Scenario: Bad URL refused
- **WHEN** the user saves an unreachable URL
- **THEN** the server's error is shown beside the field and the stored URL is unchanged
