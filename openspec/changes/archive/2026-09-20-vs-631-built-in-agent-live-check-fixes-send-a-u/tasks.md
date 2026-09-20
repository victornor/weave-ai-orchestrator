## 1. Default User-Agent on provider requests

- [x] 1.1 Add `packages/agent/src/version.ts` exporting the agent package version and `agentUserAgent()` (`weave-agent/<version>`), read from the package's own `package.json` with a safe fallback. Verify: a unit test asserts the value equals `weave-agent/` + `packages/agent/package.json`'s version and contains no hard-coded literal.
- [x] 1.2 `profile.ts` `requestHeaders` sends the default User-Agent, and a profile `headers` key matching `user-agent` in any case replaces it with exactly one header. Verify: unit tests for the default, the override in a different case, and the header count.
- [x] 1.3 Prove it at the requests that matter: a loop test against `testkit/mockProvider` asserts `user-agent: weave-agent/<version>` on the chat request; the probe test asserts it on the models-list request; the `runtimes/weave` discovery test asserts it on `GET {baseUrl}/models`. (Acceptance 1.)

## 2. One-line error bodies and no retry for HTML

- [x] 2.1 Check in a small Cloudflare challenge fixture (with a `<title>Just a moment...</title>`) and a long plain-text fixture under `packages/agent/fixtures/errors/`, and add their rows to `table.json`. Verify: the table test names the expected code, family and message.
- [x] 2.2 `errors.ts` reduces HTML and over-long plain bodies to one line (status, title, HTML/UA-hint note; else first 200 characters) and classifies HTML as `html_error`/`tooling`/`maxRetries: 0` before the status rows. Verify: the challenge fixture is one line naming status, title and the User-Agent hint, `isRetryable` is false, and the old code would have retried it.
- [x] 2.3 Verify the full HTML body survives only in `debugWire`: a loop test with `debugWire` and a retryable-status HTML reply asserts the wire file holds the body while the turn error is the one-liner. (Acceptance 2.)

## 3. The new release writes its own shims on the introducing upgrade

- [x] 3.1 Add a hidden `weave daemon write-shims` command that runs `writeUserShims()` and emits its result. Verify: a command test writes both shims from a temp release whose REPL entry exists.
- [x] 3.2 Add `writeShimsFromRelease(releasePath)` in `@weave-ai/release`: spawn the release's own CLI `daemon write-shims` when its bin exists, else fall back to the in-process `writeUserShims()`. Verify: a unit test with a fake release bin records the spawn and a missing bin falls back.
- [x] 3.3 The deferred upgrade (`packages/server/src/upgrade.ts`) invokes the new release's writer with `built.path` after `switchTo` (change the `writeShims` seam to take the release path). Verify: the upgrade-service test asserts the seam is called with the new release after the switch.
- [x] 3.4 The local `weave daemon upgrade` (`packages/cli/src/commands/daemon.ts`) invokes it after `switchRelease`. Verify: the command test asserts the new release's writer runs.
- [x] 3.5 Simulate the introducing upgrade: a shim test where a release lacking `weave-agent` is replaced by one that ships it asserts `weave-agent` appears, pointing at the new release's REPL entry. (Acceptance 3.)

## 4. REPL flag and stream split

- [x] 4.1 Add `--context-window <tokens>` through `repl/args.ts`, `repl/config.ts`, `repl/run.ts` (`state.params.contextWindowTokens`) and `packages/cli/src/commands/repl.ts`. Verify: a positive integer reaches `init.provider.params.contextWindowTokens`; `0`, a negative and a non-number are refused with a note and no request is sent.
- [x] 4.2 Update the loop's unknown-context-window warning to name `--context-window`; verify a REPL run with the flag logs no warning and one without it names the flag.
- [x] 4.3 Extend the `-p --verbose` end-to-end test to assert stdout is exactly the final text and every rendered event is on stderr. (Acceptance 4.)

## 5. A literal key in the user config, skip reasons and a first run

- [x] 5.1 Parse the user's `agent.yaml` providers with a REPL-local schema that adds an optional `apiKey` (a literal or a `${NAME}`/`{env:NAME}` reference resolved from the environment); keep the shared `ProviderProfileSchema` untouched. Verify: a provider with a literal `apiKey` loads and resolves the key; an unresolved reference reports the variable name and no key.
- [x] 5.2 Resolve the key first hit wins: profile `apiKey`, then `WEAVE_LLM_<PROVIDER>_KEY`/`apiKeySecret` in the environment, then the workspace secret store, then the hidden prompt; no `--api-key` flag. Verify: unit tests for each rung and the order.
- [x] 5.3 Reject a literal `apiKey` in a `workspace.yaml` provider with a one-line message naming the field and pointing at `apiKeySecret` or the environment, without the value. Verify: a config test with `sk-test-...` in a workspace file asserts the field is named and no part of the value appears.
- [x] 5.4 Surface the skip reason when the requested provider is the one skipped (file, provider, failing field, no value); keep other notes under `--verbose`. Verify: the `apiKeySecret`-holds-a-key case prints the reason in one line and the redaction test passes.
- [x] 5.5 Warn once, without the value, when the user's `agent.yaml` is group/other-readable and holds a plaintext credential (literal `apiKey`, or an `apiKeySecret` that is not a valid secret name): name the mode and `chmod 600 <file>`, and still run. Verify: tests for mode 0644 (warns) and 0600 (silent).
- [x] 5.6 Replace the no-provider message with a short how-to containing the minimal `agent.yaml` (provider `baseUrl` + literal `apiKey`, a `models` list, `provider`/`model` defaults) and the any-directory note; skip interactive provider-adding in `/model`. Verify: a no-config run exits 2, prints the example, and sends no request.
- [x] 5.7 End-to-end test under a scratch `HOME`/`XDG_CONFIG_HOME` with only `agent.yaml` (literal `apiKey`) and no workspace above the cwd, against `testkit/mockProvider`: the request carries the bearer key, and the key appears in no stdout, stderr, argv, session file or `--verbose` transcript.

## 6. Docs and suite

- [x] 6.1 Update `docs/running-the-agent-yourself.md`: a minimal working `agent.yaml` for an OpenAI-compatible endpoint with `apiKey`, a `models` list and `provider`/`model` defaults; that it works from any directory; the key resolution order; the literal-key-is-user-config-only rule and the readable-file warning; `--context-window`; that `--verbose` output goes to stderr while stdout is only the final text; and the one-line HTML error text. (Acceptance 5, 7.)
- [x] 6.2 Run `pnpm lint && pnpm typecheck`; run one full `pnpm test` with `--maxWorkers=4` and paste both suite blocks verbatim in the delivery report. (Acceptance 7.)
- [x] 6.3 State in the delivery report that acceptance 6 — the weaver-run live check against codeify.cc with no `user-agent` in the profile — is unverified by a worker and must be run after the next upgrade.