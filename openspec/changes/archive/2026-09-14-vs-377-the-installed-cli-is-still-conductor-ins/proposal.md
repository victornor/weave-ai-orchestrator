# Install a `weave` command on PATH, keep `conductor` as a deprecated alias

Tracker change for [VS-377](weave://tickets/VS-377). A `task` ticket, so this change carries tasks only — `skip_specs: true`.

## Why

Captain went to the CLI after the `agent-conductor` → `weave-ai` rename and found there is still no
`weave` command: the host only has the 2026-09-04 `~/.local/bin/conductor` shim the original installer
wrote, whose comment still reads "AgentConductor CLI". On `main` the CLI package's bin and the
commander program name are both `weave`, but nothing in the install or upgrade path writes a PATH shim
for it — the rename missed the installer. So a host that upgrades keeps an old-named, old-worded
command, and no one can type `weave`.

## What Changes

- `weave daemon install-service` / `install-launchd` and both upgrade paths (`weave daemon upgrade`
  and the deferred `daemon update apply`) write `~/.local/bin/weave`, pointing at the `current`
  release's `packages/cli/dist/bin.js` with the same node the daemon uses. The comment says
  `Weave AI CLI` and `weave daemon upgrade`; the write is idempotent and only touches the file when
  its bytes change. The upgrade path creates it when missing, so an existing host gets it on its next
  upgrade.
- An existing `~/.local/bin/conductor` shim is rewritten to the same target, and its shell prints one
  line to stderr: `conductor is now weave; this alias will be removed later`. A fresh install creates
  no `conductor`.
- `weave doctor` checks the shim: missing, or present but pointing at something other than the current
  release, is a failing check with the command that fixes it.
- The `conductor` argument spelling is dropped as the primary name of the weaver control
  (`models set|inherit conductor`, `daemon models set conductor`) in favour of `weaver`; `conductor`
  stays accepted as a deprecated input and warns once on stderr.
- `README.md` and `docs/OPERATIONS.md` describe the shim as written by install/upgrade and mention the
  alias once.

## Capabilities

None. This is host-local install plumbing and CLI arg spelling, not stated behaviour: no capability
under `openspec/specs/` describes the PATH shim or the CLI control name, and a spec would have to
invent a requirement about a 271-byte shell file. `skip_specs: true` is set in `.openspec.yaml`.

## Impact

- `packages/release/src/shim.ts` (new) and its export from `index.ts` — the shim renderer/writer,
  shared by the CLI and the daemon's deferred upgrade; still a leaf (node builtins only).
- `packages/cli/src/daemon.ts` — `installService`/`installLaunchdAgent` write the shim.
- `packages/cli/src/commands/daemon.ts` — `daemon upgrade` writes the shim after the switch;
  `daemon models` prefers `weaver`, accepts a deprecated `conductor`.
- `packages/cli/src/commands/doctor.ts` — the shim check.
- `packages/cli/src/commands/models.ts` — `weaver` primary, deprecated `conductor`.
- `packages/server/src/upgrade.ts` — a `writeShims` seam called after the deferred switch.
- Tests: `packages/release/src/shim.test.ts`, `packages/cli/src/daemon.test.ts`,
  `packages/cli/src/doctor-command.test.ts`, `packages/cli/src/program.test.ts`,
  `packages/server/test/upgrade*.test.ts` (fixtures stub the seam).
- No schema, migration, route, config or wire change. No release directory, unit or live
  `~/.local/bin` is touched by a test: every test redirects `HOME`/`XDG_*` to a temp directory.
