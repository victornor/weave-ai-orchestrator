# Design — VS-399

## Decision 1: the guard keys on "loopback, non-default port, no isolation", not on a context name

The incident's context was `vs378scratch`, but no name-based rule can catch the next one. What makes
a login a scratch-daemon login is purely the address: the daemon nobody else depends on is a
loopback URL on a port other than the configured default (`7433`, `contexts.ts` `DEFAULT_URL`). The
default-port loopback daemon is the ordinary `local` context and must keep working.

The other half of the predicate is *which file would be written*. `contextsPath()` already honours
`AC_CONTEXTS_FILE`; if it is set, the write is isolated and the guard is a no-op. So the guard fires
exactly when all three hold: loopback host, non-default port, and no `AC_CONTEXTS_FILE`.

## Decision 2: refuse for the whole login, before any request — with an explicit escape hatch

The guard runs at the top of the `login` action, beside the existing plaintext-`http` refusal, so a
mistake fails before a password is prompted or sent. It names `AC_CONTEXTS_FILE` and the override.

The override is `--allow-default-contexts`, not a bare `--force`: it states the intent (write to the
host's shared file anyway) rather than merely "ignore the last safety check". A worker who does mean
to log the host CLI into a scratch daemon can still do it deliberately.

**Trade-off.** The guard is a heuristic: a developer who genuinely runs a second real daemon on
loopback on another port (say `:7434`) now needs `--allow-default-contexts` or an isolated
`AC_CONTEXTS_FILE` to log into it. That is a rare, explicit act, and the flag keeps it possible; the
incident it prevents is silent, host-wide, and outlives the worker. A guard that cannot be bypassed
deliberately would be worse, because there are legitimate second-daemon setups.

## Decision 3: the helper's env is generated and printed, not just documented

`scripts/scratch-daemon.sh` derives the three variables from `--dir` and exposes them as a `env`
subcommand that prints `export …` lines, which `start` also prints. The helper cannot intercept a
`weave` command a worker types by hand, so the next best thing is one copy-pastable line, generated
from the same `--dir` the daemon uses and therefore impossible to get wrong.

The isolated paths live under the scratch dir (`<dir>/cli/contexts.yaml`, `<dir>/cli-config`,
`<dir>/cli-state`), so `stop`/`rm -rf` of the scratch dir removes them and nothing accumulates.

## Decision 4: the test guard is the same two-layer shape as VS-388

VS-388 guarded host lifecycle commands with `AC_TEST_GUARD` and isolated `XDG_CONFIG_HOME`. The same
two layers apply here: the setup pins `AC_CONTEXTS_FILE` at a throwaway path (the first layer — a
test that reaches `putContext` writes there), and it stays under the throwaway `XDG_CONFIG_HOME`
(the second layer — `contextsPath()`'s fallback also resolves inside the temp dir). A test that
forgets to isolate cannot reach the host's file by either path.

## Decision 5: how the guard is proven

- `packages/cli/src/scratch-daemon.test.ts`: the helper's `env` output carries an
  `AC_CONTEXTS_FILE` resolved under the scratch dir, and never the host path.
- `packages/cli/src/contexts.test.ts`: `assertLoginContextIsolation` refuses a loopback non-default
  port with no `AC_CONTEXTS_FILE`, and allows the default port, a remote host, an isolated
  `AC_CONTEXTS_FILE`, and the explicit override.
- `packages/cli/src/contexts-isolation.test.ts`: with the suite's own environment,
  `contextsPath()` resolves under the OS temp dir — the setup never lets a test touch the real file.
