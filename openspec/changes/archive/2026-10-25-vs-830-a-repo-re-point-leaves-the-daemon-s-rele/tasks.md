## 1. Detection in the update status

- [x] 1.1 `packages/server/src/release-info.ts`: report `runtimeSource` on `UpdateStatus` — the release directory's `origin`, normalized with `githubSshRemote`, `null` when the release carries no recoverable origin. Unit test over a temp release dir with a real `git init` + `remote add origin`.
- [x] 1.2 `release-info.ts`: accept an injected `projects` reader and report `staleSource` when the configured source equals `runtimeSource`, a ready project's `gitUrl` differs from it, and the running release's commit is present in that project's clone. Tests: stale, already moved, independent source, no matching project, unknown runtime source, unreachable release root.
- [x] 1.3 `release-info.test.ts`: the stale report is additive — a stale source that resolves to the running commit still reports no update available, and a failing resolve still reports the mismatch.

## 2. Changing the release source from the daemon

- [x] 2.1 `packages/server/src/release-info.ts`: `UpdateChecker.invalidate()` (or an equivalent) so the cached answer is dropped when the source changes.
- [x] 2.2 `packages/server/src/routes/daemon.ts`: `PATCH /api/daemon/update/source` — validate with `resolveRemoteSha` (reachable source, existing ref; `source: null` clears), mutate `deps.daemon.upgrade`, persist via `workspaceLoader.writeDaemonConfig` over the re-read file, invalidate the cache, answer with the fresh status. `validation` error when `deps.daemonConfigDir` is absent. Register in `routetable.ts` as operator-only `mutating`.
- [x] 2.3 Server route tests: accepted source is reported by the next status read and used by a following upgrade request; unreachable source and missing ref are refused with nothing changed; no config dir is refused; the change is written to `daemon.yaml`.
- [x] 2.4 `packages/cli/src/commands/daemon.ts`: `weave daemon update source <url> [--ref <ref>] [--clear] [--json]`, plus a stale-source warning line in `weave daemon update`'s human output. CLI test through the existing fetch stub.

## 3. The re-point reports the release source it left behind

- [x] 3.1 `packages/server/src/routes/projects.ts`: after a successful `PATCH /projects/:id` that changed `url`, include `releaseSource: { previousUrl, currentUrl } | null` in the response when the previous URL names the daemon's release source. Route test with a stubbed project service and daemon config.
- [x] 3.2 `packages/cli/src/commands/project.ts`: after an update that changed the URL, print the hint that the daemon's release source still names the old URL and how to change it.

## 4. Settings surfaces

- [x] 4.1 `packages/ui/src/api/{types,hooks}.ts`: the new `UpdateStatus` fields, `useSetReleaseSource`, and the `releaseSource` field on the project update response.
- [x] 4.2 `packages/ui/src/settings/sections.tsx` (Release): render a stale-source warning naming the old source, the project's current URL and a repair button; show the server's error on refusal and clear the warning on success. Component test with a stubbed status.
- [x] 4.3 `packages/ui/src/settings/sections.tsx` (Projects): after a re-point the response reports `releaseSource`, show the offer, and take it through the same mutation. The source is never changed without the offer being taken. Component test.

## 5. Docs and verification

- [x] 5.1 `docs/OPERATIONS.md`: under the `upgrade:` block and the deferred-upgrade section, state that the release source is separate from a project's repo URL, that re-pointing a project does not move it, how the stale warning shows up, and how to change the source (Settings, `PATCH`, `weave daemon update source`). Also state that writing the source rewrites `daemon.yaml` and drops its comments.
- [x] 5.2 Run the typecheck, lint and both test suites; report both suite blocks verbatim.
