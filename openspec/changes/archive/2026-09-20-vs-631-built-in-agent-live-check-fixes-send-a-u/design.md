## Context

See `proposal.md` — Why. Three live-check defects sit at three seams that the mock-provider tests never exercised: the request header set (`packages/agent/src/profile.ts` → `requestHeaders`, used by the loop, the probe and both discovery paths), error classification (`packages/agent/src/errors.ts`), and which release's code writes the CLI shims during an upgrade (`packages/server/src/upgrade.ts`, `packages/cli/src/commands/daemon.ts`). Two small REPL gaps sit beside them.

The agent package depends on `@weave-ai/shared` only, and `@weave-ai/release` is a leaf (node builtins only); the dependency-direction guard is not relaxed by this change.

## Goals / Non-Goals

**Goals:**
- One change makes the built-in agent usable behind a Cloudflare-fronted OpenAI-compatible endpoint with no per-profile `user-agent` workaround.
- The same classification shortening reaches the daemon's worker error text, not only the REPL's printing.
- A shim a release adds is present after the upgrade that introduces it, on both upgrade paths.
- `contextWindowTokens` is settable from the REPL; the one-shot stream split is documented and asserted.

**Non-Goals:**
- No browser or third-party User-Agent spoofing; only the product's own `weave-agent/<version>`.
- No retry-policy redesign and no new error family; HTML bodies reuse the existing `tooling` family.
- No `weave` self-heal on every invocation, and no change to the shared `ProviderProfileSchema` or the daemon's provider routes: a literal `apiKey` is a REPL-only, user-`agent.yaml`-only field.
- No `--api-key` flag (it would land in argv) and no new config location; the workspace secret store and its redaction behave as before.

## Decisions

### 1. User-Agent value: the agent package's own version
`weave-agent/<version>` where `<version>` is read at module load from `packages/agent/package.json` (a new `version.ts`, via `createRequire(import.meta.url)('../package.json')`, falling back to `0.0.0` if unreadable). It is the "package" option the ticket allows, and it is a constant of the code that makes the request, so both a standalone REPL and a daemon child report the same value without threading anything through the protocol.

*Alternatives considered:* adding a version field to `init` (more protocol surface; the probe and discovery paths in the adapter have no `init` at all); reading the release sha from the release directory (`releaseSha` lives in `@weave-ai/release`, which the agent package must not import).

### 2. One header, applied where every provider request is built
`requestHeaders(provider)` builds defaults, then merges `provider.headers`. A profile `headers` key matching `/^user-agent$/i` replaces the default and is emitted in the profile's own casing; otherwise the default is added. Because the loop, `probe.ts`, `repl/commands.ts` model discovery and `runtimes/weave` discovery all already call `requestHeaders`, one change covers chat completions, both model-discovery paths and the conformance probes. The wire log already writes request headers with secret-looking names redacted; `user-agent` matches none of `SECRET_HEADER`'s words, so it is recorded as a non-secret header unchanged.

### 3. HTML bodies: shorten in the classifier and mark them non-retryable
`classifyHttp` first reduces the body to a one-line message (a helper): HTML is detected from the trimmed body starting with a tag and a `<title>` extracted and collapsed; a plain body over a few hundred characters is cut to 200. The reduced message is also re-checked, so an OpenRouter `metadata.raw` that is HTML gets the same treatment. When HTML, classification returns code `html_error`, family `tooling`, `maxRetries: 0`, before the status rows — so a 5xx challenge page is not retried. The full body is untouched in the `debugWire` capture.

*Alternatives considered:* keep status-based classification and only shorten the message — rejected because the live bug retried the challenge pointlessly; special-case only challenge titles — rejected as fragile, since a proxy's HTML page is equally not a provider API answer, and repeating the request returns the same page. *Trade-off:* a genuine transient 5xx served as HTML is no longer retried; accepted because an OpenAI-compatible endpoint answering HTML means the request never reached the provider API.

### 4. Shim: the new release writes its own shims after `current` flips
Add a hidden `weave daemon write-shims` command that calls `writeUserShims()` from that release's code. Add `writeShimsFromRelease(releasePath, io?)` in `@weave-ai/release` that spawns `process.execPath <releasePath>/packages/cli/dist/bin.js daemon write-shims` when that bin exists, and otherwise falls back to the in-process `writeUserShims()`. The deferred upgrade (`packages/server/src/upgrade.ts`) calls it with `built.path` after `switchTo`; the local upgrade (`packages/cli/src/commands/daemon.ts`) calls it after `switchRelease`. Both are best-effort, as the current call already is: a failure logs and never fails an upgrade that switched.

*Alternatives considered:* the new release's `upgrade-runner` writes them — it is new code and already runs, but only on the deferred path, not `weave daemon upgrade`; having `weave` ensure its shims on every invocation — writes to the user's home on every CLI call, including worker runs, and does not satisfy "from this release's upgrade". *Forward compatibility:* a target release that predates the new command makes the spawn fail, and the in-process writer runs exactly as before, so upgrading to an older ref is unchanged.

### 5. `--context-window` seeds the run parameters
Parse `--context-window` in `repl/args.ts` and the commander command as a positive integer into `ReplConfig`/`ReplState.params.contextWindowTokens`; `buildReplInit` already flows `state.params` through `resolveProvider` into `init.provider.params`, which the loop reads as its options. The loop's unknown-window warning text gains "…or pass --context-window to weave repl". An invalid value is a note and no turn runs, matching `/model contextWindowTokens`'s refusal.

### 6. `--verbose` stream split
The split is already correct (`runOneShot` writes rendered events to `io.stderr` and `r.finalText` to `io.stdout`); the live check merged the two streams in a terminal. This change keeps the existing end-to-end assertion and adds the docs line, plus an assertion that stdout carries the final text exactly once.

### 7. `apiKey` stays out of the shared profile schema
The user's own `agent.yaml` is parsed with a REPL-local `AgentProviderProfileSchema = ProviderProfileSchema.extend({ apiKey: z.string().optional() })`; `workspace.yaml` keeps parsing with the shared `ProviderProfileSchema`, and a raw provider object that carries an `apiKey` key there is skipped with a one-line message naming the field (`apiKeySecret` or the environment instead). `ProviderProfile` in `@weave-ai/shared` is unchanged, so the daemon's provider routes and the workspace config are untouched and can never store a literal key.

*Alternatives considered:* adding `apiKey` to the shared schema (the daemon's `PUT /providers/:id` and the workspace yaml writer would then accept and persist a literal key — exactly what requirement 3 forbids); a separate `agent.yaml` type entirely (more churn for one extra optional field).

### 8. Key resolution and reference syntax
`resolveApiKey` gains the profile's `apiKey` as its first source. A value matching `${NAME}` or `{env:NAME}` is resolved from the environment (`${NAME}` reuses the existing `REF` handling shape); an unresolved reference is treated as no key, with the message naming the variable. Then the existing order: `apiKeySecret` name, then `WEAVE_LLM_<PROVIDER>_KEY`, in the environment, then the workspace secret store, then the hidden terminal prompt. `--api-key` is deliberately not added (argv). The literal value is already excluded from argv, the tool environment and session files by the existing construction; the new path must also be excluded from the redaction list only in the sense that it is already `profile.apiKey` used as the `authorization` header — the wire log redacts it by header name, and the REPL renderer already masks the key.

### 9. Skip reasons, the readable-file warning and the first-run how-to
`providersFrom` records a per-provider skip reason (file, provider, failing field path) in a new `ReplConfig.providerErrors` map, sanitised so a Zod issue message is reduced to the field path and a generic explanation — never interpolated with the rejected value. `startup` consults it when the chosen provider is missing or skipped, so the `is not configured` line carries the reason; notes are otherwise still only printed under `--verbose`. The mode warning is a `statSync(file).mode & 0o077` check when the user config holds a plaintext credential (literal `apiKey`, or an `apiKeySecret` that fails the secret-name pattern), printed once to stderr with the octal mode and `chmod 600 <file>`. The no-provider startup message is replaced by a short how-to containing the minimal `agent.yaml`. Interactive provider-adding from `/model` is **out of scope** (the ticket allows skipping it when not small): `/model` already changes model and parameters, and a config writer is more surface than this ticket needs.

## Risks / Trade-offs

- [Spawning node from the daemon after the switch] → best-effort with a short timeout and an in-process fallback; a failure leaves the shim for the next upgrade or `weave doctor`, never a failed upgrade.
- [HTML bodies no longer retried] → stated trade-off above; the message tells the operator what to change.
- [Reading `package.json` relative to the module] → the path is the same from `src/` and `dist/` inside a release; a read failure falls back to `0.0.0` rather than throwing.
- [New `html_error` code in the failure table] → covered by a new spec requirement and a checked-in fixture row.
- [A literal key in a user file readable by others] → warned once with the mode and `chmod 600`, never refused (captain's decision); the value still never reaches any log, error or transcript, including the skip-reason path, which reports the field name only.
- [Skip reasons could leak a value through a Zod message] → the reason is rebuilt from the issue's field path and a fixed explanation, never from the received value, and the redaction test uses a key-shaped value to prove it.

## Migration Plan

Pure code change; ships in the next release. No data migration. A host already on eb1f8519a7 gets `weave-agent` when it upgrades to this release, because the new release's writer runs after the flip. `weave doctor`'s existing shim check remains the manual repair path.

## Open Questions

None.