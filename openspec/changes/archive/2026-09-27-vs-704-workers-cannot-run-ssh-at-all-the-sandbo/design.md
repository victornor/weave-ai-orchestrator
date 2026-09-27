## Context

See proposal.md for why. Confirmed on this host on 2026-09-26, without launching a coding CLI:

- `bwrap --unshare-user` (the flag Codex hardcodes in `linux-sandbox/src/bwrap.rs`) maps only the current uid. `stat` of `/etc/ssh/ssh_config` and `20-omarchy-keepalive.conf` reports uid 65534 (`nobody`). `ssh -G localhost` exits 255 with `Bad owner or permissions on /etc/ssh/ssh_config.d/20-omarchy-keepalive.conf`.
- The same files on the host, and in this OpenCode worker (identity uid map, not a user namespace), are uid 0 mode 644. `ssh -G localhost` exits 0 here.
- A worker-wide `bwrap --unshare-user` drops unmapped groups: host `docker` and `wheel` become `nobody`. `--uid 0 --cap-drop ALL` around the worker makes a nested `bwrap --unshare-user` fail with `setting up uid map: Operation not permitted`. Codex always passes `--unshare-user` and then applies seccomp; a nested namespace is the wrong place to depend on.
- An overlay of user-owned, symlink-dereferenced copies bind-mounted on `/etc/ssh` makes `ssh -G` exit 0 and keeps `serveraliveinterval 15` from the omarchy drop-in. That overlay requires a user namespace to mount, which is the group-dropping option above.
- A PATH shim that execs `/usr/bin/ssh -F <user-owned combined config>` exits 0 inside `bwrap --unshare-user`, keeps `tcpkeepalive yes`, and lets a child's `User` win. The real `/etc/ssh` file in that namespace is still uid 65534; the shim never stats it.

The daemon does not build Codex's sandbox. It selects `--sandbox workspace-write` (or `read-only`). The fix is the environment the daemon hands the turn, which the CLI's sandbox inherits.

## Goals / Non-Goals

**Goals:**

- `ssh -G localhost` exits 0 inside the user-namespace shape Codex uses, and still exits 0 for OpenCode.
- Preserve system client settings, including drop-ins reached through symlinks, and the child's own `~/.ssh/config` precedence.
- Leave host `/etc`, permission mode, and supplementary groups unchanged.

**Non-Goals:**

- Wrapping the worker or the CLI in a user namespace.
- Editing `/etc`, shipping an omarchy drop-in, or disabling Codex's sandbox.
- Changing which hosts a ticket may ssh to. `action_approval` and the charter still decide that.
- Launching `codex` or `opencode` against live credentials to prove it. The sandbox shape is reproduced with `bwrap --unshare-user`.

## Decisions

### A PATH shim with `-F`, not a mount overlay

OpenSSH ignores `/etc/ssh/ssh_config` when `-F` is set, and accepts a file owned by the current uid. The shim is a mode-755 script in the run directory. It execs the absolute `ssh` resolved before the PATH prepend, so it cannot recurse. Arguments are passed quoted (`"$@"`).

Rejected: bind-mounting a user-owned `/etc/ssh` over the host path. It works, but the mount needs a user namespace around the process Codex's `--ro-bind / /` captures, and that namespace drops `docker` and `wheel`. Rejected: `--uid 0` so OpenSSH's root check passes. Nested bwrap then cannot set up its uid map, and the process appears as root inside the namespace.

### Combined file order matches OpenSSH

OpenSSH uses the first obtained value, and reads the user file before the system file. The `-F` file starts with `Include <childHome>/.ssh/config` (an absolute path; `Include ~/.ssh/config` only when the child's HOME is unknown) and then the materialized system config. The user file is not pasted in: a `Host` block stays open until the next `Host` or `Match`, so inlined text that ends inside `Host s1` would scope the system Include and keepalive settings to that host only. `Include` of a separate file does not. Do not read the daemon user's real home when the child's HOME is different — OpenCode sets HOME to the runtime config home, and pointing Include at `/home/user/.ssh` from there would widen what that turn's ssh can see.

`Include` paths under `/etc/ssh` are rewritten to the materialized tree. Symlinks are copied as the regular file they point at, owned by the turn uid, mode preserved but with group/other write cleared. Unreadable files (host private keys) are skipped. The tree is not shipped; it is generated at spawn from whatever the host has.

If the caller already passed `-F` (as its own argument or as `-Ffile`), the shim execs the real binary with the original argv.

### Installed on `TurnInput.env.PATH`

`packages/core/src/runs/engine.ts` already builds the turn env that adapters overlay (`childEnv(overlay)`, and weave's `toolEnvFor` copies `input.env` after the base PATH). Prepend `<runDir>/ssh-view/bin` there on Linux when the view was written. Every runtime that shells out inherits it, including Codex's bwrap, which inherits the environment. Non-Linux: no view, PATH unchanged.

If `/etc/ssh/ssh_config` cannot be read, or `ssh` does not resolve, write nothing and do not fail the turn.

### Tests stay off the live daemon

Pure tests cover materialize (symlink dereference, Include rewrite, user-config-first, skip unreadable, not group-writable) and the shim argv (`-F` added once, absent when the caller passed `-F`, no user-namespace wrapper). When `bwrap`, `/usr/bin/ssh`, and `/etc/ssh/ssh_config` exist, one test runs the shim inside `bwrap --unshare-user` and asserts exit 0 and that stderr does not contain `Bad owner or permissions`. Skip that test when the tools are absent, so a host without bubblewrap still passes the pure tests. No test starts or stops the daemon or a systemd unit.

The PR description pastes the before/after `stat` and `ssh -G` exit from that namespace, and the OpenCode worker observation (uid 0, exit 0) from this investigation.

## Risks / Trade-offs

- [A runtime puts its own `ssh` ahead of PATH] → The shim dir is prepended on the env the CLI inherits. Apply checks `command -v ssh` inside the bwrap reproduction is the shim. If a runtime is later found to shadow it with a copy of `/usr/bin/ssh`, that shadow is a follow-up, not a reason to wrap the worker.
- [`-F` skips a system behavior we failed to copy] → The bwrap test asserts exit 0 and the absence of the owner error; the PR stat block includes a drop-in setting (`serveraliveinterval`) so a rewrite that drops includes is visible.
- [Shim is a shell script] → It only execs, with `"$@"`, and the real binary is an absolute path baked in at spawn. It does not parse ssh config itself.
- [Codex seccomp blocks something the shim needs] → The shim is a shell script plus `ssh -F`. It does not call `unshare` or `bwrap`. Seccomp that allows `ssh` allows the shim.

## Migration Plan

No data migration. A running turn keeps the old PATH until it ends; the next spawn gets the view. Rollback is reverting the commit. Host `/etc` is never written.

## Open Questions

None. The group-dropping namespace was measured and rejected; the `-F` shim was measured inside `bwrap --unshare-user` and exits 0.
