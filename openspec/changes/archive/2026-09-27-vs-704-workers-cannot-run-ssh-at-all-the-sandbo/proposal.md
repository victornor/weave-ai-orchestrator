## Why

On 2026-09-26, an approved operational `ssh` died locally with `Bad owner or permissions on /etc/ssh/ssh_config.d/20-omarchy-keepalive.conf` (exit 255) before it connected. The host files are `root:root` 644. Codex's command sandbox is bubblewrap `--unshare-user`, which maps only the worker uid, so those files appear as overflow uid 65534 and OpenSSH refuses them. Every approved remote action from a sandboxed worker stalls the same way. This was misread as a policy block before (VS-378, VS-395).

## What Changes

- On Linux, the daemon gives every spawned turn an `ssh` that OpenSSH will accept inside a user-namespace sandbox, without editing host `/etc`, without shipping a host-specific drop-in, and without changing what a ticket is allowed to run.
- The daemon does not wrap the worker in a user namespace. That drops unmapped supplementary groups (`docker`, `wheel` become `nobody`) and is not the sandbox the daemon builds today. Codex hardcodes `--unshare-user`; there is no launch flag that maps uid 0.
- OpenCode's bash is not in a user namespace (`ssh -G localhost` already exits 0 there). The same launch-time view still applies, so both runtimes meet the acceptance check and a later CLI sandbox of the same shape does not regress.

## Capabilities

### New Capabilities

- `runtime-launch/ssh-config-view`: a Linux turn resolves `ssh` to a daemon-installed shim that execs the real binary against a user-owned copy of the host's client system config, so `ssh -G localhost` exits 0 inside a user namespace that shows `/etc/ssh` as overflow uid 65534.

### Modified Capabilities

- None.

## Impact

- Worker (and other agent) launch environment on Linux: a PATH shim and a generated config view under the run directory. No host `/etc` write, no permission-mode change, no new runtime dependency beyond the `ssh` already on the host.
- `packages/core` turn env construction, or `packages/runtime-sdk` if the view is built next to spawn. Unit tests of the pure builder. The PR description carries the before/after `stat` from inside a user namespace; tests do not start or stop the live daemon.
