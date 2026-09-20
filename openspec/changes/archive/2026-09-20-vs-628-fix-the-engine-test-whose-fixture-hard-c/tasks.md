## 1. Time-sensitive fixture audit

- [x] 1.1 Search `packages/*/src` test files for absolute ISO instants with `rg -n "20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9:]+Z" packages/*/src --glob '*.test.*'`, classify each match, and fix any fixture that is compared with real current time and will expire within one year; verify the audit findings are recorded for delivery.

## 2. Engine usage-limit fixture

- [x] 2.1 Update `packages/core/src/runs/engine.test.ts` so the reset instant is the current clock rounded to a whole minute plus a fixed future offset, and derive both the provider error and exact UTC expected message from that shared value; verify the named test passes on the changed file.

## 3. Regression verification

- [x] 3.1 Confirm the implementation diff changes only test files, rerun the changed test file, then run the capped full test command with the worker cap and verify both the core/server and UI suite result blocks pass.
