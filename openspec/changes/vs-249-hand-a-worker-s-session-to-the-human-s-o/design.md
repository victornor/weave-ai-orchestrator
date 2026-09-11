## Context

See `proposal.md` for motivation. The relevant existing pieces, found by reading the code rather than
assumed:

- `agent_sessions.session_ref_json` is the only durable record of a runtime session
  (`{"sessionId":...}` / `{"threadId":...}` for Codex); it is written only by `SessionsService.record`
  after a daemon-run turn finishes (`packages/core/src/sessions/index.ts`).
- A turn's `cwd` is the agent's **home**, not its worktree (`agent.homePath`,
  `packages/core/src/runs/engine.ts`); the worktree is normally `home/work`, and adapters add their
  own directory-inclusion flag (`--add-dir`, `--include-directories`, ...) when the two differ. Each
  adapter's `buildArgs` and `packages/runtime-sdk/src/launch.ts`'s `launchCommand`/`childEnv` are
  already pure, side-effect-free functions the daemon calls to build a turn's argv and resolve its
  binary — they do not spawn anything themselves.
- All five current adapters report `resumableSessions: true` in their capabilities; only Claude
  reports `streamingInput: true` (live mid-turn `send`). The other four adapters' resume path is
  already "start a new CLI process pointed at the stored session ref" — exactly the shape a human's
  own terminal needs, which is why this change works uniformly across runtimes without touching
  `send`.
- `agents.status` already has a `paused` value the dispatcher's candidate query already excludes
  (`IDLE_AGENT_STATUSES = ['active', 'error']`, `packages/core/src/runs/dispatcher.ts`). Failure pauses
  already carry a structured `pause_detail_json` (`AgentPauseDetail: {family, code, message, resetAt,
  runId}`); `LOGIN_PAUSE_CODE` is the existing precedent for a pause reason a surface branches on by
  code rather than by free text.
- `retireIdleSessions()` (`packages/core/src/supervisor/index.ts`) is the existing precedent for a
  config-driven, timestamp-based sweep that closes something a human forgot about by calling the same
  code path a human's own action would use — the template for automatic hold recovery.
- The supervisor's own tick runs every 15 seconds (`TICK_MS`, `packages/core/src/supervisor/
  index.ts:13`). That interval, not filesystem mtime granularity, is the real resolution of any
  cheap "did the session file change" signal sampled once per tick — see the abandonment decision
  below.

## Goals / Non-Goals

**Goals:**
- Reuse each adapter's existing argument-building and binary-resolution code to produce the resume
  command, so the command can never drift from what the daemon itself would run.
- Make the hold a first-class, auditable record (not just a pause reason string), so reconciliation on
  return has something concrete to compare against.
- Keep the change additive to the dispatcher: no change to `IDLE_AGENT_STATUSES` or the candidate
  query is needed, because a held worker is `paused`.

**Non-Goals:**
- Making `conductor attach` or any adapter's `send` fluent — VS-248's question, not this change.
- Reconstructing exact token usage spent in the human's own session — the system notes that
  session/worktree activity happened outside its accounting; it does not attempt to recover it.
- Handover for the conductor agent — this is a worker-only capability, per the ticket.
- A TUI affordance for the "take this session" action on decision cards — the physical-debugging use
  case that motivated this (captain, 2026-09-11) is a web-UI workflow; the TUI's `DecisionCard` has no
  clipboard mechanism today (`packages/tui`), and adding one is not required by any acceptance
  criterion. The worker-level command remains reachable from the CLI (`conductor worker show`).

## Decisions

**Command construction reuses `launchCommand` directly, and a new sibling of `buildArgs` per
adapter, not `buildArgs` itself.** Confirmed during apply: every adapter's `buildArgs` has no
interactive toggle at all — it always bakes in its headless form (`-p --output-format stream-json`,
`exec`, `-o stream-json`, `run --format json`, ...) with no branch that produces a bare interactive
invocation. Forcing an "interactive mode" through `buildArgs` would mean threading a new concern
through five turn-builders whose entire shape assumes a scripted, non-interactive turn — a much
larger and riskier change than this ticket's scope. Instead, each adapter's `args.ts` gained a new,
separate pure function, `resumeCommand`, that reuses the same session-ref parsing (`asClaudeSession`
etc.) and the same config-dir-env-var / worktree-inclusion-flag facts `buildArgs` already encodes —
so the two cannot drift on *those* facts — while building genuinely interactive argv. `launchCommand`
is unchanged and reused as originally planned: it resolves the binary path without spawning, and its
resolution is identical whether called for a turn or for a human's resume command.
Claude/Cursor/Gemini reuse `--resume <id>` as-is, a flag already used for headless resume, so this is
high-confidence. Codex (`resume <id>`, distinct from `exec resume <id>`) and OpenCode (`-s <id>` with
no `run` subcommand) resume via a *subcommand* headless, and their bare interactive spelling could
not be confirmed against the real CLI (forbidden from inside a ticket) — flagged in both adapters'
code as best-effort, unverified, for the owner to confirm against a real invocation.

**The command sets the working directory and env inline on the invocation, not via `cd`/`export`
before it, and is a single line.** `cd '<homePath>' && <VAR>=<val> ... <bin> <args>` — one paste,
quoted for paths containing spaces, and nothing left in the shell's exported environment afterward.
The working directory is the same one the daemon's own turn would use (home, with the worktree
included via the adapter's own directory-inclusion flag when the two differ) — not simply the
worktree — so that a tool call in the resumed session resolves paths exactly as it would have under
the daemon.

**The offered text says plainly where the command lands, since the directory itself won't say it.**
`cd`-ing into `agent.homePath` rather than the worktree is correct for path resolution (previous
paragraph), but a human expecting to land in their checkout and instead landing one level up, in a
directory that isn't a git repo, reads as a bug rather than a design choice unless told otherwise.
The command is offered alongside a line of text naming both paths plainly — e.g. "resumes in the
worker's home directory; the checkout is at `<worktreePath>`, already included in this session" —
not left for the human to infer from the `cd` target.

**Only the overlay keys change, not the whole daemon environment.** A human's own shell already has a
correct host environment (same user, same host, same mise installation); the command exports only the
runtime's own config-dir variable(s) inline. **Landmine, confirmed in `launch.ts`:** OpenCode's overlay
replaces `HOME`, `XDG_CONFIG_HOME` and `XDG_DATA_HOME` entirely (VS-221's reason for
`pinHostMiseRoots` existing at all). For OpenCode specifically, the generated command must also pin
`MISE_DATA_DIR`/`MISE_CONFIG_DIR`/`MISE_CACHE_DIR` back to the daemon's own roots the same way
`pinHostMiseRoots` does, or a human who then also wants to run host CLIs (`git`, `openspec`, ...) in
that same pasted shell loses their mise-resolved tools. For every other runtime, no such pin is
needed — their overlays only add a config-dir variable, they don't relocate `HOME`.

**The hold is its own table (`agent_handovers`), not an overload of `pause_detail_json`.**
`AgentPauseDetail` is a fixed, small shape built for a failure's classification (`family/code/message/
resetAt/runId`) and is read generically by every surface that renders a pause reason. A hold needs
more: a snapshot of the worktree HEAD and session ref *at the moment it was taken*, a status
(`active`/`returned`/`abandoned`), who took it and when, and — on return — a reconciliation payload
and the human's note. Stuffing all of that into `pause_detail_json` would either bloat the shape every
pause-reason renderer has to understand, or hide handover-specific data behind an untyped blob other
code can't safely parse. A dedicated table keeps `agents.status = 'paused'` (so the dispatcher
exclusion "just works", satisfying acceptance criterion 3 with no dispatcher change) while giving the
hold's own data a real schema and an audit trail independent of the pause-detail convention. The
worker's `pause_detail_json` still gets a small, generic code (parallel to `LOGIN_PAUSE_CODE`) so
existing pause-reason surfaces render something sensible without needing to know about the new table;
surfaces that need the full picture (the worker page, the decision card, handback) read the
`agent_handovers` row directly.

**Alternative considered and rejected:** a new `agents.status` value (e.g. `held`) instead of reusing
`paused`. Rejected because it would require touching the dispatcher's candidate query, every
`IDLE_AGENT_STATUSES`-adjacent check, and the `AGENT_STATUSES` enum and its CHECK constraint (a table
rebuild, per this project's own established migration pattern) for no behavioral gain over reusing
`paused` plus a dedicated hold table — `paused` already means "the dispatcher leaves this alone until
something explicit resumes it," which is exactly the semantics a hold needs.

**Taking a session requires no active run and no existing open hold; both are refused, not queued.**
A hold taken while a turn is mid-flight could see the runtime's session file written by two processes
at once. Refusing (rather than queuing "take" for when the turn ends) keeps the guarantee simple: a
human either gets the session now or is told to wait/cancel the running turn first, the same choice
they already have via the existing cancel action.

**Handback is a distinct action from plain `resume`, gated on a required note.** Reusing `resume()`
verbatim would skip reconciliation and would let a human "return" a session with nothing recorded, the
exact silent hole the ticket calls out. `endHandover` is a new method that: reads the
`agent_handovers` row, recomputes worktree state (reusing `util/git.ts`'s `worktreeState`, the same
function `progressNote()` already uses for "what changed" narratives — not the second, parallel
inline-git implementation behind the `ac_worktree_status` MCP tool), diffs it against the snapshot
taken at handover time, records the human's note and the diff on the `agent_handovers` row, posts a
ticket comment with both, and only then flips `agents.status` back to `active`. The
`run-recovery/paused-worker-visibility` delta records that plain `resume` is refused while a hold is
open, so the two paths cannot be confused by a surface that only knows about ordinary pause/resume.

**Session-file reconciliation is a change-detection signal, not a re-ingested transcript.** The system
cannot safely parse a runtime's own session file (storage format is explicitly out of scope, per the
proposal); it can cheaply notice the file changed (e.g. its modification time or size moved since the
handover snapshot) and say so. That is enough to satisfy "the system should notice rather than
silently continue" without adding a second, competing writer of session content.

**Abandonment closing is gated on two conditions, not elapsed time alone: the hold must be old, and
the session must have gone quiet.** A sweep that closes purely on `now - startedAt >=
handoverAbandonTimeoutMinutes` reintroduces the exact collision the hold exists to prevent: a human
two hours into a real debugging session gets the daemon dispatching a turn into their live worktree
and session file, concurrently. "Abandoned" has to mean *nothing has happened here for a while*, not
*a while has passed since it was taken*.

Each `agent_handovers` row additionally tracks `last_activity_signal` (the cheap session-file
change-detection value — see below) and `last_activity_at` (defaults to the row's own `started_at`).
Every supervisor tick, for every open hold, the sweep re-samples the signal: if it differs from the
stored one, that's activity — update both fields and take no closing action this tick, regardless of
elapsed time. A hold closes only once **both** `now - started_at >= handoverAbandonTimeoutMinutes`
**and** `now - last_activity_at >= handoverQuietMinutes` (new default: 30 minutes) hold true. The
first condition is what "nothing ever happened, and it's been two hours" default protects; the second
is what "something happened, but has now stopped" requires. A hold with continuous activity every
tick never satisfies the second condition and is never closed by the sweep, exactly as the human
working in it would expect. A hold whose activity stops has to sit quiet for the shorter window
before the sweep gives it back — bounding, rather than eliminating, how long a *genuinely* abandoned
hold can linger past the point activity actually stopped.

**What the signal actually resolves.** The signal is a cheap stat of the runtime's session file
(modification time, size, or both — not a re-parse of its content, consistent with the "change
detection, not a re-ingested transcript" decision below), sampled once per supervisor tick. The
supervisor's own 15-second tick interval (`TICK_MS`, `packages/core/src/supervisor/index.ts`) is the
real resolution of this signal, not the filesystem's own mtime granularity: two writes inside the
same 15-second window collapse into one observed "changed" event, and a quiet period shorter than one
tick can't be distinguished from continuous activity. That resolution is more than fine for this
purpose — the sweep only needs "did anything change since the last check," never a precise count or
timing of writes — but it is why `handoverQuietMinutes` is expressed in minutes, comfortably many
ticks wide, rather than something granular enough for the tick interval itself to matter.

**`handoverQuietMinutes` defaults to 30, shorter than `handoverAbandonTimeoutMinutes`'s 120.** The
120-minute figure has to tolerate a slow start — a human who took the session but hasn't typed
anything yet, or is still reading before their first command — as well as the case nothing ever
happens at all. Once real activity has been observed at least once, the bar for calling it abandoned
should be lower: a human already mid-session going quiet for 30 minutes (stepping away, waiting on
physical hardware, thinking) is a normal pause; 30 minutes with zero signal change is a reasonable
place to decide the pause has become an abandonment. Both numbers are judgment calls, not contracts;
the config knobs are the escape hatch if either turns out wrong in practice.

**Automatic abandonment-close calls the exact same reconciliation `endHandover` uses**, with the note
replaced by one of two fixed system strings depending on whether `last_activity_at` ever advanced past
`started_at`: **"recovered automatically after `handoverAbandonTimeoutMinutes`; no session activity
was ever detected"** when nothing ever happened, or **"recovered automatically after activity
stopped; the last session activity observed was at `<last_activity_at>`, `handoverQuietMinutes` of
quiet since"** when there was real activity that later stopped. The human reading the ticket comment
later needs to know which one happened — "nobody ever showed up" reads very differently from
"somebody was here and walked away". Either way the `agent_handovers` row's status is recorded as
`abandoned` rather than `returned` — the same data shape as a human handback otherwise, so every
surface that reads a closed hold handles both endings identically.

## Risks / Trade-offs

- [Risk] A human runs the pasted command from a different machine, or edits it before pasting, and it
  fails in some way the daemon can't see. → Mitigation: none needed beyond correctness of the command
  itself; this is the same trust boundary as any other copy-paste tooling, and failure is visible to
  the human immediately (their own terminal).
- [Risk] A human takes a session, does nothing, and never runs the pasted command at all — the
  worktree and session are untouched, but the worker still shows as held until the abandonment sweep
  fires. → Mitigation: this is exactly the abandonment path; `last_activity_at` never advances past
  `started_at`, so the sweep closes it at `handoverAbandonTimeoutMinutes` with the "nothing ever
  happened" note, per the `session-handover/lease` spec.
- [Risk] A human is genuinely still working in a held session when the abandonment timeout elapses —
  closing on elapsed time alone would hand the worker back to the dispatcher while the human is still
  driving it, recreating the exact concurrent-write collision the hold exists to prevent. →
  Mitigation: the sweep additionally requires `handoverQuietMinutes` of no observed session-file
  change before closing (design decision above); continuous activity never satisfies that condition,
  so the sweep never closes a hold that is actually in use.
- [Risk] Gating on quiet time means a hold whose activity stops right at the
  `handoverAbandonTimeoutMinutes` mark can linger up to `handoverQuietMinutes` longer than the stated
  timeout before the sweep recovers it. → Mitigation: bounded and stated, not open-ended — the extra
  wait is capped at `handoverQuietMinutes` (30 minutes by default) in the worst case, and is the
  deliberate trade against the collision risk above, which is strictly worse.
- [Risk] Two humans, or a human and a script, both call "take" for the same worker in a race. →
  Mitigation: "taking an already-held worker is refused" (spec'd); the second caller gets a clear
  refusal, not a silently overwritten hold.
- [Risk] The interactive-vs-headless argv distinction assumed to exist per adapter turns out not to be
  cleanly exposed for one or more runtimes. → Mitigation: apply-phase's first task is to confirm this
  per adapter before building the shared command-construction code; if an adapter genuinely has no
  interactive form, that runtime is a "cannot resume outside the daemon" case for this feature (a
  narrower capability than `resumableSessions`), stated to the human the same way any other unresumable
  runtime is.

## Migration Plan

Additive: a new table, a new pause-detail code, two new endpoints, and new UI affordances. No existing
column, endpoint or stored shape changes meaning. Nothing to backfill — a hold only exists once
something creates one. Rollback is deleting the migration's table and the new routes; no data migrated
in the other direction is at risk because no existing data is touched.
