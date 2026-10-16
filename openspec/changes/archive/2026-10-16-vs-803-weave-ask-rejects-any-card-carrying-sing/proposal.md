## Why

VS-803 reported `weave_ask` rejecting every card with a `single_choice` input ("needs at least two choices"). It does not reproduce: a live `weave_ask` with a two-choice `single_choice` input returned `ok:true`, and in source the tool schema keeps `choices` and the validator accepts two. The existing MCP tests mock the decisions service, so no test sends `single_choice` through the real validator. This change adds that coverage.

## What Changes

- Add an end-to-end regression test that calls `weave_ask` through the real decisions service.
- No production code change; if the test finds a defect, it is fixed in the same change and noted.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
None. Test coverage only.

## Impact

Tests only, in `packages/server/test`.
