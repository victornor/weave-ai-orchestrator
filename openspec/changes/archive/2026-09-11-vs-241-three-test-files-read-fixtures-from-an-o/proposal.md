# Tests stop reading fixtures from an OpenSpec change folder

Tracker change for [VS-241](conductor://tickets/VS-241). A `task` ticket, so this change carries
tasks only — `skip_specs: true`. No capability specifies where a test may keep its fixtures; the
fix is test infrastructure, not product behavior.

## Why

VS-238 committed its provider captures inside its own change folder and pointed three test files at
them there:

```
openspec/changes/vs-238-a-worker-parked-on-an-exhausted-quota-ca/captures/…
```

That path is correct for exactly as long as the change is un-archived. Merging a change archives it,
which renames the folder to `openspec/changes/archive/<date>-<name>/`, so the tests began throwing
`ENOENT` at the moment of the merge that shipped them. `main` is red right now:
`packages/core/src/runs/reset.test.ts`, `packages/core/src/runs/engine.test.ts` and
`packages/runtime-sdk/src/process.test.ts` all fail on a clean checkout.

Committing the captures was right — they are the evidence the parser was built from. The mistake is
only in where the tests read them from.

## What changes

- **The capture bytes the tests need move into package fixture directories, next to the tests.**
  `packages/core/src/runs/fixtures/` takes `vs-234-opencode.txt`,
  `claude-monthly-spend-limit.txt` and `codex-youve-hit-your-usage-limit.txt`;
  `packages/runtime-sdk/src/fixtures/` takes its own copy of `vs-234-opencode.txt`. A package
  fixture directory is a location tests are already allowed to depend on
  (`packages/runtimes/opencode/test/fixtures/` is the precedent), and it travels with the tests
  rather than with a change.
- **The three test files read from those directories instead.** The bytes are unchanged, so every
  parser assertion — including VS-234's real reset instant `2026-09-11T17:54:35Z` — asserts the same
  values as before.
- **The captures stay in the archived change folder as documentation.** Duplicating a few hundred
  bytes is the cheaper half of the trade; the archive keeps the provenance.
- **A lint guard makes the guarantee structural.** `scripts/guard-test-fixtures.mjs` fails when any
  `*.test.ts` / `*.test.tsx` under `packages/` reaches a path into `openspec/changes/`, and it runs
  as part of `pnpm lint`. The next change that commits a capture cannot repeat this.

## Why a lint guard

A single source-level prohibition belongs with the other source guards
(`guard-boundaries.mjs`, `guard-console.mjs`), and `pnpm lint` runs before the suite rather than
inside it. A test that greps the test sources would have to contain the forbidden string itself and
was rejected for that reason; a boundaries entry cannot see a filesystem path built at runtime.

## Impact

- `packages/core/src/runs/reset.test.ts`, `packages/core/src/runs/engine.test.ts`,
  `packages/runtime-sdk/src/process.test.ts`: fixture paths only, no assertion changes.
- New: `packages/core/src/runs/fixtures/*.txt`, `packages/runtime-sdk/src/fixtures/*.txt`,
  `scripts/guard-test-fixtures.mjs`, and the `lint` script line in the root `package.json`.
- No production code, no `parseResetTime`, no archive step, and no VS-238 deliverable is touched.
