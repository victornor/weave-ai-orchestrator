## 1. Pin host mise roots in childEnv

- [x] 1.1 In `packages/runtime-sdk/src/launch.ts`, after merging daemon env with the overlay, when `HOME`, `XDG_DATA_HOME`, or `XDG_CONFIG_HOME` differ from the pre-overlay daemon values, set `MISE_DATA_DIR`, `MISE_CONFIG_DIR`, and `MISE_CACHE_DIR` with `??=` to the daemon process's mise directories as specified in design.md. Preserve overlay `HOME` / XDG. Verify: `pnpm exec vitest run packages/runtime-sdk/src/launch.test.ts` — new cases (1) overlay HOME+XDG to a temp config-home with stubbed daemon HOME and XDG → `MISE_*` under the stubbed daemon home and overlay HOME/XDG unchanged (2) existing Claude-config overlay test still injects no `MISE_*` (3) overlay HOME plus explicit `MISE_DATA_DIR` keeps the overlay value.

## 2. OpenCode spawn uses launchCommand

- [x] 2.1 In `packages/runtimes/opencode/src/adapter.ts` `runTurn`, resolve through `launchCommand(built.cmd, built.env)` and pass `launch.cmd` / `launch.env` to `spawnLines`, matching Claude/Cursor. Leave `buildArgs` HOME/XDG isolation as it is. Verify: `pnpm exec vitest run packages/runtimes/opencode/test/args.test.ts packages/runtimes/opencode/test/adapter.test.ts` — the VS-161 HOME/XDG assertion still matches, adapter tests still pass.

## 3. Checks

- [x] 3.1 Run `pnpm lint`, `pnpm typecheck`, and `pnpm test`. Paste **both** suite blocks verbatim in the ticket comment (core/server and UI separately; do not add the totals). Do not launch a real coding CLI.
