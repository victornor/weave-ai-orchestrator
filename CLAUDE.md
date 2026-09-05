# CLAUDE.md — working on AgentConductor

For coding agents (and humans) changing this repo. User-facing docs are in [`README.md`](README.md)
and [`docs/`](docs/); this file is about the code.

## Read these three first

| Doc | Why |
|---|---|
| [`docs/PLAN.md`](docs/PLAN.md) | The naming and behaviour contract. Every `code`-styled identifier in it (table, field, tool name, CLI command, status) is the real one. §23 is the decision log; §22 the milestones. **The plan wins on conflict** with any other doc. |
| [`docs/API.md`](docs/API.md) | The HTTP + SSE + MCP surface. Adding a route means adding it here too. |
| [`docs/design/DESIGN-CONTRACT.md`](docs/design/DESIGN-CONTRACT.md) | Tokens, components, screens and states for `packages/ui` and, by extension, `packages/tui`. It is the source of visual truth. |

Deviations from the plan go in `docs/adr/` with the reason, not into the plan silently.

## Repo map

```
packages/
  shared/         enums, Zod config schemas, OcError, event types, tool names, pricing, report shapes
  db/             SQLite (node:sqlite) wrapper, schema, migrations, ULIDs
  runtime-sdk/    RuntimeAdapter interface, process spawning, event testkit
  channel-sdk/    ChannelAdapter interface
  surface-sdk/    SurfaceAdapter interface
  plugin-sdk/     definePlugin + PluginHost (registers runtimes, channels, surfaces, worktree
                  providers, forges, hooks, agent tools)
  render/         pure view-model functions shared by web and TUI (run events -> transcript,
                  decision -> card, briefing -> sections). Golden-tested.
  release/        release directories on the daemon host: `<data>/releases/<stamp>-<sha>`, the
                  `current`/`previous` symlinks, clone-and-build, prune. Leaf: imports nothing.
  core/           the daemon's brain: wake queue, dispatcher, run engine, supervisor, sessions,
                  tickets, decisions, roles, workers, worktrees, openspec, knowledge, specs,
                  usage, threads, briefing, prompts, auth, forge, workspace loader
  server/         the process: Hono app, routes, two listeners, MCP endpoint, auth, SSE,
                  static UI serving, channel manager, plugin loading. `dist/bin.js` is the daemon.
  cli/            the `conductor` command tree (commander). `dist/bin.js` is the CLI.
  tui/            Ink components behind `conductor chat`, `conductor attach`, `conductor top`, `conductor specs explore`
  ui/             React 19 + Vite + Tailwind v4 web app; built to `dist/`, served by the daemon
  presenter/      the client-side reconciler behind `conductor presenter`
  runtimes/       claude, codex, opencode, gemini adapters
  channels/       web, cli, telegram
  surfaces/       headless, tmux, herdr, hyprland
skills/           agent-facing SKILL.md packages installed into agent homes (see skills/README.md)
templates/        always-loaded prompt templates: conductor/worker AGENTS.md, charter, brief, KB seeds
scripts/          guard-boundaries.mjs, guard-console.mjs (these are `pnpm lint`)
```

Dependency direction, enforced by `scripts/guard-boundaries.mjs`:

- `shared` imports **nothing** from `@agent-conductor/*`.
- The three SDKs may import `shared` only — never `core`, `db` or `server`.
- `core` may not import `server`, `cli`, `tui`, `ui`, `presenter`, or any runtime/channel/surface
  package. Adapters are reached through the registries on `WorkspaceContext`, never by import.

## Conventions

**ESM with explicit `.js` suffixes.** `module: NodeNext`. Every relative import ends in `.js`, even
though the source is `.ts`: `import { foo } from './foo.js'`. There is no bundler on the server side.

**Strict TypeScript.** `tsconfig.base.json` sets `strict`, `noUncheckedIndexedAccess`,
`isolatedModules`, `composite`, `declaration`. Project references, so `tsc -b` builds in order. No
`any` that survives review; prefer a narrow type or `unknown` plus a Zod parse at the boundary.

**Enums come from `packages/shared/src/enums.ts`.** Ticket statuses, agent statuses, decision kinds,
run event types, wake sources, worktree statuses, usage windows, UI statuses — all of them. Never
branch on a raw string literal, never invent a status, never spell one differently in prose, skills,
UI or DB. Config shapes come from `packages/shared/src/config.ts` (Zod), tool names from
`packages/shared/src/tools.ts`.

**Errors are `OcError` with a code from `ERROR_CODES`.** `throw new OcError('worktree_dirty', msg,
details, retryable)`. `OcError.status(code)` maps to HTTP; the API serialises
`{ error: { code, message, details?, retryable } }` and the CLI prints the code with a next step.
Agent tools return `ToolResult<T>` (`ok(data)` / `fail(err)`) rather than throwing.

**No `console` outside `cli`, `tui` and `ui`.** Enforced by `scripts/guard-console.mjs`. Everywhere
else use `getLogger(domain, bindings)` from `@agent-conductor/core` with a domain from `LOG_DOMAINS`;
it is pino, structured, to stderr (`log.info({ ...fields }, 'message')`). An unavoidable exception carries
an `ac-allow-console` comment on the line.

**Tests are vitest**, colocated as `src/**/*.test.ts` or under a package's `test/` directory (both
are in `vitest.config.ts`'s include); the web app's `.test.tsx` files run through `packages/ui/vitest.config.ts`, which `pnpm test` at the root also runs. Runtime adapters are tested against recorded `fixtures/*.jsonl`
event streams plus pure `buildArgs` unit tests — do not shell out to a real CLI in a test. Core is
tested with a fake runtime adapter that scripts events and results. Both vitest configs alias
`@agent-conductor/*` onto each package's `src/index.ts`, so `pnpm test` runs against sources and
needs no prior `pnpm build`.

**Style.** Match the file you are in. Short doc comments at the top of a module saying what it is and
which PLAN section it implements. Tables and imperatives over prose. Do not add tests, docs,
changelogs or formatting passes that were not asked for.

**Never** write into a project repo's own `AGENTS.md`/`CLAUDE.md` discovery files, never `git reset`
/ `clean` / `checkout` / `stash` in a worker's worktree, and never let a plugin override a core
invariant (checkout, approvals, project boundary).

## Running it locally

```bash
pnpm install
pnpm build                                # tsc -b everywhere
pnpm --filter @agent-conductor/ui build     # only when you touched the web app

pnpm test                                 # vitest run, whole repo
pnpm vitest run packages/core             # one package
pnpm lint                                 # boundary + console guards
pnpm typecheck                            # tsc -b tsconfig.json
```

Daemon, foreground, with a throwaway config dir:

```bash
XDG_CONFIG_HOME=/tmp/ac-dev node packages/server/dist/bin.js --listen 127.0.0.1:7433
# flags: --config-dir <dir>  --listen <host:port>  --ui-dir <dir>
# or:    pnpm dev
```

`--config-dir` beats `XDG_CONFIG_HOME`; both point at the directory holding `daemon.yaml`,
`workspaces.yaml`, `daemon.sqlite` and the `daemon.json` pid file. Set
`auth: { loopbackTrusted: true }` in that `daemon.yaml` to skip the password while developing.

CLI against it:

```bash
node packages/cli/dist/bin.js --url http://127.0.0.1:7433 doctor
node packages/cli/dist/bin.js --url http://127.0.0.1:7433 -w acme ticket list
# or link it once: cd packages/cli && pnpm link --global
```

Useful env vars: `AC_SKILLS_DIR`, `AC_TEMPLATES_DIR` (point the daemon at a checkout's `skills/` and
`templates/`; they default to repo-relative), `AC_UI_DIR`, `AC_LOOPBACK_PORT` / `AC_LOOPBACK_SOCKET`,
`AC_OPENSPEC_BIN`, `AC_LOG_LEVEL`, `AC_CONTEXTS_FILE`, `AC_API_URL`, `AC_TOKEN`, `AC_WORKSPACE`.

## Checklist before you call something done

- `pnpm lint && pnpm typecheck && pnpm test` are green.
- New statuses/kinds/codes live in `shared`, and nothing branches on a literal.
- New routes are in `docs/API.md`; new CLI commands are in PLAN §20 and the README cheat-sheet.
- New skills are in `skills/manifest.json` and `skills/README.md`, and something names their trigger.
- A deviation from `docs/PLAN.md` has an ADR in `docs/adr/`.

## Developing AgentConductor inside AgentConductor

This repo is itself a project in a running AgentConductor workspace, so a worker editing it is a
process spawned by the system it is changing. Rules that keep that sane:

- **The running daemon is a release, not a checkout.** It lives under
  `~/.local/share/agent-conductor/current`. Building in your worktree changes nothing that runs.
- **Never touch the live install**: not `~/.config/agent-conductor`, not the release dirs, not the
  systemd unit, not the port it listens on. `conductor daemon upgrade|rollback|stop|start` are
  human commands; they refuse to run inside a worker.
- **Test against throwaway daemons only**: `--config-dir <tmp> --listen 127.0.0.1:0` (or the
  loopback port of your choice), with `auth.loopbackTrusted: true` in that dir's `daemon.yaml`.
- **The test suite clears `AC_*` from the environment** (`vitest.setup.ts`), because your run's
  `AC_RUN_TOKEN` / `AC_API_URL` would otherwise point tests at the live daemon. Keep it that way.
- **Deliver through the ticket**: PR, plan, report. The human runs `conductor daemon upgrade`
  after the merge; that is the deploy step, and it is not yours.
