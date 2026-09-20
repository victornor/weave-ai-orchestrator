## Why

The engine regression test hard-codes a usage-limit reset instant that has already passed, so it fails on otherwise healthy branches as time advances. The fixture must remain valid on every date while continuing to assert the exact formatted reset time.

## What Changes

- Make the usage-limit reset fixture relative to the test's current clock, rounded to a whole minute and offset into the future.
- Derive both the provider error and expected user-facing message from that same reset instant.
- Audit test fixtures for other absolute instants that are compared with real current time, fixing only cases that will expire within the next year.
- Keep the change limited to test files; no product behavior or API changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This is a test-fixture maintenance change with no spec-level behavior change.

## Impact

Only `packages/*/src/**/*.test.*` fixtures may change. The engine test and any additional expiring fixtures will be verified with the targeted test, followed by the repository's full core/server and UI suites using the required worker cap.
