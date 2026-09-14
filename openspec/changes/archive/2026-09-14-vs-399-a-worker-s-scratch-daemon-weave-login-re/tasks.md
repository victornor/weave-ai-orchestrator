# Tasks — VS-399

## 1. Isolate every CLI call the scratch helper enables

- [x] 1.1 `scripts/scratch-daemon.sh`: derive `AC_CONTEXTS_FILE`, `XDG_CONFIG_HOME` and
  `XDG_STATE_HOME` under `--dir`, add an `env` subcommand that prints the `export` lines, and print
  them from `start` too. `scripts/scratch-daemon.test.ts`: `env` resolves `AC_CONTEXTS_FILE` under
  the scratch dir, never the host's config home.

## 2. `weave login` refuses to repoint the host CLI at a scratch daemon

- [x] 2.1 `packages/cli/src/contexts.ts`: `assertLoginContextIsolation(url, {allowDefaultContexts})`
  refuses a loopback URL on a non-default port when `AC_CONTEXTS_FILE` is unset, naming that variable
  and the override; no-op for a remote host, the default port, an isolated file, or the override.
- [x] 2.2 `packages/cli/src/commands/auth.ts`: call it at the top of `login`, and add the
  `--allow-default-contexts` option. `contexts.test.ts` covers every branch.

## 3. The test suite can never write the host's contexts file

- [x] 3.1 `vitest.setup.ts`: after the marker and throwaway `XDG_CONFIG_HOME`, set `AC_CONTEXTS_FILE`
  to a throwaway path under the temp dir.
- [x] 3.2 `packages/cli/src/contexts-isolation.test.ts`: the suite's `contextsPath()` resolves under
  the OS temp dir.

## 4. Guidance

- [x] 4.1 `CLAUDE.md`: scratch CLI calls use the helper's isolated env; never `weave login`/
  `weave context use` against the host's contexts.
- [x] 4.2 `skills/weave-ai-worker/SKILL.md`: same rule where a worker reads about scratch config
  dirs.

## 5. Verify

- [x] 5.1 `pnpm lint && pnpm typecheck` clean.
- [x] 5.2 Both suites green; paste both suite blocks verbatim in the report.
