## Context

See `proposal.md` — Why. Two facts from the diagnosis shape every decision here:

1. The codex adapter already passes `--skip-git-repo-check` (`packages/runtimes/codex/src/args.ts`)
   and codex 0.154.0 runs the adapter's exact invocation from the failing session's own home
   directory (`turn.completed`, exit 0, no stderr). So the ticket's stated cause is insufficient;
   the durable defect is that the runtime's reason was thrown away. The engine's `onRaw` is a no-op
   (`packages/core/src/runs/engine.ts:557`) and the codex parser emits no typed error for a
   non-zero exit with no `turn.*` output, so `finalize` records `exit_1` with an empty message.
2. A ticketless session's home holds only `AGENTS.md`, `.ac-render.json` and `.agents/`
   (`workers/home.ts`), and `engine.ts:489` uses `agent.homePath` as the turn's `cwd` — no git
   repository and none of the project's code.

Current session-option plumbing already exists: `modelSettingFor(modelsFor(ctx), kind, ticket)`
(`packages/core/src/models/resolve.ts:57-80`) resolves a ticket's `workerModelId` for a worker and
falls back to `models.workers` for a ticketless session; `sessions.forTurn` retires a session whose
runtime changed (`packages/core/src/sessions/index.ts:56-85`); `agents.runtimeId` already records a
session's runtime at creation. What is missing is a place to store the session's *chosen option*
and any way to set it.

## Goals / Non-Goals

**Goals:**
- A ticketless persistent session starts on every configured runtime, codex included, and can read
  the project's code.
- A failed runtime start states why, on the run and on the surface the human sees.
- A session's worker option is chosen at open, visible, changeable, and governs the turn.
- The surface tells the human, before they change across runtimes, that the conversation restarts.

**Non-Goals:**
- Carrying the conversation across a runtime change (no summarised handover, no per-runtime
  parallel sessions). Chosen deliberately — see Decisions.
- Fixing the exact transient cause of the 2026-09-17 32 ms exit; the design makes the next one
  diagnosable and removes the codex git precondition as a class.
- Changing how ticket-bound workers resolve their option.

## Decisions

**D1. A ticketless session's home is its working directory, initialised as a git repository.**
`engine.ts` chooses the turn's `cwd` from `agent.homePath` and `home.ts` writes the rendered
`AGENTS.md` there. For four of the five runtimes that is already enough, and moving the cwd to the
project's clone would take the session's own instructions out of the path they are read from
(`systemPromptInjection: 'file_only'` for codex/opencode/cursor/gemini) and put a second writer
into the clone every ticket shares. So the cwd stays the home and the home is made a repository:
`git init` plus one commit, with `AGENTS.md` and `.ac-render.json` gitignored so the daemon's own
rendered files are never repository content. The session therefore starts on a git-requiring
runtime and keeps its instructions, and the project's code stays readable through the clone the
project already registers (and, once the session takes a ticket, through its own worktree, exactly
as a worker's).
*Alternatives:* moving cwd to the clone (instruction-path conflict above); a git worktree under the
session home (a branch the human never asked for, a worktrees row for a ticketless agent, and a
`work/` collision with the worktree a ticket later provisioned there); handing the session a ticket
worktree at creation (forces a ticket nobody asked for).

**D2. The repository is ensured on create and on every open.**
`ensureSessionRepo` runs from `ensureSession` on both the create and the resume path, so a session
opened before this change self-heals the first time it is opened again; an existing repository is
left untouched. *Alternatives:* only on create (leaves every session that already exists broken);
a separate repair command (a human has to know to run it).

**D3. The runtime's failure reason is captured at the adapter boundary, not in the engine.**
The engine intentionally ignores raw lines, so the right place is the adapter: when a runtime exits
non-zero and produced no `turn.*`/structured output, emit a typed `error` event and set
`TurnResult.error` from the first meaningful stderr line (skipping known noise lines). `finalize`
already persists `r.error.message`; the run's `last_error`/failure message then carries it. The
codex parser gains this; the audit in T6 checks claude/opencode/cursor/gemini for the same gap.
*Alternatives:* teach the engine's `onRaw` to keep the last stderr line — it cannot know what is
noise and would record startup noise for healthy runs; `--json` mode already normalizes per-runtime
errors for the runtimes that emit them.

**D4. The session's chosen option is stored on the session's agent row (`agents.worker_model_id`).**
A nullable column (migration) mirroring the ticket's `worker_model_id`. `resolve.ts` reads it for a
ticketless session before falling back to `models.workers`; `resolveWorkerModelId()`'s existing
validation (unknown id → `validation`, unconfigured → `model_unconfigured`) is reused by the setter.
*Alternatives:* a new `session_options` table (a table for one nullable value); overlapping with
`runtimeId` (runtime alone loses model/effort, and an option can name a model with no explicit
runtime semantics).

**D5. Changing the runtime starts a new conversation; the UI states it first.**
Chosen over per-runtime parallel sessions (much larger: `agent_sessions` uniqueness per agent, a
session picker, reconciliation when both exist) and over summarised handover (no runtime exposes a
portable summary; approximating one is exactly the separate mechanism the persistent-sessions spec
forbids for compaction). A model/effort change within one runtime keeps the session, because
`sessions.forTurn` already keeps a session when only the model changes. The control's confirm step
computes the resolved runtime of the candidate option and shows "same runtime — history kept" vs
"different runtime — conversation restarts", applying only on confirm.
*Alternatives:* silent switch (the ticket explicitly asks the UI to state the effect); automatic
handover summary (see above).

**D6. Session creation gains an optional option id; existing sessions are unchanged.**
`POST /workers/persistent-session` accepts an optional `workerModelId`; omitted means the session
falls back to `models.workers` as today. `ensureSession` stays idempotent: opening an existing
session does not clobber its option.

## Risks / Trade-offs

- **R1: A ticketless session has no checkout of the project's code.** → D1's stated boundary: the
  session's cwd is its own repo and its instructions, and reading the project happens through the
  project's registered clone (the same path a curation turn uses) or, once the session takes a
  ticket, through its own worktree. Verified that the ticket path is unchanged (`spawn` and
  `takeTicketForSession` still provision the same worktree; the new tests pin the session's option
  surviving a take).
- **R2: A runtime reads instructions only from `cwd` and they are missing.** → cwd is the home and
  `renderHome` writes `AGENTS.md` there before any turn; the ensureSession test asserts it exists.
  The adapter's own `installInstructions` writes it again to the same path, so file-only runtimes
  (codex/opencode/cursor/gemini) all resolve it.
- **R3: `git init` in a home that is somehow inside another repository.** → the home is
  `ctx.paths.workers/<agentId>`, a fresh per-agent directory the daemon owns; the initial commit
  is only created when `.git` does not already exist, so a second open never rewrites history.
- **R4: The exact 32 ms cause is never reproduced.** → The failure is now recorded, and the codex
  git precondition is removed as a class; the post-deploy smoke run is the live acceptance the
  owner can run if the reason still proves environmental.
- **R5: `worker_model_id` on `agents` is read by another surface that assumes ticket-only.** →
  audited: `workerModelId` is read only by `modelSettingFor`, the session setter, and the UI's
  option control; a ticket's model is still read from `tickets.worker_model_id`, so a worker's
  resolution is unchanged.

## Migration Plan

- `agents.worker_model_id` is additive and nullable (new migration, next number in
  `packages/db/src/migrations/`); existing sessions keep falling back to `models.workers`.
- No config migration; the catalog is unchanged.
- Rollback: revert the deploy — the migration column is inert to the older build.

## Open Questions

- Whether a runtime other than codex actually *cannot* start a ticketless session is answered by
  the T6 audit rather than assumed; if one cannot, it is named with the reason instead of being
  silently fixed here.
