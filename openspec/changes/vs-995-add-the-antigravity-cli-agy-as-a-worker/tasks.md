## 1. Capture real agy output (gate for the parser)

- [x] 1.1 Add `scripts/capture-agy-fixtures.sh` and its echo MCP server (design §5): fresh absolute `--gemini_dir` under `/tmp`, turn 1 with `--json-schema` and one MCP tool call, turn 2 with `--conversation`, the two `-p /model` effort probes, OAuth URL/token redaction, output to a directory the owner attaches back to the ticket; verify it end to end against a fake `agy` on PATH (never the real one)
- [x] 1.2 Ask the weaver (`weave_ask`) for the owner to run the script once and attach the output; record the captured `agy --version` and the `--effort` answer in the ticket

## 2. Package and invocation

- [x] 2.1 Scaffold `packages/runtimes/agy` (package.json, tsconfig, index, session ref `{ conversationId }`) and wire it into the root tsconfig references, vitest aliases, `packages/server/package.json` and `RUNTIME_PACKAGES` in `daemon.ts`
- [x] 2.2 `args.ts`: pure `buildArgs` — `--gemini_dir <abs home>/.agy` first, `-p`, `--output-format stream-json`, `--json-schema`, composed `--model`, permission flags per design §7, `--conversation`, `--add-dir` for an out-of-home worktree, prompt on argv or stdin above `MAX_ARGV_PROMPT`; never `--effort`; plus `resumeCommand`; unit tests for every row of design §4 and §7
- [x] 2.3 `mcpConfig()`: write `<dir>/config/mcp_config.json` with exactly the run's servers (stdio and http shapes), replacing prior content; test that a pre-existing `blender` entry is gone afterwards
- [x] 2.4 `models.ts`: the nine static families (all 23 ids of 1.5.14, Claude and GPT-OSS included) with captain's names and per-family efforts, `composeModelId(model, effort)` with pass-through for full and unknown ids; tests for every row of the design §4 table and that the listed families expand to exactly the 23 ids

## 3. Isolation proof

- [x] 3.1 `detect()`: version via `--version`, then the `--gemini_dir` self-check (`mcp list` against a seeded scratch dir must list exactly the seeded server); unavailable with a named reason otherwise; tests with a fake `agy` that honours, ignores, and rejects the flag
- [x] 3.2 MCP-surface test: with a fake `agy` that, like the real one, reads `<--gemini_dir>/config/mcp_config.json` (and `$HOME/.gemini/config/mcp_config.json` when the flag is absent), a turn built by the adapter under a scratch `HOME` seeded with an owner `blender` server sees exactly the weave server and not `blender`
- [x] 3.3 Opt-in real-binary check, skipped unless `AGY_BIN` is set: `agy --gemini_dir <tmp> mcp list` under a scratch `HOME` lists only the seeded server (no login and no network needed); document how to run it in the package README section of `docs/OPERATIONS.md`

## 4. Events, report and resume

- [x] 4.1 `events.ts`: parser for the captured `stream-json` events → normalized run events, partial text, usage (input/output/thinking/cache-read tokens), `conversation_id`, `structured_output`, `finished_reason`, `denied_actions`; fixtures under `fixtures/` copied from the capture (redacted), plus the sandbox-captured auth-failure result line
- [x] 4.2 `adapter.ts` `runTurn`: write instruction/MCP files, spawn via `launchCommand`, feed the parser, session ref from `conversation_id` (keep the previous ref when none is reported), report from `structured_output` else `extractReport`; adapter tests over the fixtures, including a two-turn resume test asserting `--conversation <id from turn 1>`
- [x] 4.3 Accounting separation (design §8): `RuntimeCapabilities.estimateCostByModel` (optional, default `true`) in runtime-sdk; the engine skips `estimateCostCents` when it is `false`; the agy adapter reports provider `antigravity` and declares `false`; engine test that an `agy` run on `claude-opus-5-5-high` with usage and no cost is recorded `unpriced` under runtime `agy`/provider `antigravity`, and a `claude` run is unchanged; usage-service test that the per-model breakdown keeps the two on separate rows
- [x] 4.4 `installInstructions` (`AGENTS.md`, skills under `.agents/skills/`), `skillsDir`, `instructionFiles`, `describeSession`, `describeAccount` (billing mode only: `metered_api` with `GEMINI_API_KEY`, else `subscription_included`), `configSchema`, `capabilities` (`streamingInput: false`, `structuredOutput: true`, `mcp: true`, `resumableSessions: true`)

## 5. Authentication

- [x] 5.1 Stderr watcher: the first line starting `Authentication required.` kills the turn and yields the fixed `auth` error with no URL; the `authentication failed or timed out` result and `Authentication expired` are mapped the same way; tests from the captured stderr bytes, including a URL whose random part contains `429`/`503`, asserting family `auth` and that the stored message contains no `https://`
- [x] 5.2 Login-gate test in core with a fake runtime `agy` that fails with family `auth`: the runtime gates, one card titled `The agy login expired — log in again to resume` names `weave runtime login agy`, and recovery on a successful turn ungates it — the same assertions the Claude path has
- [x] 5.3 `NATIVE_LOGIN.agy`, the `weave runtime login agy` entry in `packages/cli/src/commands/runtime.ts`, and the `doctor`/`install` runtime checks
- [x] 5.4 Isolated-daemon env hook in the engine (design §3): for runtime `agy` on an isolated daemon, drop `DBUS_SESSION_BUS_ADDRESS` and point `XDG_RUNTIME_DIR` at an empty dir under the run dir; engine test asserting the child env on isolated vs shared daemons

## 6. Docs and delivery

- [x] 6.1 ADR `docs/adr/0025-agy-runtime-config-isolation.md` (the `--gemini_dir` reliance, options A–D, self-check), `docs/OPERATIONS.md` runtime/login table row, and the PLAN runtime list if it enumerates runtimes
- [ ] 6.2 `pnpm lint && pnpm typecheck && pnpm test` green, with both suite blocks pasted verbatim in the PR; the PR states the agy version built against (1.5.14 plus whatever the capture reports), what is verified only in the sandbox, and the post-upgrade steps (the six proposed catalog options, end-to-end ticket) and what the 16-option catalog cap means for captain
