# daemon-upgrade/asset-serving Specification

## Purpose
TBD - created by archiving change vs-210-a-tab-open-across-an-upgrade-breaks-and. Update Purpose after archive.

## Requirements

### Requirement: A missing built asset 404s instead of falling back to the app shell

The daemon's static file server SHALL treat a request under the built UI's asset directory — the
directory the build writes its content-hashed, immutable output to — as a real miss when no matching
file exists, and SHALL respond with a 404 whose body is the daemon's standard error envelope rather
than the app shell. It SHALL NOT serve `index.html`, and SHALL NOT respond `200`, for such a request.

A request that is not under the asset directory SHALL keep falling back to `index.html` when no
matching file exists, exactly as before this requirement, so that client-side routing for an ordinary
app route continues to work.

#### Scenario: A stale chunk request 404s

- **WHEN** a request is made for a file under the asset directory that does not exist (for example, a
  hashed chunk name from a build the daemon has since replaced)
- **THEN** the response is a 404 with the standard error envelope, not a 200 response carrying HTML

#### Scenario: An existing asset is served unchanged

- **WHEN** a request is made for a file under the asset directory that does exist
- **THEN** the file is served exactly as it is today, with its existing content type and caching

#### Scenario: An ordinary app route still falls through to the index

- **WHEN** a request is made for a path that is not under the asset directory and matches no file on
  disk (for example, a client-side route)
- **THEN** the response is the app's `index.html`, unchanged from today's behavior
