## Context

See proposal.md for motivation. The rendering pipeline (unchanged by this
change, just extended):

- `packages/core/src/workers/index.ts`'s `spawn()` creates the worktree
  (`provider.create`), records `agent.worktreePath` on the row, then
  calls `renderHome()`.
- `packages/core/src/workers/home.ts`'s `renderHome()` calls
  `renderWorkerInstructions()` (writes `AGENTS.md`) and `renderBrief()`
  (writes `brief.md`), and re-runs on every `ensureHomeCurrent()` check
  (brief/spec/runtime change, or a missing `AGENTS.md`) — so the check
  this change adds re-evaluates on every re-render, not just at spawn.
- Both renderers pull their data from `workerData()` in
  `packages/core/src/prompts/index.ts`, which already has
  `agent.worktreePath` in scope and already imports `existsSync`/`join`
  from `node:fs`/`node:path` for `loadTemplate()`.
- `renderTemplate()` (`packages/core/src/prompts/template.ts`) is a small
  mustache-ish engine supporting `{{#if a.b}}` / `{{#unless a.b}}` with
  dotted-path lookup — no new templating capability is needed.

By the time `renderHome()` runs, `agent.worktreePath` points at a
worktree that provably exists on disk (it was just created, or it
existed on a prior turn) — `existsSync(join(worktreePath, 'AGENTS.md'))`
is a cheap, synchronous, always-safe check with no new I/O pattern.

## Goals / Non-Goals

**Goals:**

- A worker in a project **with** `AGENTS.md` is told to read it,
  unchanged in wording.
- A worker in a project **without** one is not told to read it anywhere
  in the daemon-rendered brief or worker `AGENTS.md`, and states plainly
  that the project has none (so it does not go looking).
- The same for `openspec/config.yaml`.
- A test exercises both branches by rendering against a real worktree
  directory that does or does not contain the file.

**Non-Goals:**

- Not templating the skill layer (`skills/agent-conductor-worker/*`) —
  those files are static and shared across every project in the
  workspace; conditioning them on one project's worktree would require
  per-project skill rendering, a materially larger change than this
  ticket's low-priority scope. Flagged in proposal.md `Impact` instead.
- Not changing `templates/charter.md.tmpl` — its two mentions are already
  hedged fallback prose that stays true either way (see proposal.md).
- Not adding a general "does this project-repo file exist" helper API;
  two call sites with the same two-line check do not need one.
- Not changing what happens when the file appears or disappears mid-run
  (relaunch already re-renders via `ensureHomeCurrent()`, which is
  existing behavior this change piggybacks on for free).

## Decisions

### Compute the booleans once, in `workerData()`, not in each template

`workerData()` already assembles every value both `renderBrief()` and
`renderWorkerInstructions()` read. Adding `worktree.hasAgentsFile` and
`worktree.hasOpenspecConfig` there means both templates (and the
`defaults.ts` fallback) share one source of truth and one place that
could regress, rather than each re-deriving it from `agent.worktreePath`.

Alternative considered: check in `renderHome()` and inject a separate
`repoFiles` object. Rejected — `workerData()` is already the single
join point for template data; a second data-building function invites
the two to drift.

### Key off actual file existence, not `project.openspecEnabled`

`work/openspec/config.yaml`'s Context-pointers mention could instead be
gated on the already-computed `project.openspec` boolean (the project's
config flag). Rejected in favor of an `existsSync` check, for the same
reason this whole change exists: a config flag can be stale or simply
wrong relative to what is actually checked out (a project could be
freshly marked `openspecEnabled` before its first `openspec new change`
seeds the directory, or disabled after the file was already committed).
Checking the worktree directly is what the ticket asks the daemon to do
for `AGENTS.md`; the same reasoning extends to this second file, and it
costs one more `existsSync` call, not a new mechanism.

### Fix `templates/worker.AGENTS.md.tmpl` too, not just `brief.md.tmpl`

The ticket's two quoted examples are both from `brief.md.tmpl`, but
`worker.AGENTS.md.tmpl` — the file actually written to the worker's home
`AGENTS.md`, which is what the CLI loads as the system prompt — carries
its own, independent "read `work/AGENTS.md`" instruction in "Each turn"
step 2 and a parenthetical in "Git". Both are exactly the same failure
mode, rendered from the same data. Leaving them unconditional while
fixing `brief.md.tmpl` would still reproduce the transcript in the
ticket (the worker reads its home `AGENTS.md`, which is loaded as the
system prompt, before it reads `brief.md`).

### Leave the skill layer and charter fallback alone; say so in the PR

Per the ticket's acceptance criterion 4 ("either confirmed always-present
or given the same treatment; state which in the PR"): `work/AGENTS.md`
also appears in `skills/agent-conductor-worker/SKILL.md` and
`references/delivery.md`, unconditionally. These are static files
installed identically into every agent's home regardless of project —
not part of "the brief" the daemon renders per-ticket — and cannot be
conditioned without adding per-project templating to the skill
installer, which is out of proportion to a low-priority ticket about one
wasted read. `templates/charter.md.tmpl`'s two mentions are hedged
prose shown only in an empty-capabilities/empty-rules fallback and do
not assert existence. Both are called out in proposal.md `Impact` rather
than silently left as an unstated gap.

## Risks / Trade-offs

- [A worktree deleted or moved between render and read] → Not a new
  risk: `agent.worktreePath` already assumes the worktree it was just
  told about is the one on disk; this change reads one more file from
  the same directory.
- [Skill-layer instruction still fires for a project without
  `AGENTS.md`] → Accepted and documented (see Decisions above); the
  worker's own rendered `AGENTS.md`/`brief.md` — which it reads before
  or alongside the skill — now correctly says the project has none, so a
  worker that cross-checks will not attempt the read regardless.

## Migration Plan

Prompt-only change. The next `renderHome()` call for any live worker
(next turn, or the next `ensureHomeCurrent()` re-render) picks up the
conditional wording. No data migration, no schema change. Rollback is a
revert.

## Open Questions

None.
