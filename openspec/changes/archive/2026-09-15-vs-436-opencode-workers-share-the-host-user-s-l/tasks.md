# Tasks — VS-436

## 1. Isolate opencode's XDG state and cache

- [x] 1.1 In `packages/runtimes/opencode/src/args.ts`, set `env['XDG_STATE_HOME'] = input.configHome` and `env['XDG_CACHE_HOME'] = input.configHome` in `buildArgs`, beside the existing `HOME`/`XDG_CONFIG_HOME`/`XDG_DATA_HOME` block, and the same two keys in `resumeCommand`'s `configHome` block. Update the doc comments that name the relocated keys. Verify: the file typechecks and the args unit test below passes.

## 2. Cover it with tests

- [x] 2.1 In `packages/runtimes/opencode/test/args.test.ts`, extend the `isolates config via XDG dirs and HOME (VS-161)` case so the whole env equals all five keys set to `configHome`, and assert `XDG_STATE_HOME` is that runtime home and never the host user's `~/.local/state`. Extend the `resumeCommand` `relocates HOME and both XDG dirs to configHome` case the same way. Verify: `npx vitest run packages/runtimes/opencode/test/args.test.ts` passes.
- [x] 2.2 Confirm no other shipped adapter sets an `XDG_*` variable and therefore none needs the same fix (grep `packages/runtimes/*/src/args.ts`). Verify: only opencode names `XDG_*`; recorded in the PR.

## 3. Suites and lint

- [x] 3.1 `pnpm lint && pnpm typecheck` clean.
- [x] 3.2 `pnpm test` green — paste both the core/server and UI suite blocks verbatim in the report.
