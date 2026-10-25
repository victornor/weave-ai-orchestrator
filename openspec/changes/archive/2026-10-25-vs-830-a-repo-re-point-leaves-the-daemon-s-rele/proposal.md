## Why

A project's repo URL and the daemon's release source (`upgrade.source` in `daemon.yaml`) are two separate settings, and re-pointing a project (VS-811/VS-827) touches only the first. After the migration to `weave-ai-orchestrator` the Release panel still named the old repository, and the only symptom was "no update available" — the old repo still exists and is reachable, so upgrades silently kept building from it. Settings can display the value but not change it, so the only fix was hand-editing `daemon.yaml` and restarting the daemon.

## What Changes

- **Mismatch is visible.** When the release this daemon runs from was built from a repository that one of the workspace's projects has since been re-pointed away from, and `upgrade.source` still names that old repository, the update status reports the mismatch with the new URL, and Settings → Release shows a warning instead of "Up to date".
- **The mismatch is fixable from Settings.** A new operator-only write to the daemon's release source (`PATCH /api/daemon/update/source`, and `weave daemon update source <url> [--ref <ref>]` in the CLI) validates that the source is reachable and that the ref exists there, writes `upgrade.source` (and `ref`) to `daemon.yaml`, and takes effect in the running daemon without a manual restart.
- **The re-point is offered at the point it happens.** `PATCH /projects/:id` that changes `url` reports whether the daemon's release source still names the project's previous URL; Settings → Projects then offers to move the release source to the new URL. The source is only ever moved when it matched the old URL — an operator's independent choice is never rewritten.
- `docs/OPERATIONS.md` gains the migration step: re-pointing a project also means checking the daemon's release source.

## Capabilities

### New Capabilities
- `daemon-upgrade/release-source-mismatch`: detecting, surfacing and repairing a release source left naming a repository a project was re-pointed away from.

### Modified Capabilities
- `daemon-upgrade/update-availability`: the update status additionally reports the source the running release was built from, the project it belongs to, and whether the configured source is stale.
- `daemon-upgrade/upgrade-surfaces`: Settings → Release shows the stale-source warning and offers the repair; the CLI can read and change the release source.
- `project-repo-url`: a re-point reports when it leaves the daemon's release source naming the previous URL, and Settings offers to move it.

## Impact

`packages/server/src/release-info.ts` (status shape, mismatch detection), `packages/server/src/routes/daemon.ts` and `routetable.ts` (the new write), `packages/server/src/types.ts` (an injected source writer), `packages/core/src/projects/index.ts` + `packages/core/src/api.ts` (the re-point outcome), `packages/server/src/routes/projects.ts` (response), `packages/cli/src/commands/daemon.ts`, `packages/ui/src/settings/sections.tsx`, `packages/ui/src/api/{hooks,types}.ts`, `docs/OPERATIONS.md`. Existing `GET /api/daemon/update` keeps its shape — the new fields are additive.
