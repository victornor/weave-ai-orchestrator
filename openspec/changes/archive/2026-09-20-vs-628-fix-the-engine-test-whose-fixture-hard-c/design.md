## Context

See `proposal.md` for the motivation and scope. The affected test currently embeds one absolute ISO timestamp in the simulated provider error and a separately hard-coded UTC display string. The test harness does not need product-clock control for this case; it can construct a future instant from the real clock used by the test.

## Goals / Non-Goals

**Goals:**

- Keep the simulated reset safely in the future on every test date.
- Ensure the provider error and expected message are generated from exactly one `Date` value.
- Preserve the exact user-facing formatting assertion and identify other expiring test fixtures.

**Non-Goals:**

- No production code, parser, formatter, or API changes.
- No broad weakening of the assertion or replacement with a regular expression.
- No unrelated cleanup of stable historical timestamps.

## Decisions

- Use the current instant rounded down to the minute plus a fixed future offset (two hours). Rounding prevents seconds from leaking into the expected display value while the offset keeps the product's usage-limit handling on its future-reset path. A fake clock was considered but is unnecessary because the test's only requirement is a relative future value.
- Build the provider error's ISO value and the expected `YYYY-MM-DD HH:mm UTC` value from that same reset `Date`, using the production-facing formatting rule already exercised by the test. This avoids two independently maintained representations while retaining an exact assertion.
- Audit all test-only source files with the requested ISO timestamp search, then change only fixtures whose absolute value is compared against real current time and would expire within one year. Fixed historical dates and tests with their own fake clocks remain unchanged.

## Risks / Trade-offs

- [Clock rolls across a minute between fixture creation and formatting] → Round `Date.now()` before adding the offset and reuse the resulting value for every representation.
- [The audit finds another time-sensitive fixture] → Fix it in the same test-only scope and record the finding in the delivery report.
- [Formatting differs by timezone] → Use UTC getters/formatting, matching the existing product rule and expected message.

## Migration Plan

No migration or runtime rollout is required. Apply the test-only edits, run the changed test file, run the requested timestamp audit, then run both full suites once with `--maxWorkers=4`. Rollback is reverting the test commit.
