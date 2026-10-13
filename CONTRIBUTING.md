# Contributing to Weave AI

Thanks for helping. This page covers what you need to build the project, propose a change and get it merged.

## Before you start

- **Contributor licence agreement.** Weave AI is AGPL-3.0, and some paid features live in `ee/` under a
  separate licence. By submitting a contribution you accept [`CLA.md`](CLA.md), which lets the project
  relicense it, including into `ee/`. If you cannot accept that, please do not submit code.
- **Security issues** do not go in public issues. See [`SECURITY.md`](SECURITY.md).
- **Conduct.** Participation is governed by [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
- For anything larger than a small fix, open an issue first so we can agree on the approach.

## Build and test

You need Node 22 or newer to run the daemon; development uses Node 26 and pnpm 11.25.0 (what CI and
`mise.toml` use). With [`mise`](https://mise.jdx.dev): `mise install`.

```bash
git clone https://github.com/victornor/agent-conductor.git && cd agent-conductor
pnpm install
pnpm build         # tsc -b across every package, and the web app
pnpm lint          # architecture, console and test-fixture guards
pnpm typecheck
pnpm test          # runs the core/server suite and the UI suite, one after the other
pnpm dev           # the daemon in the foreground
```

`pnpm test` prints two result blocks, one per suite; both must pass. While iterating, run only the
test files you changed (`pnpm exec vitest run path/to/file.test.ts`, or `pnpm --filter @weave-ai/ui test`),
and run the full suite once before you open a pull request. Do not run several full suites at once.

`pnpm scan:secrets` runs gitleaks over the tree and history; run it if you touch fixtures or config
examples. Test fixtures must use documentation addresses (`192.0.2.0/24`, `example.com`) and invented names.

## How changes are proposed

Behaviour changes go through [OpenSpec](https://github.com/Fission-AI/OpenSpec). Each change lives in
`openspec/changes/<name>/` and holds a `proposal.md` (why and what), spec deltas under `specs/`, an
optional `design.md`, and a `tasks.md` checklist. The accepted specs are in `openspec/specs/`.

1. Create the change, write the artifacts, and run `openspec validate <name> --strict`.
2. Open a pull request with the proposal for discussion.
3. Implement the tasks, ticking each in `tasks.md` only when its behaviour is complete.
4. Do not archive the change yourself; the maintainer archives it when the work lands.

Documentation-only and trivial fixes do not need a change. Deviations from [`docs/PLAN.md`](docs/PLAN.md)
are recorded as a short ADR in `docs/adr/`, numbered after the highest existing one.

## Pull requests

- Keep a pull request to one purpose. Commit messages are imperative and scoped.
- Add or update tests with the code. Assert the value a call produces, not only that it ran.
- Update the docs the change touches (`README.md`, `docs/`) in the same pull request.
- Fill in the pull request template. Say what you verified and what you did not.

## Continuous integration

Every pull request runs `lint`, `typecheck`, `test-core` and `test-ui` on GitHub-hosted runners
(see `.github/workflows/ci.yml`). Pull requests from forks need a maintainer to approve the workflow run.
All four must be green to merge. You can reproduce them locally with the commands above.

## Working with coding agents

[`CLAUDE.md`](CLAUDE.md) holds the repo conventions in the form coding agents read. It is a useful
summary for humans too, but this file is the contributor entry point.
