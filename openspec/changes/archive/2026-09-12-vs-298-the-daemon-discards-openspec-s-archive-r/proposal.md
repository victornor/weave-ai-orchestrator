## Why

`openspec archive --json` already tells us exactly why a blocked archive is blocked: a structured
diagnostic with a `code`, a `message`, and — for the case VS-285 hit — a `fix` field carrying the
precise refusal reason (which content the merge cannot safely account for, and the three ways to
resolve it). Our own wrapper (`packages/core/src/openspec/cli.ts`'s `archive()`) reads only
`message` off that diagnostic and discards `fix`, and whatever reaches the agent is then re-thrown
as a generic `internal` error (`packages/core/src/tickets/service.ts`'s `mergeDone`), indistinguishable
from a crash. Two workers and a weaver each burned a turn on VS-285's stuck archive because the one
thing that would have told them what to do next never left the daemon.

## What Changes

- **Surface the archive diagnostic's `fix` field, not only `message`.** `cli.ts`'s `archive()`
  captures both halves of `openspec`'s diagnostic and reports them together, so the error text names
  the capability and the refusal reason verbatim.
- **A blocked archive gets its own error code.** A new `openspec_archive_blocked` code (422,
  retryable: false) replaces `internal` whenever `openspec` returned a structured diagnostic (a
  known, actionable refusal), carrying the diagnostic's own `code` and `fix` in `details`. `internal`
  is now reserved for the case `openspec` gave us nothing structured to go on (a real crash).
  `mergeDone` preserves this code instead of flattening every archive failure to `internal`.
- **`runtime-credentials/serialized-refresh/spec.md` is reflowed, not rewritten.** Confirmed by
  running `openspec`'s own `buildUpdatedSpec` against the real files (see `design.md`): every line
  VS-285's already-approved retirement can't account for is the soft-wrapped second physical line of
  a `WHEN`/`THEN`/`AND` scenario bullet already accounted for by its first line — no requirement text
  is genuinely at stake. Un-wrapping those bullets onto one physical line each (wording unchanged)
  makes the unaccounted-content list empty, so `openspec archive` retires the capability through its
  own tool-verified path once VS-285's change reaches the primary clone. No hand deletion, and no
  prose moved into `## Purpose` or a canonical requirement to keep alive text for a capability that no
  longer exists.
- No change to VS-285's shipped code (already correct, already on `main`) and no change to
  `@fission-ai/openspec` itself (third-party install; its refusal is defensible — it just wasn't
  fully surfaced to us).

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `ticket-delivery/openspec-archival`: the recorded archive failure must carry the refusal's fix/
  guidance text in addition to its headline message, and must be reported under a code that
  distinguishes "openspec refused, for a stated reason" from "the archive attempt crashed."

## Impact

- `packages/core/src/openspec/cli.ts` — `archive()`'s failure path.
- `packages/core/src/tickets/service.ts` — `mergeDone()`'s archive-failure catch block.
- `packages/shared/src/errors.ts` — new `openspec_archive_blocked` error code.
- `packages/core/src/openspec/cli.test.ts`, `packages/core/src/tickets/merge-done.test.ts` — new
  coverage asserting the `fix` text and the new code both survive the round trip.
- `openspec/specs/runtime-credentials/serialized-refresh/spec.md` — reflowed (wording unchanged) so
  its already-approved retirement (VS-285) can complete. This file is deleted by `openspec archive`
  itself once VS-285's change lands on `main`; VS-298 only removes the false-positive block.
