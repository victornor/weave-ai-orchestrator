## Why

Captain, 2026-09-10, noticing a Cursor worker's transcript in another
workspace: three failed `read work/AGENTS.md` calls (`File not found`),
then the worker carried on and finished its ticket anyway. The rendered
brief tells every worker, unconditionally, to read `work/AGENTS.md` (the
project repository's own contributor file), but that file only exists if
the project happens to ship one. `agent-conductor` does; many projects do
not. The daemon already knows, at render time, whether the worktree it
just created has that file — it just never checks.

The same unconditional-mention pattern also applies to one other
project-repo path named in the brief: `work/openspec/config.yaml`,
listed in "Context pointers" regardless of whether the project uses
OpenSpec or has ever run `openspec init`.

## What Changes

- The daemon computes, at brief-render time, whether the worker's own
  worktree actually contains `AGENTS.md` and `openspec/config.yaml`, and
  passes both as booleans into the same template data already used for
  the brief and the rendered worker `AGENTS.md`.
- `templates/brief.md.tmpl`'s Setup section and Context pointers list
  name `work/AGENTS.md` only when it exists, and say plainly that the
  project has none when it does not (so the worker does not attempt the
  read at all).
- `templates/brief.md.tmpl`'s Context pointers list names
  `work/openspec/config.yaml` only when it exists.
- `templates/worker.AGENTS.md.tmpl` — which independently repeats the
  same "read `work/AGENTS.md`" instruction in its own "Each turn" step
  and its "Git" section — gets the same treatment, from the same data.
- `packages/core/src/prompts/defaults.ts`'s built-in `BRIEF_TMPL`
  fallback (used only when a workspace has no `templates/` override on
  disk) gets the same conditional, so a workspace running without the
  shipped templates directory does not regress.
- A render test covers both branches (file present / file absent) at
  brief-render time, using a real worktree directory with and without
  the files.

## Capabilities

### New Capabilities

- `agent-prompts/conditional-repo-files`: the daemon-rendered worker
  brief and worker `AGENTS.md` only name a project-repo file
  (`work/AGENTS.md`, `work/openspec/config.yaml`) when the worker's own
  worktree actually contains it, so a worker in a project without one is
  never told to read it.

### Modified Capabilities

(none)

## Impact

- `packages/core/src/prompts/index.ts` — `workerData()` gains two
  existence checks (`existsSync` against the agent's own worktree path)
  surfaced as `worktree.hasAgentsFile` / `worktree.hasOpenspecConfig`.
- `packages/core/src/prompts/defaults.ts` — the `BRIEF_TMPL` fallback's
  Setup sentence becomes conditional.
- `templates/brief.md.tmpl`, `templates/worker.AGENTS.md.tmpl` — the four
  unconditional mentions become conditional on the two new booleans.
- `packages/core/src/prompts/render.test.ts` — new cases asserting both
  branches, plus shipped-template coverage.
- No schema change, no new tool, no API change.
- Out of scope, called out rather than silently dropped: the
  `agent-conductor-worker` skill (`SKILL.md`, `references/delivery.md`)
  also names `work/AGENTS.md`, but skill files are static, non-templated
  text shipped identically to every project — they are not "the brief"
  and cannot be conditioned on a single project's worktree without
  templating the skill layer itself, which is a materially larger change
  than this low-priority ticket asks for. Left unchanged; noted on the
  ticket for a future decision.
- `templates/charter.md.tmpl`'s two mentions of `work/AGENTS.md` are
  hedged fallback prose ("read `work/AGENTS.md` before assuming", "none
  beyond the project's own `AGENTS.md`") shown only when a role has no
  capabilities/rules configured; they do not instruct an unconditional
  read and stay true whether or not the file exists. Left unchanged.
