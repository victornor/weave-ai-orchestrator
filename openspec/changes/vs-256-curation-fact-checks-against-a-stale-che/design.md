## Context

See `proposal.md` — Why, for the VS-255 incident and the two compounding gaps (nothing fetches the
primary clone before a curation turn; nothing structurally points the curator at it once fetched).

Relevant existing shape:

- `spawnCurator` (`packages/core/src/workers/index.ts:219-229`) always spawns with `opts.noWorktree:
  true` — `agent.worktreePath` stays `null` for the life of the ticket.
- `ProjectsService.fetch(id)` (`packages/core/src/projects/index.ts:333-350`) already does exactly the
  fetch-and-fast-forward this change needs: `git fetch origin`, `git checkout <landing>`, `git merge
  --ff-only origin/<landing>`, records `Project.syncState` (`'in_sync'` or `'diverged'`) and
  `Project.lastFetchedAt`, and re-indexes specs on a successful fast-forward. It is already used by
  `reconcilePass` (`packages/core/src/supervisor/index.ts:676-681`) — that call site swallows failure
  into a `log.warn` and nothing else, which is the VS-131 silent-failure mode. This change adds a
  second call site with a different failure response (block the ticket); it does not change
  `reconcilePass` or `fetch` itself.
- `executeRun` (`packages/core/src/runs/engine.ts:186-`) already has the exact idiom this change
  needs: the `model_unconfigured` block (lines 230-244) resolves a precondition before the turn is
  considered started, and on failure emits `run.started` + an `error` record and calls `finalize`
  directly with a `failure`, never reaching `phase('prepare_home', ...)` or spawning the runtime
  process. This change adds a second precondition of the same shape, specific to a curation-originated
  ticket.
- `TurnInput.worktree` (`packages/runtime-sdk/src/index.ts:29`) is `{ path, branch } | null` and is
  used by exactly two runtime adapters (`claude`, `gemini`) to grant `--add-dir` filesystem access
  beyond `cwd`. It is populated once, at `engine.ts:340`, straight from `agent.worktreePath`.
- `workerData()` (`packages/core/src/prompts/index.ts:101-137`) already loads both `project` and
  `ticket` rows fresh from the DB (not the possibly-stale copies `executeRun` loaded earlier in the
  same turn), so a field it reads after the new gate has run sees that gate's own writes
  (`Project.syncState`, `Project.lastFetchedAt`).
- `ticket.originKind === 'curation'` is already set, once, at ticket creation
  (`workers/index.ts:226`) and never changes — it is a stable, durable way to identify a curation
  ticket from `engine.ts` and `prompts/index.ts` without adding a new field.

## Goals / Non-Goals

**Goals:**
- A curation turn's runtime process is never spawned unless the primary clone was just verified to
  match `origin/<landingBranch>`, on every turn the ticket takes (not only its first).
- When that verification fails, the ticket ends up `blocked` with a routable `{owner, action}`, not
  silently retried and not silently left `todo` forever.
- The curator's `work/` reference resolves to a real, absolute, just-verified path — not a string with
  nothing behind it.
- Reuse `ProjectsService.fetch` and the `model_unconfigured` early-exit idiom exactly; no new
  freshness concept, no new error-code enum member (`Run.failure.code` is already a free-form
  `string`, not `ErrorCode`), no change to the `WorktreeProvider` plugin-sdk contract.

**Non-Goals:**
- Fixing `reconcilePass`'s own silent-failure logging (VS-131). That is a pre-existing, general gap
  affecting every project's primary clone, independent of curation; this change adds a second,
  curation-specific call site with its own explicit failure handling, and leaves the sweep's behavior
  untouched.
- Giving curation a real `git worktree` (a second branch, a second checkout). Curation never commits;
  a dedicated worktree would need its own freshness handling anyway (`GitWorktreeProvider.create`
  does not fetch — see Decision 1) and adds nothing a direct, verified read of the primary clone does
  not already give.
- Gating the `ac_knowledge_replace` tool call itself, or distinguishing at the tool layer which
  changes in a rewritten file were removals-as-contradicted versus merges/moves. The gate in this
  change is coarser and earlier: if the checkout can't be verified, the curator never runs at all this
  turn, so no write of any kind — safe or not — happens on unverified evidence. See Decision 2.
- Repairing fernwood's knowledge base (explicitly out of scope on the ticket) — a separate follow-up,
  not attempted from a stale checkout either.

## Decisions

### 1. Verify the shared primary clone directly; do not give curation its own `git worktree`

**Alternative considered:** spawn curation like an ordinary ticket — a real `git worktree add`
against a dedicated branch (the "ordinary path" the ticket description itself floats).

**Rejected because** it does not actually solve the problem by itself.
`GitWorktreeProvider.create` (`packages/core/src/worktrees/git.ts:17-38`) resolves its base ref via
`resolveBaseRef`, which reads whatever `origin/<branch>` already resolves to in the **primary
clone's** local refs — it does not fetch. A freshly created worktree is only as current as the primary
clone was at that moment; giving curation a worktree would still need the same "fetch and verify the
primary clone first" step this change adds, making the worktree itself pure overhead: a second
checkout, a throwaway branch, `git worktree add`/`remove` on every run, for a ticket that is
structurally never allowed to write to it. Verifying and reading the primary clone directly is the
smaller, sufficient change.

### 2. The gate is per-turn, all-or-nothing, and lives in `executeRun` — not a tool-level check on `ac_knowledge_replace`

**Alternative considered:** let the turn run regardless of freshness, but have the server reject (or
the runtime's tool grant exclude) `ac_knowledge_replace` specifically when the clone could not be
verified, downgrading a would-be removal to a flagged comment.

**Rejected because** distinguishing "this rewrite only merged/moved text" from "this rewrite removed a
fact because the repo disagreed with it" is a semantic judgment about the diff's content, not
something the daemon can check mechanically at the tool boundary — the curation procedure's own steps
(merge, promote, remove what the repo says, remove what's contradicted, archive, tighten, rebalance)
all funnel through the same one write. Trying to gate only "removal for cause" would need the daemon
to parse curation's reasoning, which is exactly the kind of instruction-trusting check this ticket
exists to replace with something structural. Refusing to run the turn at all when freshness can't be
established is coarser (no curation work happens that turn, not just no deletions) but is a single,
mechanical precondition the daemon can actually enforce, and curation reschedules cheaply — it is a
low-priority, low-frequency ticket kind, not work with a deadline.

### 3. Freshness is re-verified on every turn, not cached from spawn time

**Alternative considered:** verify once, at `spawnCurator`, and let every subsequent turn on that
ticket proceed unchecked.

**Rejected because** a curation ticket can take more than one turn (a revision comment, a relaunch
after a crash), and origin can move — or the clone can start failing to fetch — in between. A cached
"was fresh at spawn" fact would silently stop meaning what it says. Re-running the same cheap check
(one `git fetch` + `merge --ff-only`, already bounded to 120s by `ProjectsService.fetch`) each turn
keeps the guarantee true for the turn that is actually about to run, at the cost of one redundant
fetch on the very first turn (spawn does not pre-check; the first turn's gate is the only check). That
redundancy is intentional: one code path, exercised identically every time, is easier to verify than
"first turn is special."

### 4. On failure, transition straight to `blocked` from inside the gate, before calling `finalize`

**Alternative considered:** let the run simply fail (`status: 'failed'`) and rely on the existing
retry ladder / stalled-ticket detection to eventually surface it.

**Rejected because** the retry ladder exists for transient run failures where retrying the same turn
might succeed — but retrying does not help here without the underlying clone being fixed, and blindly
retrying would just repeat the same fetch failure on the same schedule as any other transient error,
delaying the point at which a human learns the primary clone needs attention. Transitioning to
`blocked` with `{owner: "conductor", action: "<what failed>"}` immediately, from the gate itself
(mirroring how a worker would report the same shape via `ac_report`/`ac_ticket_transition`, but done
by the daemon since no worker turn ever started), makes the failure visible and routed on the first
occurrence rather than after the ladder exhausts itself.

## Risks / Trade-offs

- **Extra `git fetch` cost per curation turn.** Curation tickets are low-frequency (gated by the
  14-day/budget schedule in `knowledge/scheduled-curation`) and `ProjectsService.fetch` is already
  bounded (120s fetch, 30s checkout, 120s merge) — negligible against how rarely this runs.
- **A project whose primary clone is persistently diverged blocks curation indefinitely.** This is the
  intended behavior (AC2: does not default to proceeding) — the block's `action` text names the
  problem, and fixing a diverged primary clone is already a thing a human/conductor can do (the same
  fix `reconcilePass`'s failure needs, today invisible; this change is the first place that failure
  becomes an actionable ticket instead of a buried log line, for at least the curation path).

## Migration Plan

None. No schema change (`Project.syncState`/`lastFetchedAt` already exist), no data backfill, no
behavior change for any ticket that is not `originKind: 'curation'`.
