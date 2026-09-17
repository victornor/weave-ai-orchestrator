## Context

See proposal.md — Why. Two compaction paths exist in the daemon today:

- **Daemon-initiated (out-of-band).** `workers.compactSession` (`packages/core/src/workers/index.ts`)
  sets `agent_sessions.compacting_at`, broadcasts the ephemeral `session.compaction` frame, runs the
  runtime's `compactSession` in the background, then clears the mark and broadcasts the closing
  frame. VS-500 made `sessions.setCompacting` consume `last_context_tokens` when a compaction starts.
- **Adapter-initiated.** The CLI decides to compact mid-turn. Claude reports this on its turn stream
  as `session.compaction.started` / `session.compaction.completed` (VS-454, parsed in
  `packages/runtimes/claude/src/events.ts`). The engine's `record` persists those as run events, and
  the V2 live trace renders the `Compacting conversation…` row from them — but nothing writes the
  session state, so `compacting_at` stays null, the composer banner never appears, and the turn's
  finalize can leave a pre-compaction `last_context_tokens` behind.

## Goals / Non-Goals

**Goals**

- One session state (`compacting_at`) for both paths, so the dispatcher gate, the `GET /conductor`
  and `GET /workers/:id` views and the composer banner behave identically however compaction started.
- No stale context observation survives an adapter compaction.
- State per runtime, honestly, whether its adapter reports compaction at all.

**Non-Goals**

- No change to the VS-500 out-of-band path beyond sharing the session service.
- No new persisted "origin" column and no migration.
- No token-drop heuristic to fabricate a banner on runtimes that emit nothing.
- No UI change: VS-454 already renders the live row and the completed marker from the run events,
  and the composer banner is already driven by the `session.compaction` frame.

## Decisions

### Drive the session state from the engine's turn event stream

The engine already receives every normalized runtime event at `onEvent` in
`packages/core/src/runs/engine.ts` (the `phase('turn')` call), where `turnSession.session` is in
scope. On `session.compaction.started` it will call `sessions.setCompacting(sessionId, nowIso())`
and `ctx.events.broadcast('session.compaction', 'agent', agent.id, { agentId, compacting: true, at })`;
on `session.compaction.completed` it clears the mark and broadcasts the closing frame. This reuses
the exact frame the UI already listens to, so the composer banner appears and clears with no UI
change. The alternative — a second writer in the dispatcher, or a runtime-side callback — either
lacks the session scope or duplicates the state transition.

### One origin state, origin carried in the notification only

`compacting_at` means "the session is mid-compaction; hold its wakes and show the banner". That
invariant is identical for both paths, so a second origin column would add migration and
stale-state rules for no behavioural gain. The origin is recorded (a) in the activity/log line and
(b) as an `origin` field on the broadcast payload, so an operator can tell the two apart. **Finding:
the session state is deliberately indistinguishable; the origin lives in the event, not the row.**

### Record the post-compaction size; otherwise clear, and never let finalize clobber it

`last_context_tokens` is written by `sessions.record` in `finalize` from the turn's
`usage.contextTokens` (the last model request's size). When a compaction happens at the end of a
turn, that number can be the pre-compaction one, so clearing the observation at compaction start is
not enough — finalize would put the stale value back. Therefore:

- At `session.compaction.completed`, store the boundary's `postTokens` when present, else null.
- `finalize` receives a turn-scoped `compactedInTurn` flag and, when set, does not overwrite
  `last_context_tokens` from `usage.contextTokens`; the value written at completion stands.
- Add a narrow session-service method for the completion write (e.g. `setCompacting` gains a
  post-compaction size, or a `noteCompactionEnd(sessionId, postTokens)`), keeping the session service
  the one writer.

The next turn's normal usage recording supplies a fresh observation, exactly as VS-500 intended.

### Per-runtime detectability (named, not guessed)

| Runtime | Adapter-initiated compaction detectable live? | How |
|---|---|---|
| Claude | Yes | `system`/`status` `status:"compacting"` → started; `system`/`compact_boundary` with `compact_metadata.{trigger,pre_tokens,post_tokens,cumulative_dropped_tokens}` → completed (VS-454). |
| Codex | No | `codex exec --json` carries no compaction item; its parser models none and would fall through to `runtime.raw`. Codex does auto-compact (`model_auto_compact_token_limit`), but silently. |
| OpenCode | No | `opencode run --format json` serializes no compaction event; `session.status` is `idle|retry|busy`, and `session.compacted` / `session.next.compaction.*` are bus/TUI-only (VS-454). |
| Cursor | No | No compaction event in its turn stream. |
| Gemini | No | No compaction event in its turn stream. |

For the runtimes that emit nothing, the V2 live row and the composer banner stay absent — the
honest outcome, per the ticket's "do not fake a banner from a heuristic". Claude is the only runtime
that gets the banner from the adapter path.

**Codex note.** Codex's `last_context_tokens` is read per turn from the thread's rollout
(`readThreadContextTokens`), so it is expected to reflect a post-compaction state even without a
signal; this is stated as an expectation, not a guarantee, and the stale-observation requirement is
only asserted where a completion signal exists (Claude).

## Risks / Trade-offs

- **A `started` with no `completed` within the turn** (e.g. the turn is cut mid-compaction) → the
  mark would stay set and hold wakes. Mitigation: `finalize` clears any compaction mark this turn
  set when the run ends without a completion, mirroring the daemon path's guarantee that a failure
  still clears the mark (VS-500); a completion may also arrive on a later turn's stream, which
  clears it then.
- **Setting `compacting_at` during a running turn is redundant for dispatch** (a running turn is
  already un-dispatchable) → harmless; it is what makes the banner, the session view and the
  release-on-completion honest, and it keeps one code path.
- **Claude is the only runtime with live evidence** → the tests exercise the engine path with a fake
  runtime adapter's scripted events, never the real CLI (the credential rule forbids it).

## Migration Plan

No schema migration: `compacting_at`, `compacting_error` and `last_context_tokens` already exist and
are nullable. Deploy the daemon change; roll back the application if the banner or dispatch gate
misbehaves. Existing Claude sessions need no re-provisioning.

## Open Questions

None.
