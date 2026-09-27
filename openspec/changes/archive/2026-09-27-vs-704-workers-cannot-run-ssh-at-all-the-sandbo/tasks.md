## 1. Config view

- [x] 1.1 Add a pure `materializeSshConfigView` (run directory, child's HOME, readable system config root) that writes a user-owned tree: `ssh_config` with `Include` paths under `/etc/ssh` rewritten into the tree, drop-ins copied with symlinks replaced by the regular file they point at, group/other write cleared, unreadable files skipped. Verify with a unit test on a temp fixture that a symlink drop-in becomes a regular file owned by the current uid, the rewritten Include does not mention `/etc/ssh`, an unreadable file is absent, and the child's `~/.ssh/config` is placed before the system text.
- [x] 1.2 Add a pure shim-argv builder that execs the absolute `ssh` resolved before the PATH prepend, adds a single `-F` of the combined file, and leaves argv unchanged when the caller already passed `-F` or `-Ffile`. Verify the unit test covers both branches and that the planned command is not a user-namespace wrapper.

## 2. Launch wiring

- [x] 2.1 On Linux, when the system client config is readable and `ssh` resolves, write the view under the run directory and prepend its `bin` on `TurnInput.env.PATH` in `packages/core/src/runs/engine.ts` so adapters that overlay that env (and weave's `toolEnvFor`) inherit it. If the config cannot be read or `ssh` is missing, leave PATH unchanged and still start the turn. Verify with an engine test that a Linux turn's env PATH starts with the view bin and a non-Linux (or unreadable-config) turn does not, and that a failed view does not throw.
- [x] 2.2 Confirm the shim is what a command sandbox inherits: a test that, when `bwrap`, `/usr/bin/ssh`, and `/etc/ssh/ssh_config` exist, runs the installed shim inside `bwrap --unshare-user` with the prepared PATH and asserts `ssh -G localhost` exits 0 and stderr does not contain `Bad owner or permissions`. Skip when those tools are absent. The test must not start or stop the daemon or a systemd unit.

## 3. Evidence

- [x] 3.1 Capture before/after `stat` of `/etc/ssh/ssh_config` and the drop-in, plus `ssh -G localhost` exit, from inside `bwrap --unshare-user` with and without the shim, and note the OpenCode worker observation (uid 0, exit 0, identity uid map). Put that block in the PR description. Do not launch `codex` or `opencode` against live credentials.
