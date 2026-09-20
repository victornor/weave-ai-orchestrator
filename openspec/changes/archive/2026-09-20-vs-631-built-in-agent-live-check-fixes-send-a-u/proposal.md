## Why

The first real-endpoint turn of `weave repl` (codeify.cc, 2026-09-20, build eb1f8519a7) hit three defects every mock-provider test missed: provider requests send Node's default `User-Agent`, so a Cloudflare-fronted endpoint answers a bot challenge instead of the model; that challenge's HTML body is printed raw, hundreds of lines, once per retry; and the first upgrade to a release that adds a CLI shim does not write that shim because the old release's code performs the write. All three affect every built-in-agent worker on such an endpoint, not only the REPL.

Captain's own second run then failed `provider "codeify" is not configured` because a real key had been pasted into `apiKeySecret` (a secret *name* field), so the profile was skipped with no reason printed; and captain asked that `weave repl` work from any directory with a literal `apiKey` in the user's own `agent.yaml`, opencode-style, which relaxes VS-626's "a key is never written to disk" for exactly that file and case.

## What Changes

- **A default `User-Agent` on every provider request.** Chat completions, model discovery and the conformance probes send `User-Agent: weave-agent/<version>`, where `<version>` is the agent package's own version read at runtime (never a literal). A profile `headers` entry naming `user-agent` in any case replaces it, and exactly one such header is sent. It is a non-secret header in the redacted `debugWire` capture.
- **One-line error bodies.** `classifyHttp` reduces an HTML error body, or a plain-text body longer than a few hundred characters, to a single line: status, the page `<title>` when HTML, a note that the endpoint returned an HTML page (likely a bot challenge or a gateway error) and a hint to set a User-Agent header; otherwise the first 200 characters. The full body stays only in `debugWire`. An HTML body is classified family `tooling` and is not retried, so a challenge page is not retried.
- **The new release writes its own shims on the upgrade that introduces them.** After `current` flips, the upgrade runs the new release's own shim writer (a hidden `weave daemon write-shims`), so a shim the new release adds appears on the first upgrade to it. Applied on both the deferred daemon upgrade and the local `weave daemon upgrade` path. A machine already on eb1f8519a7 therefore gets `weave-agent` from this release's upgrade.
- **`weave repl --context-window <tokens>`** sets the run's `contextWindowTokens`; the unknown-context-window warning names the flag.
- **A literal `apiKey` in the user's `agent.yaml`.** `~/.config/weave/agent.yaml` (honouring `XDG_CONFIG_HOME`) MAY set a provider's `apiKey` to a literal key or a `${NAME}`/`{env:NAME}` reference, so `weave repl`/`weave-agent` work from any directory with no workspace. Resolution is first hit wins: the profile `apiKey`, then `WEAVE_LLM_<PROVIDER>_KEY`/`apiKeySecret` in the environment, then the workspace secret store; no `--api-key` flag is added. A literal `apiKey` in a workspace's `workspace.yaml` is rejected with a one-line message naming the field. The key never appears in output, argv, the bash environment, session files, `debugWire` or any error; a group/other-readable `agent.yaml` holding a plaintext credential gets one warning line with the mode and `chmod 600`, and still runs.
- **A skipped provider profile says why.** When a config-file provider fails validation and is the one requested, the `is not configured` message names the file, provider and field in one line and never echoes the field's value; a key-shaped value in `apiKeySecret` is the motivating case.
- **A first run shows a minimal config.** With nothing configured, `weave repl` prints a short how-to with a minimal `agent.yaml` (a provider with `baseUrl`, a literal `apiKey`, a `models` list and `provider`/`model` defaults) and says it works from any directory.
- **Docs** (`docs/running-the-agent-yourself.md`): the new flag and one-line HTML error text, that `--verbose` output goes to stderr while stdout carries only the final text, the key resolution order, and a minimal working `agent.yaml`.

## Capabilities

### New Capabilities
- none

### Modified Capabilities
- `builtin-agent`: provider requests carry a default User-Agent with a profile override, and an HTML or long error body is reduced to one line and an HTML body is classified non-retryable.
- `agent-repl`: the new release's own shim list applies on the upgrade that introduces a shim; a user-config literal `apiKey` with a defined resolution order, a workspace-wide refusal of it, a warning for a readable file, a skipped-provider reason and a first-run how-to; a `--context-window` flag; stdout carries only the final text in one-shot mode.

## Impact

- `packages/agent/src/profile.ts` (default User-Agent in `requestHeaders`), a new `packages/agent/src/version.ts`, `packages/agent/src/errors.ts` (body reduction and non-retryable HTML classification), `packages/agent/fixtures/errors/` (a challenge fixture and its table row).
- `packages/agent/src/repl/args.ts`, `repl/config.ts` (user-config `apiKey` schema, resolution order, skip reasons, mode warning, first-run how-to), `repl/run.ts`, `packages/agent/src/loop.ts` (warning text), `packages/cli/src/commands/repl.ts`.
- `packages/release/src/shim.ts` + `index.ts` (write shims for a named release), `packages/cli/src/commands/daemon.ts` (hidden `write-shims`, local upgrade path), `packages/server/src/upgrade.ts` (deferred upgrade path).
- `docs/running-the-agent-yourself.md`.
- No new dependency, no config schema change, no API route change, no key handled anywhere new.
- Unverified without a real endpoint: the weaver-run live check against codeify.cc with no `user-agent` in the profile (acceptance 6).