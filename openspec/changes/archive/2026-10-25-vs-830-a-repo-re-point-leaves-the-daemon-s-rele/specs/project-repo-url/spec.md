## MODIFIED Requirements

### Requirement: Re-pointing a project's repo URL
Updating a project's `url` SHALL change the stored `gitUrl`, the config entry and the clone's `origin` (fetch and push) together, after verifying the new remote.

The update's answer SHALL report whether the daemon's release source still names the project's previous URL and what the new URL is, so a caller can offer to move it. Reporting it SHALL NOT change the release source.

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

#### Scenario: The daemon's release source named the old URL
- **WHEN** a project is re-pointed from A to B and the daemon's release source is A
- **THEN** the update reports that the release source still names A and that the new URL is B, and the configured release source is still A

#### Scenario: The daemon's release source is independent
- **WHEN** a project is re-pointed from A to B and the daemon's release source is not A
- **THEN** the update does not report the release source as left behind

### Requirement: Settings exposes the repo URL
Settings → Projects SHALL show the project's current URL and save a changed one via `PATCH /projects/:id`, displaying the server's error on refusal.

When a saved re-point reports that the daemon's release source still names the previous URL, Settings SHALL offer to change the release source to the new URL, and SHALL NOT change it unless that offer is taken.

#### Scenario: Bad URL refused
- **WHEN** the user saves an unreachable URL
- **THEN** the server's error is shown beside the field and the stored URL is unchanged

#### Scenario: The re-point leaves the release source behind the project's URL
- **WHEN** the user saves a new URL and the daemon's release source named the previous one
- **THEN** Settings shows that the release source still names the previous URL and offers to move it to the new one

#### Scenario: Taking the offer
- **WHEN** the user takes the offer to move the release source
- **THEN** the daemon's release source becomes the new URL and the offer is gone

#### Scenario: Leaving the release source alone
- **WHEN** the offer is shown and not taken
- **THEN** the daemon's release source is unchanged
