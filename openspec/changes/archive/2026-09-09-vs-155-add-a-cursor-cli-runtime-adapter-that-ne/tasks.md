## 1. Package skeleton

- [x] 1.1 Create `packages/runtimes/cursor` with `package.json` (`@agent-conductor/runtime-cursor`, AGPL-3.0-only, same deps as gemini), `tsconfig.json` (shared + runtime-sdk refs), and `src/index.ts` exporting the adapter. Verify the files exist and `package.json` name is `@agent-conductor/runtime-cursor`.
- [x] 1.2 Add the package to root `tsconfig.json` references, `packages/server/package.json` dependencies, `packages/server/src/daemon.ts` `RUNTIME_PACKAGES`, and `scripts/guard-boundaries.mjs` core forbid list (`@agent-conductor/runtime-cursor`). Verify `rg runtime-cursor` hits all four and `rg runtime-gemini` still has a matching sibling in each.

## 2. Pure launch: args, session, account, credential

- [x] 2.1 Implement `src/session.ts` (`asCursorSession` / `{ sessionId }`) and `src/args.ts` `buildArgs` + `userFrame`: cmd `cursor-agent`; `-p --output-format stream-json --trust`; `--force`/`--yolo` unless `restricted`; `--sandbox enabled` only when `restricted`; `--approve-mcps` when MCP servers exist; `--resume <id>` when a session ref exists, never `--continue`; `--model` from input; when live input is on, stdin is `userFrame(prompt)` (Claude's `{"type":"user","message":{"role":"user","content":…}}` shape) and the prompt is not an argv operand; when `liveInput: false`, prompt may be argv/plain stdin; `CURSOR_CONFIG_DIR` from `configHome`; write `.cursor/mcp.json` for HTTP/stdio MCP; drop `--worktree`/`-w`/`--worktree-base` (and the following value) from `extraArgs`; never prefix `&`, never pass `acp` or `worker`. Verify with `packages/runtimes/cursor/test/args.test.ts` covering live vs `liveInput: false`, new/resume, MCP file, permission mapping, extraArgs worktree strip, no `&` prefix on the frame, no `--continue`/`acp`/`worker`/`--worktree`.
- [x] 2.2 Implement `src/account.ts` (`describeCursorAccount`, spawn-free: `CURSOR_API_KEY` → `metered_api`, `auth.json` present → `subscription_included`, else `unknown`) and `src/credential.ts` (`readCredential` on `auth.json`, JWT `exp` when present, never return a token). Verify with unit tests over fixture files that assert no token-bearing field and the three billing branches.

## 3. Adapter, parser, fixtures

- [x] 3.1 Implement `src/adapter.ts`: id `cursor`, displayName `Cursor CLI`; capabilities `{ resumableSessions: true, forkSessions: false, streamingInput: true, systemPromptInjection: 'file_only', structuredOutput: false, mcp: true, usageReporting: 'none', costReporting: false, permissionModes: ['auto','restricted','bypass'] }`; `detectBinary('cursor-agent', ['--version'])`; static `listModels`; `skillsDir` `.cursor/skills`; `instructionFiles` `['AGENTS.md']`; `installInstructions` writes AGENTS.md plus `.cursor/skills` and a CLAUDE.md `@AGENTS.md` pointer; no `forkSession`; `runTurn` uses `launchCommand` + `spawnLines` with `stdinMode: 'open'` when live, closes stdin on `resultSeen`, exposes `send` that writes `userFrame(text)`. Verify with `test/adapter.test.ts` for id/capabilities (`streamingInput: true`)/skills/instructions/detect/listModels/no forkSession.
- [x] 3.2 Implement `src/events.ts` mapping Cursor stream-json (`system/init`, `assistant`, `tool_call` started/completed, `result`) onto the runtime event enum; unknown types → `runtime.raw`; set `resultSeen` on the terminal `result` line. Add synthetic `fixtures/*.jsonl` transcribed from the published example sequence (label them synthetic in the test file header, Gemini's pattern). Verify with `test/events.test.ts` that a simple turn and a tool-using turn produce `session.started`, `assistant.text`, `tool.call`/`tool.result`, `turn.completed`, and that `session.resumed` is used when resumed.
- [x] 3.3 Add `test/liveInput.test.ts` against a fake `cursor-agent` binary (Claude's `fakeCli` pattern): mid-turn `send` reports `delivered`; a send after `result` reports `closed`; `liveInput: false` omits `send`. Never spawn the real CLI. Verify with `pnpm vitest run packages/runtimes/cursor`.

## 4. Host wiring

- [x] 4.1 Add `cursor: [[join(h, '.config', 'cursor', 'auth.json'), join(home, 'auth.json')]]` to `credentialPaths` in `packages/core/src/workspace/loader.ts`. Verify an existing loader/credential test still passes and a new assertion covers the cursor pair (isolated remap uses `basename(dst)` so `auth.json` under `credentials/cursor/` is automatic).
- [x] 4.2 Add `FALLBACK.cursor` in `packages/cli/src/commands/runtime.ts` (`env: 'CURSOR_CONFIG_DIR'`, `command: ['cursor-agent', 'login']`). Add `"cursor": { "path": ".cursor/skills/<name>/SKILL.md" }` to `skills/manifest.json`. Do not add cursor to `InstallableId`. Verify `rg FALLBACK` / manifest include `cursor` and `install.ts` does not.

## 5. Docs

- [x] 5.1 Add a Cursor row to `docs/PLAN.md` §8.1 id union and §8.3 per-CLI table (binary `cursor-agent`, print-mode flags, MCP file, `CURSOR_CONFIG_DIR`, no fork, live input = Claude-shaped stdin `user` frames). Add the credential row to `docs/OPERATIONS.md` §7. Update `CLAUDE.md` runtimes list and `docs/DOCKER.md` auth table. Verify each file names `cursor-agent` and none tell the reader to invoke `agent`.

## 6. Verify

- [x] 6.1 Run `pnpm typecheck`, `pnpm lint`, and `pnpm test` at the repo root and confirm all green. PR description states: binary is `cursor-agent`; Cloud Agent handoff and `--worktree` are test-guarded; live follow-up stdin frames, print-mode `&` handling, and `CURSOR_CONFIG_DIR`/`auth.json` layout are unverified against the real CLI.
