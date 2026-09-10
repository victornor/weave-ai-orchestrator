## Why

Captain, 2026-09-10: a conductor in another workspace asked the human how to
fix the OpenSpec toolchain after SIDE-3. Cause: a `mise.toml` pinning node 22,
copied from a misread of this repo's `package.json` engines. Host `openspec`
(`@fission-ai/openspec`) is installed under node 26.7.0; inside that repo,
mise resolved node 22 and `openspec` disappeared. This workspace has landed
hundreds of OpenSpec changes without that pin. The always-loaded prompts do
not say "do not add a mise node pin that hides host tools" and "do not copy
another project's engines into mise.toml."

## What Changes

- The shipped conductor AGENTS template states: do not add or keep a
  `mise.toml` (or equivalent) Node pin that makes host CLIs such as
  `openspec` disappear; do not copy `package.json` engines from another
  repository into a pin; if OpenSpec is missing only inside a mise-pinned
  repo, that is not a reason to ask the human to reinstall the CLI or change
  the machine Node — remove or align the pin.
- The shipped worker AGENTS template states the same rules for workers
  editing a project (they are the ones who introduce the pin).
- A render test asserts both shipped templates carry those rules.

## Capabilities

### New Capabilities

- `agent-prompts/host-toolchains`: Always-loaded conductor and worker
  instruction templates forbid a Node pin that hides host CLIs such as
  `openspec`, forbid copying another repository's `package.json` engines
  into a pin, and forbid asking the human to reinstall OpenSpec or change
  the machine Node when the CLI is missing only inside a pinned repo.

### Modified Capabilities

(none)

## Impact

- `templates/conductor.AGENTS.md.tmpl` — one short Host CLIs note so the
  conductor does not escalate a missing-inside-the-repo `openspec` to the
  human as a toolchain reinstall.
- `templates/worker.AGENTS.md.tmpl` — one short Host CLIs note so workers
  do not add or keep the pin, and do not ask the conductor or the human to
  reinstall the CLI.
- `packages/core/src/prompts/render.test.ts` — shipped-template assertions
  for the rule strings.
- No daemon schema, no API, no change to OpenSpec itself, no change to
  this workspace's `mise.toml`.
- Out of scope: fixing SIDE-3 / SIDE-4 or that other workspace's repo;
  changing OpenSpec; installing or wrapping `openspec` in the daemon.
- Sibling of [VS-169](conductor://tickets/VS-169) (`agent-prompts/gh-forge-auth`),
  which is in progress on the same two templates. This change adds a
  different rule; apply rebases if VS-169 lands first.
