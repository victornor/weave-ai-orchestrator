## Why

The repository may be made public. A scan of the tree and every commit on every ref, plus a manual sweep, was needed to confirm it holds no secrets and to remove personal and host details.

## What Changes

- Real tailnet name, tailnet IP, home paths, workspace/project/org names and a backup host replaced with placeholders across docs, archived OpenSpec changes and test fixtures.
- Removed `docs/reviews/vs-455/` (screenshots showing a real workspace name).
- Added `.gitleaks.toml` (default rules plus a line-exact fixture allowlist) and `pnpm scan:secrets`.
- Tightened `.gitignore`; fixed two broken links in `docs/CONFIGURATION.md`.

## Impact

Documentation, fixtures and tooling only; no product behaviour changes. History is untouched; findings that live only in history are reported on the ticket.
