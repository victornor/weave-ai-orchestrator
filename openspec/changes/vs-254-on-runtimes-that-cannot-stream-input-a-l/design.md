## Context

See `proposal.md` for motivation. The relevant machinery, as it exists today:

- `RuntimeCapabilities.streamingInput` (`packages/runtime-sdk/src/index.ts`) is `true` only for
  Claude; every other adapter's `TurnHandle` has no `send`.
- `workers.message()` (`packages/core/src/workers/index.ts:250-294`) already branches on
  `opts.live`: if true, it scans `runState(ctx).active` for an `ActiveRun` for this agent with a
  `.send`, and only Claude ever has one. Every other runtime falls straight through to
  `wake.enqueue({ source: 'conductor_request', reason: body.slice(0,160), payload: { message: body } })`
  — the exact same call `live: false` makes. `opts.live` is otherwise inert today.
- `runs.cancel(actor, id, mode)` (`packages/core/src/runs/index.ts:130-144`) is the one existing way
  to stop a running turn: it sets `ActiveRun.cancelled = mode` and calls the handle's `cancel`, which
  (`packages/runtime-sdk/src/process.ts`) sends `SIGINT` to the whole process group and escalates to
  `SIGKILL` after 30s. It is already called from daemon shutdown (`daemon.ts`'s
  `cancelRunningRuns()`) and from `POST /runs/:id/cancel`.
- `finalize()` (`packages/core/src/runs/engine.ts:424-441`) already treats any `cancelled === 'interrupt'`
  as `status: 'interrupted', errorCode: 'interrupted', errorFamily: 'tooling'` — not a failure. Two
  paragraphs later (`:486`), the agent's status becomes `'error'`, which — contrary to what the name
  suggests — is one of `IDLE_AGENT_STATUSES` (`dispatcher.ts:15`), so the dispatcher will still pick
  the agent up the moment it has a pending wake. No `parkForHuman`/retry-ladder branch fires for an
  `errorFamily: 'tooling'` run that isn't `status === 'failed'`, so nothing here needs changing for
  the agent to become dispatchable again — it already is, as soon as a wake exists for it.
- `buildTurnPrompt` (`packages/core/src/prompts/index.ts`) renders `## Why you were woken` from
  `flattenWakes(wakes)` as `- ${source}: ${reason}` (`:285`) and has a dead `opts.interrupted` flag
  (`:210`, `:341`) that no production caller ever sets — `executeRun` is only ever invoked by the
  dispatcher with no second argument (`dispatcher.ts:155`).
- `describeLiveInput` (`packages/core/src/runs/active.ts:73-82`) is what a browser fetches (via
  `GET /workers/:id`) before the human types, to label the send box.

## Goals / Non-Goals

**Goals:**
- Turn a live human message into an interrupt on a runtime that cannot take mid-turn input, when a
  turn is actually running, using the interrupt path that already exists and is already trusted
  (daemon shutdown, `/runs/:id/cancel`) rather than inventing a new one.
- Make the interrupted run, the resumed turn's prompt, and the human-facing outcome all agree on what
  happened and why.

**Non-Goals:**
- No adapter/protocol work (ACP, per-runtime tool-boundary signalling). See "Reducing the mid-tool-call
  risk" below for why this is not attempted here.
- No change to the retry ladder, to boot recovery, or to `opts.interrupted`'s existing (unused) wiring
  for those paths — fixing that dead flag generally is a separate concern from this ticket's.
- No change to `ac_worker_message`'s behavior. See Decision 1.

## Decisions

### Decision 1 — Only a human's send interrupts; `ac_worker_message` is unchanged

`live: true` is already the default for both places a message reaches a worker today:
`ac_worker_message` (conductor tool, `live: i.live ?? true`) and the worker/ticket page's steer box
(UI hardcodes `live: true`, no toggle exists). If "make `live` mean what it says" applied to both
call sites equally, every conductor steering message would start interrupting non-streaming workers
by default — the conductor calls this tool for routine follow-ups as often as for "stop, you're
going the wrong way," and turning every one of them into a 208-305s discarded turn is not what
"the human must choose it" (proposal, quoting the ticket) means.

So: the interrupt path is gated on `actor.kind === 'human'` (`packages/core/src/api.ts`'s `Actor`).
The two current call sites split cleanly on this already — the UI's `POST /workers/:id/message` is
always a human actor; `ac_worker_message` is `scope: 'conductor'`, always an agent actor — so no call
site needs to change what it passes. A human choosing to type into a running worker's chat, instead
of leaving a ticket comment for later, already is the deliberate "hear me now" act the ticket asks
for; nothing new needs to be surfaced for that choice to exist. `ac_worker_message`'s documented
contract ("tries mid-turn, falls back to queued") stays exactly true for it — it simply never reaches
the new branch, on any runtime, unchanged from today.

**Alternative considered:** a new explicit "interrupt" flag distinct from `live`, decoupled from actor
kind. Rejected: it adds a concept that duplicates the meaning `live` already carries in scenarios the
current spec already claims to handle, and it would require every existing `live: true` call site to
make a new choice explicit before this ticket ships anything, which is more surface than the risk
(an occasionally-too-eager conductor) justifies. If the conductor's own steering later needs the same
power, that is a one-line change to this same gate (drop the `actor.kind` check) once someone has
opted the conductor into paying that cost deliberately — not something to build speculatively now.

### Decision 2 — A third delivery outcome, not a reinterpretation of the existing two

`WorkerMessageOutcome.delivery` (`packages/core/src/api.ts:190`) widens from `'mid_turn' | 'queued'`
to `'mid_turn' | 'queued' | 'interrupted'`. Every place already keying off this string (`active.ts`'s
`recordHumanInputEvent` payload shape, the UI's outcome copy) gets the third arm. This is additive:
existing values keep their existing meaning exactly.

### Decision 3 — Reuse `runs.cancel('interrupt')` unchanged; add only a cause, not a new interrupt mechanism

`workers.message()`'s new branch calls the exact same `runs.cancel(actor, activeRunId, 'interrupt')`
already used for shutdown and `/runs/:id/cancel` — same SIGINT, same process-group target, same
30s-to-SIGKILL escalation (see "established facts" below for why this is safe to reuse as-is). The
only addition is a cause, threaded through so `finalize()` can set a distinguishing `errorCode`:

- `ActiveRun.cancelled` (`active.ts:13`) becomes `{ mode: 'interrupt' | 'kill'; cause?: 'message' }`
  in place of the bare mode string (its one caller, `runs.cancel`, and its one reader, `finalize`,
  both change together).
- `runs.cancel(actor, id, mode, cause?)` takes the optional 4th argument and stores it.
- `finalize()`'s existing `status = 'interrupted'` branch sets `errorCode = cause === 'message' ?
  'interrupted_by_message' : 'interrupted'` — `Run.errorCode` is already a free string
  (`packages/shared/src/types.ts:76`), not a fixed enum, so this needs no schema change and cannot
  collide with anything: nothing before this ticket ever set `'interrupted_by_message'`.

This is how "distinguishable from a daemon-shutdown interrupt" (spec) is satisfied: shutdown and
`/runs/:id/cancel` never pass a cause, so they keep the plain `'interrupted'` they already produce
today; only this new path produces `'interrupted_by_message'`.

### Decision 4 — A new wake source carries the full message; the resumed-turn note is derived, not plumbed

Two smaller decisions bundle here:

1. **New `WAKE_SOURCES` entry `'live_interrupt'`** (`packages/shared/src/enums.ts`), enqueued by the
   same call that would otherwise have enqueued a `conductor_request` wake. Its `reason` carries the
   message itself, not `body.slice(0,160)` — the existing `conductor_request` truncation is a
   separate, pre-existing behavior for routine steering and stays exactly as it is — but it is not
   unbounded either. It is bounded the same way `ThreadsService`'s `wakeBody()` (VS-242,
   `HUMAN_MESSAGE_WAKE_BODY_CHARS = 8000`) and `tickets/service.ts`'s `commentWakeBody()` (VS-246,
   `TICKET_COMMENT_WAKE_BODY_CHARS`, the same 8000) already bound a human's own words flowing into a
   stored wake payload and a rendered prompt line: a same-shaped `liveInterruptWakeBody(body)` in
   `workers/index.ts`, same 8000-char bound (this is prose a human typed into a chat box, the same
   shape those two cover, not a reason to invent a fourth number), returning
   `{ body, truncated?: true, bodyLength?: number }`. `payload` is `{ ticketId, message: wb.body,
   ...(wb.truncated ? { truncated: true, bodyLength: wb.bodyLength } : {}), interruptedRunId }`, and
   `reason` is `wb.body` with `(truncated; full message via ac_ticket_comments)` appended when cut —
   naming where the rest of it lives is free here, because `message()` already calls
   `tickets.comment(actor, agent.ticketId, body, 'relay', ...)` with the **untruncated** `body` before
   any delivery is attempted (existing code, VS-99), so the full text is already durably on the
   ticket regardless of this change. Because `flattenWakes` already renders every wake as
   `- ${source}: ${reason}` (`prompts/index.ts:285`), the (now-bounded) message reaches the prompt
   with no new rendering code — it is already the "Why you were woken" line — and the resumed turn's
   first `ac_inbox` call (step 1 of every worker turn) returns the same bounded `payload.message`
   plus the `truncated`/`bodyLength` markers as structured fields, exactly as it already does for
   `ticket_comment`/`human_message` wakes today.
2. **The interrupted-turn note is derived inside `buildTurnPrompt`, not plumbed through
   `executeRun`'s dead `opts.interrupted`.** Wiring the dispatcher to pass `promptOptions.interrupted`
   correctly would mean deciding, generically, when any resumed run counts as "interrupted" —
   exactly the pre-existing gap the research surfaced for boot recovery, and explicitly out of scope
   (non-goal). Instead, `buildTurnPrompt` checks `flattenWakes(wakes)` for a `'live_interrupt'`
   source directly and, when present, pushes the existing note text (`:341`) alongside a pointer back
   to the "Why you were woken" line rather than repeating the message a second time. This satisfies
   the spec's "told it was interrupted and why, carrying the message" without touching the
   `opts.interrupted` plumbing at all, and without deciding anything about the unrelated paths that
   flag is dead for today.

### Decision 5 — `describeLiveInput` predicts the third outcome for the pre-send label

`LiveInputStatus` (`active.ts:65`) gains an optional `interrupts?: boolean`. When
`!runtime.capabilities.streamingInput` and a run is currently active for the agent (regardless of
`.send`, which such a runtime never has), it reports `{ midTurn: false, interrupts: true }` instead
of today's blanket "no turn is currently running" / "runtime does not support..." reasons — those
two `reason` strings still apply exactly as before when there genuinely is no active run. The route
(`GET /workers/:id`) and UI label already pass this struct through; the UI adds the third label text
per the spec delta.

## Established facts about interrupting mid-tool-call (not assumed)

The ticket asked for evidence, not assumption, on what a `SIGINT` to the process group does to a
tool call in progress. Reused, not new, mechanism (Decision 3) means this is a question about the
*existing* `cancel('interrupt')` path's safety, already relied on by daemon shutdown and
`/runs/:id/cancel` — this ticket adds a new *trigger* for it, not new interrupt semantics.

Tested directly (scratch git repos in `/tmp`, no coding CLI involved, nothing under `work/`
touched):

1. **A child process tree shares the process group and all receives `SIGINT` together.** A
   `git commit` running a `pre-commit` hook that shells out to `sleep 2` — three processes,
   `git commit` → `sh` → `sleep`, confirmed via `ps -o pid,pgid` to share one PGID — all terminated
   the instant `SIGINT` was sent to `-PGID`, exactly as `spawnLines`'s `killGroup` does. This is the
   scenario a runtime's own tool call (which is a child of the runtime CLI, not of the daemon)
   matches: the interrupt reaches it.
2. **Interrupting before a lock is taken leaves nothing behind.** In the test above, `git` had not
   yet created `.git/index.lock` (it only does so right before writing the index, after hooks run);
   after the `SIGINT`, `git status` showed the changes still cleanly staged, no lock file, nothing to
   clean up. This is the common case: most tool calls spend most of their time *before* any lock is
   taken.
3. **`worktreeState()`'s existing check (`git status --porcelain`) does not surface a stale lock.**
   Manually placing an empty `.git/index.lock` and running `git status --porcelain` (exactly what
   `worktreeState`, `packages/core/src/util/git.ts:8-27`, calls) exits 0 with no error and no
   indication anything is wrong — a stale lock is invisible to the one check the resumed turn's
   prompt already runs. `git add`/`git commit` are what fail against it, with a specific, actionable
   message: `fatal: Unable to create '.../index.lock': File exists.` — confirmed directly.
4. **The residual risk is `SIGKILL` after the 30s escalation, not `SIGINT` itself**, and it is not
   new. `SIGINT` gives a well-behaved process (git, `pnpm`, most build tools) the chance to unwind
   cleanly, as (1) and (2) show; only a process still writing when the 30s grace period elapses gets
   `SIGKILL`, which cannot be caught or cleaned up by definition. That escalation, and its 30s bound,
   already exists for every `cancel('interrupt')` caller today (daemon shutdown, `/runs/:id/cancel`);
   this ticket does not change it, add a new trigger for `SIGKILL` specifically, or make it more
   likely — it only adds a new reason `SIGINT` might fire first.

**What this means for the design, concretely:**
- No new interrupt mechanism, no attempt to time the interrupt to a tool-call boundary: no runtime's
  parser here distinguishes "a tool call is running" from "the model is thinking," so there is no
  boundary to wait for without adapter-protocol work, which is explicitly out of scope. This is
  "simply the price," per the ticket's own framing, and it is a price every existing caller of
  `cancel('interrupt')` already pays.
- The resumed-turn note (Decision 4.2) is extended with one concrete, evidence-backed check: if a
  `git` command in the resumed turn fails with `Unable to create '.../index.lock'`, that is a stale
  lock left by the interrupt, not a real conflict — remove the lock file and retry, rather than
  treating it as a worktree problem. This is the one failure mode established above that the
  existing `worktreeState()` prompt line does not already cover.

## Risks / Trade-offs

- **[Risk]** A `SIGKILL` (30s escalation) lands mid-write to something other than `.git/index.lock` —
  a package manager lock, a partially-written file — and leaves worse-than-git-index-lock damage. →
  **Mitigation**: this is the pre-existing risk of `cancel('interrupt')`, unchanged by this ticket;
  the resumed turn is already told (existing note, `:341`, extended per Decision 4.2) to verify what
  it already did before redoing it. No new tool-specific detection is added speculatively — the git
  case is the one with evidence.
- **[Risk]** A human sends several live messages in a burst on a non-streaming runtime, each
  interrupting the previous interrupt's not-yet-dispatched resume. → **Mitigation**: not new either —
  `wake.enqueue`'s existing coalescing (Gate 3, per project knowledge) already bundles wakes that
  arrive before the agent's next dispatch; the second live send's interrupt is a no-op cancel against
  a run that has already finalized once the first has (`runs.cancel` on a non-active run is already
  handled by the existing DB-status-only branch, `runs/index.ts`). No new coalescing logic is added
  for this.
- **[Trade-off]** Scoping to human-only sends (Decision 1) means the conductor cannot yet get the same
  fast interruption for its own steering. Accepted: the ticket's own framing is about the human
  waiting on the worker, not the conductor's steering cadence, and this can be revisited by dropping
  one condition later.

## Migration Plan

No data migration. `errorCode: 'interrupted_by_message'` and `delivery: 'interrupted'` are additive
string values, and no `RunStatus`/`errorFamily`-keyed switch in the UI (`Runs.tsx`'s `RUN_UI`,
`TicketPage.tsx`'s status mapping, `render/transcript.ts`'s tone mapping) branches on `errorCode`, so
none of those need a new arm to compile or to keep showing `interrupted` as distinct from `failed`.

`delivery` is different: `WorkerPage.tsx:164` and `TicketPage.tsx:472` both read the outcome as
`outcome.delivery === 'mid_turn' ? '...delivered...' : '...queued...'` — a binary ternary that would
silently mis-report an `'interrupted'` outcome as "Queued for the next turn," the opposite of what
the spec requires. Likewise `WorkerPage.tsx:92` / `TicketPage.tsx:411` predict the pre-send label off
`input.midTurn` alone. Both pairs are explicit tasks (not an incidental follow-on): the ternaries
become three-armed, keyed off `delivery` / the new `input.interrupts`, before this ships.

No feature flag: the behavior only activates on the exact combination (human sender, `live: true`,
non-streaming runtime, turn currently running) that today silently and misleadingly reports "queued"
while a human waits minutes to be heard — there is no prior behavior worth preserving behind a flag.
