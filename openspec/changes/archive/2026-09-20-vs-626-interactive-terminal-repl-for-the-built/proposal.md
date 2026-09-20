## Why

The built-in `weave` agent only runs as a per-turn child of the daemon (`packages/agent/src/bin.ts`: one `init` line in, one `result` out). Captain cannot start it by hand, try a model, look at its skills or MCP servers, or resume a session without filing a ticket. The design left "a `weave-agent` REPL for human handover" for later; captain has now asked for it, pi/opencode style.

## What Changes

- A plain-terminal REPL for the built-in agent, run as `weave repl` and, through a second shim written next to `weave`, as `weave-agent`. It drives the existing loop (`runAgentTurn`) in-process; the loop, sessions, skills, MCP client, provider profiles, permission modes and steering queue are reused, not copied.
- Slash commands: `/help /sessions /new /compact /skills /mcp /model /permissions /exit`, tab-completable.
- One-shot `-p "<prompt>"`, plus `-c` (continue the newest session here) and `--resume <id>` from the shell.
- Standalone: no daemon and no workspace needed. Providers come from the nearest workspace's `providers:` when one resolves (key from the workspace secret store, read locally), otherwise from `--provider/--base-url/--model` flags and `WEAVE_LLM_<PROVIDER>_KEY` in the environment.
- Human sessions live in their own directory (`<data home>/weave-agent/sessions`), never in a worker's, and are sweeped by the existing 30-day retention.
- `docs/`: a "Running the agent yourself" page.
- Additive changes to `@weave-ai/agent`: exported loop entry and REPL modules, an optional `skillRoots` on `init`, an `origin: "repl"` header field on new session files, and a read-only secret opener. No change to the child protocol's existing fields or to the daemon.

## Capabilities

### New Capabilities
- `agent-repl`: the interactive terminal client for the built-in agent: commands, one-shot mode, standalone configuration, human session storage, rendering and cancellation.

### Modified Capabilities
<!-- none: builtin-agent's requirements are unchanged; the loop is reused as is -->

## Impact

- `packages/agent`: new `src/repl/*` (pure renderer, command handling, config resolution, session listing, terminal driver), small additive exports and `skillRoots`; boundary guard unchanged (agent still imports only `shared`).
- `packages/cli`: new `repl` command and a `repl-bin` entry; new dependency `@weave-ai/agent`.
- `packages/release`: `writeCliShims` also writes `weave-agent`; upgrade paths already call it.
- `docs/`: new page; `docs/API.md` untouched (no route changes).
- Unverified without a real endpoint: one real turn from a real terminal (weaver-run live check).
