# daemon-upgrade/stale-build-recovery Specification

## Purpose
TBD - created by archiving change vs-210-a-tab-open-across-an-upgrade-breaks-and. Update Purpose after archive.

## Requirements

### Requirement: A stale tab recovers from a version-skew dynamic-import failure

When a route in the web app fails to load because a dynamically-imported chunk could not be fetched
— the shape of failure a tab that has been open since before an upgrade produces, once its own code
tries to load a chunk the current build no longer ships — the app SHALL treat this differently from an
unrelated rendering error: it SHALL reload the page once, so that the freshly-loaded `index.html`
references the current build's chunks, rather than showing the same generic error a real bug would
show.

The app SHALL NOT reload for this reason more than once within a short window: if a dynamic-import
failure recurs shortly after a reload already attempted to recover from one, the app SHALL NOT reload
again, and SHALL instead show that the app was updated but did not finish loading, with a manual way
to reload. A dynamic-import failure that occurs well after a prior reload (a later, independent
upgrade) SHALL be treated as a fresh occurrence and SHALL still reload once.

An error that is not a dynamic-import failure SHALL continue to show the app's existing generic error
state, unchanged by this requirement.

#### Scenario: A stale tab recovers automatically

- **WHEN** a route fails to load because a dynamically-imported chunk cannot be fetched, and no
  recovery reload has been attempted recently
- **THEN** the app reloads the page once, without asking, rather than showing a bare error

#### Scenario: A reload loop is refused

- **WHEN** a dynamic-import failure occurs again shortly after a reload already attempted to recover
  from one
- **THEN** the app does not reload again, and instead shows that the update did not finish loading,
  with a manual way to reload

#### Scenario: A later, independent upgrade still gets its own reload

- **WHEN** a dynamic-import failure occurs well after any prior recovery reload
- **THEN** the app treats it as a fresh occurrence and reloads once, the same as the first time

#### Scenario: A real error is unaffected

- **WHEN** a route fails for a reason other than a dynamic-import failure
- **THEN** the app shows its existing generic error state, and does not reload the page
