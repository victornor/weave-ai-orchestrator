## Why

The repository has no `LICENSE` file. Every commit so far is "all rights reserved" by default, which
makes it unpublishable: nobody may legally use, copy or contribute to it, and the open-core split
decided after the VS-86 competition scout (knowledge document `competition-and-open-core`) has no
paperwork behind it.

The decision is already made: the core is AGPL-3.0, paid in-daemon features live in a public `ee/`
directory under a commercial licence gated by a licence key, and contributors sign a CLA so the
project can relicense later. This change writes that down and audits what going public would expose.
It does not make the repository public — that is the owner's action afterwards.

## What Changes

- **`LICENSE`** at the root: the verbatim GNU AGPL v3.0 text under a `Copyright (C) 2026 Victor Nor`
  line.
- **`ee/`** exists with its own `LICENSE` — a commercial licence written for this project, permitting
  development, evaluation, testing and contribution for free while requiring a licence key for
  production use — and a `README.md` stating the split and the conventions for code that lands there.
  No code and no key check; the directory fixes the convention before the first paid feature.
- **`CLA.md`** at the root: an individual contributor licence agreement on the Apache ICLA structure,
  with an explicit relicensing grant so contributions can move into `ee/` or under other terms.
- **A `license` field on every `package.json`** in the workspace — `AGPL-3.0-only` — so tooling and
  registries report the licence rather than nothing.
- **A "Licence and contributing" section in the README** pointing at all three.
- **An audit, reported not acted on**: a secret scan of the full git history with `gitleaks` and
  `trufflehog`, a licence table for every production dependency with anything AGPL-incompatible or
  unstated flagged, and a file-by-file public-eyes read of `docs/design/`, `docs/prompts/` and
  `docs/research/`.

## Capabilities

No capability changes: licence files, package metadata and a README section describe no daemon
behaviour, and the audit changes nothing. `skip_specs: true`.

## Impact

- New: `LICENSE`, `ee/LICENSE`, `ee/README.md`, `CLA.md`.
- Modified: `README.md`, and the 27 `package.json` files in the workspace.
- The audit findings are delivered as the ticket's report document, not as repository files.

## Out of scope

- Licence-key checking code, and any feature under `ee/`.
- Making the repository public, renaming the project, rewriting commit history or the author email.
- Removing or rewriting any doc, or changing any dependency, on the strength of the audit.
