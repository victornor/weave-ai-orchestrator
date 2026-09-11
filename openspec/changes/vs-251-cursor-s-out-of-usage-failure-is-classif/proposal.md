## Why

On 2026-09-11 a worker on [VS-250](conductor://tickets/VS-250) failed on the cursor runtime with a
real out-of-usage error (`ActionRequiredError: Increase limits for faster responses You're out of
usage. Switch to Auto, or ask your admin to increase your limit to continue.`). `classifyError`
(`packages/runtime-sdk/src/process.ts`) did not recognise the phrase, so the run recorded
`errorCode: "exit_1"`, `errorFamily: "unknown"` instead of `provider_quota`. Every behaviour
[VS-238](conductor://tickets/VS-238) built four hours earlier — keeping the provider's own words,
parsing a reset time, offering a tier switch, refusing the automatic retry ladder — is already
specified under `run-recovery/stuck-worker-parking` and `run-recovery/retry-ladder`, gated on
`family === 'provider_quota'`. Nothing in those requirements changes; the matcher simply fails to
recognise a real provider's wording, so a failure that should be parked-and-explained instead looked
like an ordinary unknown exit and never reached that already-declared behaviour.

## What Changes

- Widen `classifyError`'s quota-matching regex to also catch cursor's confirmed `"out of usage"`
  phrasing, without loosening it to match on the bare word "usage" or on exit code alone (a false
  positive would send a human a reset time for a failure that has none).
- Add captured-bytes fixtures and unit tests in `packages/runtime-sdk/src/fixtures/` for every
  runtime's real out-of-usage text that could be captured without running a live coding CLI: cursor
  (from the VS-250 failure), codex (the capture already committed for
  [VS-238](conductor://tickets/VS-238)/VS-234's reset-parsing tests), and Claude Code (a literal
  phrase extracted with `strings` from the installed CLI binary). Gemini's real wording could not be
  captured this way — see design.md for what was tried — and is not asserted by a fixture.
- Add a regression test proving a message that only mentions "usage" in passing (CLI help/usage
  text) does not classify as `provider_quota`.
- Add a test proving the match is exit-code independent: the same quota text still classifies as
  `provider_quota` on an exit code other than 1 (and on a signal exit), since `classifyError` only
  special-cases `exitCode === 0`.
- **Not changed:** what the `provider_quota` arm does once matched (message preservation, reset-time
  parsing, tier switch, retry-ladder exclusion) — VS-238 owns that and it stays as-is. No new spec
  requirement is introduced; this fixes the matcher so the behaviour those requirements already
  describe actually fires for cursor's (and other runtimes') real wording.

**BREAKING:** none.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

(none — `skip_specs: true`; this widens an implementation-level string matcher so that failures
already covered by `run-recovery/retry-ladder`'s "usage limit is never retried automatically"
requirement and `run-recovery/stuck-worker-parking`'s quota-parking requirements are correctly
recognised as such. No requirement text changes.)

## Impact

- `packages/runtime-sdk/src/process.ts` — `classifyError`'s quota regex.
- `packages/runtime-sdk/src/process.test.ts` — new fixture-backed classification tests.
- `packages/runtime-sdk/src/fixtures/` — new captured-bytes files (cursor, codex, claude).
- No changes to `packages/core/src/runs/engine.ts`, the retry-ladder, or the parking card: those
  already do the right thing once `family === 'provider_quota'`.
