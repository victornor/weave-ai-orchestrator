# Design — generate the opencode worker config instead of linking the host's

## The one call site

Both places that must regenerate the config already funnel through one function:
`linkRuntimeCredentials` (`packages/core/src/workspace/loader.ts`) is called

- once per runtime at workspace load (`loader.ts`, next to `mkdirSync(runtimesHome/id)`), and
- on every turn as `reconcileRuntimeCredential` (`packages/core/src/runs/engine.ts:449`), which is
  the same function under the alias kept for the repair call sites.

So the generator is invoked from inside `linkRuntimeCredentials`, and "regenerate on launch" is
satisfied by the turn path that already runs before every spawn.

## What is generated

`generateOpencodeWorkerConfig(hostConfigDir, workspaceConfigHome)`:

1. Read `opencode.jsonc` then `opencode.json` from the host config dir and parse each leniently.
   JSONC (`//`, `/* */`, trailing commas) is accepted because the owner's file may be `.jsonc` and
   `JSON.parse` rejects it; a file that still will not parse is skipped, never fatal.
2. Keep only `$schema`, `autoupdate` and `provider` (the keys a worker needs: the provider
   definitions make custom models runnable; the other two make the file a valid config). Merge
   `provider` per provider id across the two files, `opencode.json` winning.
3. Remove any `opencode.json` and `opencode.jsonc` already in the workspace home, then write the
   merged object to `<workspaceConfigHome>/opencode/opencode.json` (or write nothing when there is
   nothing to carry, so a host with no config invents no file).

**`mcp` and `plugin` are never copied.** They are the two keys the ticket names, and dropping them is
what stops the inheritance. The Weave AI MCP tools are unaffected: they are configured by
`opencodeConfig` / `buildArgs` in the project's `.opencode/opencode.json`
(`packages/runtimes/opencode/src/args.ts:15`), a different file from the global config this generates.

## The write-through-symlink hazard

An upgraded workspace already has `opencode.json` as a *symlink to the owner's file*. Writing to that
path would follow the link and overwrite the owner's config. The generator therefore always
`rmSync`s the destination (and `opencode.jsonc`) before writing, which removes the link itself, not
its target. This also guarantees "nothing points back at `~/.config/opencode`" after one launch.

## Isolated daemons

`credentialPaths` remapped the opencode config host paths under `credentials/opencode` for an
isolated daemon; the generator uses the same source directory (`daemonConfigDir/credentials/opencode`,
else `$HOME/.config/opencode`). An isolated daemon with no config there generates nothing and never
reads or writes a host path, matching `daemon-isolation/credential-scope`.

## Verification

Unit tests cover the generated content, the `mcp`/`plugin` exclusion, provider flow-through and
JSONC. The token claim in the ticket is about a real turn, which a ticket must not launch (the
credential-rotation rule); the PR states the before/after inputTokens measurement as owner-run and
gives the recipe rather than running a coding CLI from the worktree.

## Permissions and atomic write (security review)

The `provider` block being copied holds inline `apiKey` values (the owner's config has no
`{env:…}` indirection) and the owner's own file is `0600`. The first version wrote with a plain
`writeFileSync(dst, …, 'utf8')` under the daemon's `umask 0022`, so the generated file was `0644`,
world-readable — a key leak. The generator therefore:

- creates the file `0600` and re-`chmod`s `0600` on every regeneration (the containing `opencode/`
  dir is created `0700`);
- writes to a `0600` temp file in the same directory and `rename`s it over `opencode.json`, so the
  swap is atomic and a worker starting mid-regeneration never reads a missing or partial file;
- unlinks the destination first **only** when it is currently a symlink (the upgrade case from
  VS-161), so nothing writes through it into the owner's file — a regular generated file is replaced
  by the rename instead;
- on a read or write failure logs a warning with no secret values and leaves the previous generated
  file in place, rather than deleting it and dropping the owner's custom providers.