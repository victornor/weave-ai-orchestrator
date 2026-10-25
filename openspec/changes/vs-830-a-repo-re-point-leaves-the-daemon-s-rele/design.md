## Context

- `upgrade.source`/`upgrade.ref` live in `daemon.yaml` and are read through the live `DaemonConfig` object the daemon holds (`deps.daemon.upgrade`), which `createUpdateChecker` and `createUpgradeService` both capture by reference. `packages/server/src/routes/daemon.ts` already has the pattern this needs for `transcription`, `hostToolPaths`, `providers` and `mcpServers`: mutate the live config, then `workspaceLoader.writeDaemonConfig(...)` over the re-read file.
- `createUpdateChecker` (`packages/server/src/release-info.ts`) caches the last answer for `upgrade.updateCheckIntervalSec`, so a changed source must also drop that cache or the panel would keep showing the old source for up to 15 minutes.
- `buildRelease` (`packages/release/src/index.ts`) clones the source into the release directory and keeps its `.git`, so `git -C <release> remote get-url origin` answers which repository the running release came from; `releaseSha` already relies on that clone being present.
- A project's previous URL is not stored. `projects.git_url` is overwritten by the re-point, and the workspace's `workspace.yaml` block is rewritten to match, so the only durable source of "what it used to be" is the clone's `origin` — and that moves too. The re-point call itself is therefore the only moment the old URL is known; `createProjectsService` cannot reach the daemon config (`ctx.daemonConfigDir` locates it, but core owns neither the setting nor its writes), so the comparison belongs in the server, where both sides are available.
- `/api/daemon/*` is not on `RUN_TOKEN_PATHS`, so a write there is operator/human-only for free (`packages/server/src/auth.ts`).

## Goals / Non-Goals

**Goals:**
- **Detect a stale `upgrade.source`** — the running release came from repo A, `upgrade.source` is still A, a project has since moved to B — and report it with B so it can be repaired in one click.
- Repair it from Settings → Release and from the CLI, validated (source reachable, ref present), persisted to `daemon.yaml`, live without a restart.
- Offer the same repair immediately after a re-point in Settings → Projects, without ever rewriting a source the operator set independently.
- Document the migration step.

**Non-Goals:**
- Remembering a project's URL history in the database. The detection only needs the running release's repository, which is durable in the release directory.
- Changing the `upgrade.*` schema, or the deferred-upgrade pipeline. A repaired source changes only what the next upgrade builds from.
- Re-pointing the project from the release source, or anything that writes to a remote.
- Auto-repairing on re-point. The re-point reports; the operator (or the offered button) acts.

## Decisions

**1. Detection lives in the update checker, on the server side.**
`createUpdateChecker` gains a `projects` reader: a callback returning the workspace projects' `{ id, slug, gitUrl, previousUrls }` plus, per project, whether the running release's commit is present in its clone. The checker reports `runtimeSource` (the repository the running release came from, or `null`) and `staleSource` (`{ source, project: { id, slug, url } }` or `null`).

`runtimeSource` is `git -C <releaseRoot> remote get-url origin`, normalized through `githubSshRemote` so `git@github.com:o/r.git` and `https://github.com/o/r` compare equal;

`staleSource` is set exactly when all of these hold, and is `null` otherwise:
- `runtimeSource` is known,
- the configured `upgrade.source`, normalized the same way, equals `runtimeSource`,
- some *ready* project's `gitUrl` differs from `runtimeSource`, and that project's clone contains the running release's commit (`git -C <clone> cat-file -e <sha>^{commit}`) — the durable proof that this project used to live at the running release's repository and has since been re-pointed away from it.

Several matches resolve to the first by slug. A project whose release commit is not in its clone (never at A) is not reported. Core keeps no URL history: the release directory's own `origin` *is* the record of where the running release came from, so nothing new is persisted.

**2. The write is `PATCH /api/daemon/update/source`, operator-only, validated then persisted then applied.**
Body `{ source?: string|null, ref?: string, refresh?: boolean }`. Order: resolve `resolveRemoteSha(source, ref)` (`git ls-remote`, same primitive the checker uses) — failure is a `validation` OcError naming the source or ref; then assign `deps.daemon.upgrade.source`/`.ref` and `writeDaemonConfig` over the file re-read from `deps.daemonConfigDir`; then drop the checker's cache so the next read resolves the new source. `source: null` clears it. With no `daemonConfigDir` the call fails with a clear error rather than applying in memory only — the same shape `transcriptionPut` and `persistHostToolPaths` already use (they silently skip the write; for a value the whole feature exists to persist, silence is wrong).
Returns the fresh `UpdateStatus`.

**3. The re-point reports, it does not repair.**
`projects.update()` returns the project as today. The **route** computes `releaseSource: { previousUrl, currentUrl } | null` after a successful re-point — `previousUrl` is the `gitUrl` the row had before the call (read before `services.projects.update`, which is also what makes it exact rather than inferred), `currentUrl` is the returned project's `gitUrl` — and includes it in the response when `previousUrl` names the same repository as the daemon's configured release source. Settings → Projects shows a small offer; taking it calls the same `PATCH /api/daemon/update/source`. The CLI's `weave project update` prints the same hint.

**4. Settings → Release shows the warning and the repair action in the same section.**
`staleSource` renders above the source rows with the old source, the project's current URL, and a single "Use the project's new URL" button that calls the PATCH mutation. On success the query is invalidated and the warning disappears. Modal state (a pending re-point offer) is not needed: both surfaces funnel into one hook, `useSetReleaseSource`.

**5. CLI: `weave daemon update source <url> [--ref <ref>] [--clear] [--json]`.**
Same endpoint; human output mirrors `weave daemon update`'s source line and adds a warning line when `staleSource` is set.

## Risks / Trade-offs

- **Detection precision.** Without a stored URL history, "the project moved away from A" is inferred from the release commit being reachable in a project's clone and that clone's `origin` differing from A. A project that was forked from A but always lived elsewhere would also match; the warning would then name a plausible but wrong project. Mitigated by making the action a suggestion that the operator confirms, and by the source still having to name A exactly.
- **A stale source can still look healthy.** The whole point of the ticket: `no update available` while pointing at an archived repo. The warning is additive to the answer, never a substitute, so existing behaviour is unchanged for every non-stale case.
- **`writeDaemonConfig` rewrites the whole file** through `daemonConfigToLegacySpelling`; comments in `daemon.yaml` are lost, exactly as for the existing transcription/models writes. Acceptable and consistent; noted in `OPERATIONS.md`.
- **Validation reaches the network** (`ls-remote`, 20 s timeout). A hanging host makes the button slow rather than wrong; the route is not called by polling.
- **Live application depends on the same object identity** the update checker and upgrade service captured. Both hold `deps.daemon`; mutating `upgrade.source`/`.ref` in place is what makes `weave daemon update apply` use the new value with no restart. Covered by a test that changes the source and asserts the next upgrade request uses it.
