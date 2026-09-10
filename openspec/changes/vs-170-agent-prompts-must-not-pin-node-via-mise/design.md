## Context

See proposal.md for motivation.

Today the rule lives nowhere that travels. This workspace's platform-engineer
charter and knowledge notes do not reach other workspaces' conductors and
workers. The daemon-rendered always-loaded files are:

- `templates/conductor.AGENTS.md.tmpl` → `conductor/AGENTS.md`
- `templates/worker.AGENTS.md.tmpl` → `workers/<id>/AGENTS.md`

`packages/core/src/prompts/render.test.ts` already reads the shipped
templates (`SHIPPED_TEMPLATES`) and asserts phrases in the rendered
instructions. VS-161 source-reads HTML comments; VS-169 (in progress) adds
shipped-template assertions for the `GH_TOKEN` recipe on the same two files.

This repo's own `mise.toml` pins node 26. That pin is compatible with the
host `openspec` (installed under node 26.7.0). The forbidden pin is one that
hides host CLIs, not every pin.

## Goals / Non-Goals

**Goals:**

- Both shipped AGENTS templates name the three rules: no Node pin that hides
  host CLIs such as `openspec`; do not copy another repo's `package.json`
  engines into a pin; if OpenSpec is missing only inside a pinned repo,
  remove or align the pin — do not ask the human to reinstall the CLI or
  change the machine Node.
- A render test fails if either template drops those rules.

**Non-Goals:**

- No daemon wrapper around `openspec`, no `AC_OPENSPEC_BIN` change, no
  change to OpenSpec itself.
- Not writing this into SHARED.md or a role charter (does not travel).
- Not editing this repo's `mise.toml`.
- Not fixing SIDE-3 / SIDE-4 or the other workspace's pin (courier there).
- Not changing `skills/agent-conductor-openspec` — it never tells agents to
  reinstall the CLI; the 2026-09-10 incident was the conductor asking the
  human, which always-loaded files cover.
- Not launching a real coding CLI to verify.

## Decisions

### Place both rules as a short Host CLIs note after Hard rules

Hard rules are numbered structural never-dos in priority order. A new
numbered rule about mise would over-rank it. A 4-line "Host CLIs" note
after Hard rules (before "How work flows" / "Each turn") is visible on
every turn without changing priority.

Worker alternative: only the OpenSpec skill. Rejected — a worker adding
`mise.toml` mid-ticket never opens that skill; the 2026-09-10 pin was not
an OpenSpec-workflow mistake.

Conductor alternative: only the worker template. Rejected — the incident
was the conductor asking the human, not the worker.

Conductor alternative: a new hard rule. Rejected — wrong priority band.

### Carve the conductor's "needed credential" line

Under "How you talk", "Reach {{human.name}} immediately for … a needed
credential" must not treat a missing-inside-the-repo `openspec` as one.
Same carve-out VS-169 uses for logged-out `gh auth status`.

### "Align" means match the host Node that already has the CLI

Remove the pin, or change it so host CLIs stay on PATH (this repo's node
26 pin is the aligned case). Do not copy `package.json` `engines` from
another repository. Do not ask the human to install a second Node or to
reinstall `@fission-ai/openspec`.

### Assert distinctive strings in render.test.ts

Extend the existing `it.runIf(existsSync(SHIPPED_TEMPLATES))` cases (or add
one next to them) so both rendered instruction files mention `mise.toml`,
`openspec`, and not asking the human to reinstall. Source-read the
templates the same way VS-161 does for comment slots.

Do not snapshot the whole files.

### VS-169 overlap is rebase, not a blocker

[VS-169](conductor://tickets/VS-169) edits the same two templates for a
different rule (`GH_TOKEN`). Apply on this ticket rebases onto whatever
has landed; both notes sit after Hard rules. No shared strings.

## Risks / Trade-offs

- [A project whose own engines really are Node 22 cannot keep a pin] →
  Accept. Host CLIs such as `openspec` still need the host Node. The
  worker may use that project's engines without writing them into
  `mise.toml`.
- [A pin that does not hide host CLIs is still allowed] → Intended. This
  repo's node 26 pin stays.
- [Conductor never writes `mise.toml`] → The conductor note is still
  required so it does not escalate a worker's missing-`openspec` report
  to the human as a reinstall.

## Migration Plan

Prompt-only. Next conductor/worker spawn after deploy renders the new text.
No data migration. Rollback is revert.

## Open Questions

None.
