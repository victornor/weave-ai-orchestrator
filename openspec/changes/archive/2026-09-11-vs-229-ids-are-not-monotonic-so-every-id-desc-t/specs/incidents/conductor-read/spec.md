## ADDED Requirements

### Requirement: Same-millisecond incidents bookmark as a stable group

Incidents that share a `createdAt` millisecond SHALL list as a contiguous newest-first block in reverse creation order. A caller that receives the whole group on one page and then lists again with `since` set to that shared `createdAt` SHALL receive none of the group: the exclusive bookmark neither repeats a row from the group nor drops one that was on that page.

This is the VS-222 paging contract (bookmark the newest `createdAt` after a short page) made safe for a same-millisecond group that fits in the page. A `limit` that splits the group remains a timestamp-cursor limitation and is not changed by this capability.

#### Scenario: A same-millisecond pair is a stable newest-first block

- **WHEN** two incidents are filed in sequence and share a `createdAt` millisecond
- **THEN** listing them newest first returns the later-created incident, then the earlier one
- **AND** listing them again returns the same order

#### Scenario: Bookmarking the group's createdAt drops neither and repeats neither

- **WHEN** two incidents share a `createdAt` and a list with a limit covering both returns both
- **AND** the caller lists again with `since` equal to that `createdAt`
- **THEN** neither incident is in the second page
