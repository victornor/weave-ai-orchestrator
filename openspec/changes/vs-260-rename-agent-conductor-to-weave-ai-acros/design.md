## Context

This is the third and last ticket in the `weave-ai` rename. VS-257 scouted the whole surface
(`ac_ticket_document_get VS-257 report`); VS-258 shipped the path-compatibility resolver; VS-259
renamed the `conductor` agent kind. The conductor's two comments on VS-260 carry the decisions this
design is built on: the pending `ac_*`/`ac-daemon` question was answered "rename everything", and the
tool-name surface is roughly twice what VS-257 estimated (~104 files).

The change is mechanical but large. Its risk is not semantics, it is (a) a byte-exact agent-facing
identifier drifting between registration and prose, and (b) the shipped compatibility resolver losing
track of an existing old-named installation. Both are addressed below.

## Goals / Non-Goals

**Goals**
- One consistent new spelling for every live identifier: package scope, CLI and daemon binaries,
  service and launchd names, MCP server name, skill directories, tool names.
- The rename complete on the commit that is actually merged, not on the commit where editing stopped.
- An existing old-named installation still found; a fresh install proving itself end to end.

**Non-Goals**
- The on-disk names VS-258 already chose. `.weave`, `weave` and `weaver` are shipped: a fresh install
  creates them and the resolver's "new" branch returns them. This ticket must not rename them, or it
  invalidates the very compatibility layer that keeps existing installs alive.
- `AC_*` environment variables. The decision was `ac_*` *tool names* and the `ac-daemon` binary; the
  env-var prefix is a separate surface nobody asked to move.
- The `conductor`→`weaver` agent-kind identity and prose. That is VS-259's, already landed.
- **Role ids** (`agent-conductor-engineer` and the like). They are live workspace data — a `roles` row,
  `tickets.assignee_role_id`, `agents.role_id`, and a `roles/<id>/` directory — not a source string, and
  renaming one would orphan every ticket pointing at it. No data migration is in this ticket.
- `openspec/specs/**` requirement prose and `openspec/changes/archive/**`. The former is the behavior
  contract (edited through deltas, and its requirement text describes behavior, not identifiers); the
  latter is immutable history. Both remain as written.
- The repo/org move, remote repointing, `upgrade.source`, and the systemd unit reinstall. captain's.
- No migration, mover or symlink: this ticket produces no state-bearing change to migrate.

## Decisions

### Decision 1 — The token map

Two independent replacement tokens, plus two squashed/branded spellings:

| Old | New | Where |
|---|---|---|
| `@agent-conductor/` | `@weave-ai/` | package scope: names, deps, imports, lockfile |
| `agent-conductor` | `weave-ai` | product name in prose, service name, skill prefix, paths |
| `AgentConductor` | `Weave AI` | brand prose (README title, CLA header, comments) |
| `agentconductor` | `weave-ai` | the squashed spellings (`MCP_SERVER_NAME`, launchd, engine literal) |
| `conductor` (CLI binary) | `weave` | `bin` map, Commander `.name()`, root script, command examples |
| `ac-daemon` | `weave-daemon` | server `bin` |
| `ac_*` tool names | `weave_*` | registration + agent-facing prose |
| `conductor://` | `weave://` | instruction-only URL convention |

`conductor` alone is **not** a global find-and-replace: the word still means the agent role in prose
VS-259 reworded only where it named the kind, and this ticket touches only the binary/command/scheme
sites. The implementation reads each `conductor` occurrence and moves only the ones that name the CLI
or the product.

Why `weave-ai` for the full name and `weave` for the binary: the ticket and every knowledge-base note
name the rename target `weave-ai`, so the brand-bearing identifiers (scope, service, MCP server,
skills) take `weave-ai`; the command, the daemon binary, the tool prefix and the already-shipped
directories take the short `weave`. This is the only reading under which VS-258's `.weave`/`weave`
directories stay untouched while the product is renamed.

### Decision 2 — `SERVICE_NAME`, `LAUNCHD_LABEL`, `MCP_SERVER_NAME`

These are three independent spellings of the same identity and the ticket names them as the most
likely to be missed, so each is changed and each is named in the PR:

- `SERVICE_NAME`: `agent-conductor.service` → `weave-ai.service`.
- `LAUNCHD_LABEL`: `com.agentconductor.daemon` → `com.weave-ai.daemon`.
- `MCP_SERVER_NAME`: `agentconductor` → `weave-ai`.

`MCP_SERVER_NAME` is re-spelled as a literal `agentconductor` in `packages/core/src/runs/engine.ts`'s
run MCP config (and in the runtime arg tests). Requirement `product-rename` makes the registered name
and the run-config key the same value, which is the invariant the tests should assert rather than two
independently-updated strings.

### Decision 3 — Tool names are byte-exact, and a test holds the invariant

`ac_*` → `weave_*` for the whole registered set (65 names across `COMMON_TOOLS`, `WEAVER_TOOLS`,
`WORKER_ONLY_TOOLS` and `HUMAN_REPLY_TOOL`). The same name is written in three shapes that must
agree: the shared arrays, the server's tool-definition objects, and the two-name size-cap `Set` in
`mcp.ts`.

Because a one-character drift across ~104 files is invisible to review and produces an agent that
silently cannot call a tool, this change adds a test that extracts every `<prefix>_…` tool name from
the agent-facing prose (the shipped skills, the templates, the core prompts, and the docs that
instruct agents) and asserts each is a member of the registered set. The registered set is the source
of truth; the prose must name only real tools. `openspec/` is excluded from the scan.

### Decision 4 — Scope boundaries

- **`docs/prompts/`**: swept like the rest of `docs/`. It is a kept record of a draft, but it names
  current skills and tools, so leaving it stale would make it actively misleading. Its filename
  (`conductor.AGENTS.md`) is left as-is, since the filename records the draft it is.
- **`CLAUDE.md`**: swept. It is a committed developer document, and acceptance criterion 1 is "no
  `@agent-conductor` anywhere". The repo's "never write discovery files" convention is about not
  authoring agent instructions into a discovery file; a mechanical product rename is not authoring
  instructions. Flagged here so plan review can veto it.
- **`openspec/changes/archive/**`** and **`openspec/specs/**`**: untouched (Non-Goals). Criterion 1's
  "package name or import specifier" is satisfied for archived prose quoting `@agent-conductor/…`
  because those are neither.
- **`pnpm-lock.yaml`**: regenerated by `pnpm install` after the `package.json` sweep, never
  hand-edited.

### Decision 5 — Prove it on the merged commit, and prove the two install shapes

VS-259's worker rebased after other work landed and found the old name **silently reintroduced by a
clean auto-merge**. A conflict is loud; a clean merge that reintroduces `agent-conductor` is not. So:

1. The final sweep is re-run **after the last rebase**, on the commit being merged, and the delivery
   report states when the sweep ran relative to the final commit. A sweep that predates the last
   rebase does not count.
2. Verification covers both install shapes, neither of which the unit suite proves:
   - **fresh**: a clean `HOME`/`XDG_*` and a throwaway config dir; build, start the daemon, run
     `weave` against it, assert the created directories are the new-named ones.
   - **existing**: a temp root pre-populated with `.agent-conductor/db.sqlite` (and an old-named user
     config dir), assert the renamed code resolves the old-named paths, creates no new-named sibling,
     and moves nothing.

Both use throwaway config directories only. The live install is never touched, and no real coding CLI
is ever launched (scratch/fake binaries per the workspace rule).

### Decision 6 — Commit per slice, because a turn is cut at 45 minutes

A turn is cut off at 45 minutes wall clock. This change cannot fit in one turn's edits safely, so each
coherent slice is committed the moment it compiles and `pnpm typecheck` is clean: package scope; CLI
and daemon binaries; service and MCP identifiers; skills and manifest; tool names; prose and branding.
One branch, one PR, many commits — never split into staged PRs.

## Risks / Trade-offs

- **A missed `conductor` occurrence that is prose, not the binary.** Handled by reading each site and
  by the tool-name invariant test; the residual risk is cosmetic, not functional.
- **Two identity values spelled with and without a hyphen** (`weave-ai.service` vs `com.weave-ai.daemon`
  vs `weave-daemon`). Accepted: the product name is `weave-ai`, the binary short form is `weave`; the
  PR names all three explicitly, as the acceptance criteria demand.
- **Long branch-to-merge window reintroducing the old name via auto-merge.** Mitigated by Decision 5's
  post-rebase re-sweep and explicit statement of when it ran.
