## Why

`templates/conductor.AGENTS.md.tmpl` — the source of the file the conductor reads every session —
renders its "Projects in this workspace" and "Roles and live workers" sections empty. The template
iterates `{{#each projects}}` / `{{#each roles}}`, but `renderConductorInstructions`
(`packages/core/src/prompts/index.ts`) passes `projects` and `roles` as **pre-joined strings**. The
engine's `{{#each}}` yields nothing for a string, so both inventories are blank in every rendered
conductor `AGENTS.md`.

It passes tests because the built-in fallback template (`CONDUCTOR_TMPL`) uses the string variables
directly and renders correctly, and no test exercises the shipped file template's sections.

Routing is the conductor's core job, and the charter tells it to match against "the portfolio below"
— which is blank. Every conductor either re-fetches `ac_project_list`/`ac_role_list` or routes from
memory. The cost is paid on every session and it is invisible.

## What Changes

- Make the shipped conductor template consume the two joined strings the renderer already computes,
  the same way the built-in fallback does. Drop the `{{#each}}`/`{{#unless}}` blocks for those two
  sections; the renderer already emits `- (none yet)` / `- (none hired yet)` for the empty state, so
  the sections are never blank.
- Add a test that renders the **shipped** conductor template with realistic data and asserts the
  Projects and Roles sections are non-empty, plus an empty-workspace case asserting the empty-state
  text. The existing tests only cover the built-in fallback (or assert "no placeholders"), which is
  why this shipped silently.
- Report whether the shipped worker template has the same mismatch, and any adjacent same-class gaps
  found while adding the coverage.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

(none — the renderer is unchanged; `skip_specs: true`, tracker task only)

## Impact

- `templates/conductor.AGENTS.md.tmpl` — the two broken sections.
- `packages/core/src/prompts/render.test.ts` — shipped-template section coverage.
- No renderer, engine, or data-model change.
