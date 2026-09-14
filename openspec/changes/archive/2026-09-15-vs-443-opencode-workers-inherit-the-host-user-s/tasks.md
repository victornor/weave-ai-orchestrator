# Tasks — VS-443

## 1. Generate the opencode worker config

- [x] 1.1 In `packages/core/src/workspace/loader.ts`, remove the two opencode config pairs from `credentialPaths` (keep the `auth.json` pair), and add `generateOpencodeWorkerConfig(hostConfigDir, workspaceConfigHome)`: read `opencode.jsonc`/`opencode.json` from the host config dir with a JSONC-tolerant parse, keep only `$schema`/`autoupdate`/`provider`, remove any existing workspace `opencode.json`/`opencode.jsonc` first (never write through the old symlink), and write the generated file. Call it for `opencode` from `linkRuntimeCredentials`, sourcing the host dir from the daemon's own credential dir when isolated. Update the doc comments that say OpenCode shares the host config. Verify: file typechecks.
- [x] 1.2 `packages/core/src/workspace/credentials.test.ts`: rewrite the opencode block so it asserts the generated config carries the owner's `provider` entries and no `mcp`/`plugin`, that a host config with an `mcp` server does not reach the worker config, that a provider change is reflected on the next link, that `.jsonc` input is read, that `auth.json` stays a symlink, and that an isolated daemon generates nothing and leaves the host file untouched. Verify: `npx vitest run packages/core/src/workspace/credentials.test.ts` passes.

## 2. Confirm the other runtimes are unaffected

- [x] 2.1 Check claude, codex, gemini and cursor for the same inherited-MCP-servers problem: each isolates via a dedicated config-dir env var and passes MCP config explicitly, and `credentialPaths` links only a credential file for them. Record the finding in the PR. Verify: no other adapter needs a change; no host MCP config is linked into any non-opencode runtime home.

## 3. Suites and lint

- [x] 3.1 `pnpm lint && pnpm typecheck` clean.
- [x] 3.2 `pnpm test` green — paste both the core/server and UI suite blocks verbatim in the report.

## 4. Security hardening — merge-card feedback

- [x] 4.1 Write the generated config `0600` (it copies the owner's inline provider keys), make the containing `opencode/` dir no more permissive than `0700`, and re-enforce both on every regeneration.
- [x] 4.2 Write atomically: a `0600` temp file in the same directory, then `rename` over `opencode.json`; unlink first only when the path is currently a symlink (the upgrade case), so nothing ever writes through the owner's file and a worker never sees a missing/partial config.
- [x] 4.3 Log a warning (no secret values) on a read or write failure and keep the previous generated config rather than deleting it and writing nothing.
- [x] 4.4 Tests: `0600` on first write; regeneration over a pre-existing `0644` file ends at `0600`; a symlink upgrade leaves the owner's file and its mode untouched; a failed write and an unreadable owner config each keep the prior generated config; the existing isolation tests still pass.