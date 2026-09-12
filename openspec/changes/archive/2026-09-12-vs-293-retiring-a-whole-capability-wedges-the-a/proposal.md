## Why

`openspec` 1.12.0 already refuses to rebuild a capability's spec down to zero requirements unless
the change's `.openspec.yaml` declares `retire_capabilities: true` (its own `#1302` fix). VS-285
retired `runtime-credentials/serialized-refresh` outright but never set that marker, so
`openspec validate --strict` reported clean at propose time — twice, per the worker's own reports —
while archive was always going to fail. The PR was merged and closed before the gap was found, so
no worker can push the one-line fix to VS-285's own branch, and the stale spec is still on `main`
telling a future worker to reintroduce the exact mechanism that invalidated captain's login. The
missing marker is trivial to add **before** a change is proposed; it is unrecoverable once the PR
is merged and closed. The check belongs at the gate that can still act on it.

## What Changes

- Add `retire_capabilities: true` to `openspec/changes/vs-285-stop-forcing-claude-credential-refreshes/.openspec.yaml`
  (alongside its existing `schema:` key), so the daemon's next archive attempt on that already-merged
  change retires `runtime-credentials/serialized-refresh` instead of failing. This is a one-line data
  fix to a change directory that already merged; no code in that change is touched.
- Add a check to `OpenSpecService.validateForProposed` (`packages/core/src/openspec/index.ts`), which
  already feeds the `proposed` transition gate (`tickets/service.ts`'s `checkTransition` for
  `to === 'proposed'`): for every capability a change's spec deltas touch, if the delta would leave
  that capability with zero requirements and the change's `.openspec.yaml` does not set
  `retire_capabilities: true`, the gate rejects the transition with an error naming the capability
  and the marker — the same way a real `openspec validate --strict` failure already does. A change
  that removes only some of a capability's requirements is unaffected; a change that removes all of
  them and does set the marker passes, exactly as `openspec archive` will.
- Cover the new check with a test built from a real fixture shaped like VS-285's own delta (a
  `## REMOVED Requirements` section naming every requirement a capability currently has), per
  [[tickets-and-openspec]]'s note on writing fixtures from real bytes rather than a guessed shape.

## Capabilities

### New Capabilities
- `ticket-delivery/openspec-retirement`: the `proposed` gate refuses a change that would empty a
  capability's spec without the change declaring `retire_capabilities: true`.

### Modified Capabilities
(none — this is a new gate, not a change to existing gate behavior)

## Impact

- `packages/core/src/openspec/index.ts` — `validateForProposed`, plus a new pure helper that reads a
  change's spec deltas and the current main specs to detect an undeclared wholesale retirement.
- `packages/core/src/openspec/cli.ts` — read-only reuse of the existing `showSpec`/`statusChange`
  wrappers; no new `openspec` subcommand is invoked.
- `openspec/changes/vs-285-stop-forcing-claude-credential-refreshes/.openspec.yaml` — the one-line
  marker VS-285 is missing.
- Nothing in VS-285's shipped code, `@fission-ai/openspec` itself, or
  `runtime-credentials/credential-visibility` is touched.
