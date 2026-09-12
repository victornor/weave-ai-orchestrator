## Context

See `proposal.md` — Why. This section records the investigation the ticket asked for before any
change: which of the two mechanisms actually invalidates captain's login, what VS-75 and VS-105 each
solved, and whether removing them reintroduces either problem.

**Which mechanism does the damage.** The rotation does. `ensureFreshCredential` (VS-105) calls
`adapter.describeAccount` specifically to make the `claude` (or `cursor`) CLI exchange its refresh
token, whenever `readCredential` reports less than `minValidMs` (45 minutes, `turnTimeoutMs`) of life
left — in practice close to every spawn, since a Claude access token's own natural lifetime is
commonly shorter than that margin. The exchange itself is what invalidates every other holder of the
prior refresh token the instant it succeeds — including captain's own already-running CLI, which
never touched AgentConductor at all. The write-back (`reconcileRuntimeCredential`, VS-75) that
follows is a repair, not a cause: `reconcileOne` returns immediately (one `lstat`, no write) whenever
the workspace path is already an intact symlink to the host path, which is the state a turn spawn
finds it in almost all the time. It only opens either path for writing when it finds the two have
already forked into separate files — i.e. only *after* a rotation has already happened somewhere.
The ticket's own initial framing ("`reconcileCredential` ... runs at `engine.ts:377` on every spawn
... that is us writing `~/.claude/.credentials.json`") conflated *being called* with *writing*; being
called on every spawn is real, writing on every spawn is not. This distinction is the crux of
Decision 2 below: the call stays on the turn-spawn path because, in the case where it does write, that
write is what rescues captain's own session — not what endangers it.

**What VS-75 solved.** Before VS-75, each workspace kept its own *copy* of the host credential
(`seedRuntimeCredentials`), re-taken by file modification time. Two live copies of a rotating
credential diverge the moment either one refreshes, and mtime-based reconciliation could pick the
*older* (dead) one over the newer (live) one. VS-75 replaced the copy with a symlink plus an
expiry-based repair, so there is exactly one live file per runtime per host and a repair never
regresses to a stale token. That problem — divergent copies chosen by the wrong signal — is
unaffected by this change and stays fixed: the symlink and the expiry-based repair rule both stay.
Only *when* the repair runs changes (see Decision 2).

**What VS-105 solved, and whether removing it reintroduces the problem.** VS-105 responded to a real
incident: 7 turns spawned within one second, and separately 4 paused workers resumed within one
second of each other, each cluster producing real `auth`-family failures. The mechanism was a race
between *the real turns' own CLI processes*, each independently deciding to refresh at nearly the
same moment because they share one host credential: the first exchange wins, every other process was
already holding the refresh token that exchange just invalidated. VS-105's fix was to run one
proactive probe ahead of a burst of spawns, confirm the shared credential fresh for a full turn's
duration, and hold every spawn until that one probe resolved — which incidentally also prevented the
real turns' own processes from needing to refresh during the burst at all, since the probe had
already made sure they wouldn't need to.

Removing VS-105 without replacing it *does* reopen that specific race in principle: nothing now stops
several real turns from spawning at once with a credential that happens to be genuinely near expiry,
each independently deciding to refresh. This is named here rather than traded away silently, per the
ticket's own instruction. It is accepted anyway, for two reasons the ticket itself gives: (1)
acceptance criterion 1 is unconditional — "no probe is spawned in order to rotate a token" — and
VS-105's mechanism is exactly such a probe, so no version of it can be kept; (2) the ticket's stated
preference is explicit — "a failed turn is cheap, an invalidated login is not." A turn that loses this
race reports an ordinary `auth`-family failure and is handled by the unchanged `login-outage`
capability (one gate, one decision, automatic resume once the credential is confirmed working again)
— worse throughput for that burst, not a broken login. If this recurs in practice, the fix is to
stagger real spawns, not to reintroduce a probe whose purpose is provoking a rotation; that is out of
scope here and left as a note for a future ticket if the recurrence is observed.

**Per-runtime applicability.** `ensureFreshCredential` no-ops unless the adapter implements both
`readCredential` and `describeAccount`. Only `claude` and `cursor` implement `readCredential` today;
`codex`, `gemini` and `opencode` do not, so the forced-refresh bug never applied to them. The
credential-file-write mechanism (`linkRuntimeCredentials`/`reconcileRuntimeCredential`) is not gated
the same way — `credentialPaths` lists entries for all five runtimes, and `engine.ts` called
`reconcileCredential()` unconditionally before checking whether the adapter supports freshness at
all. So the write-based fix applies uniformly to all five; the refresh-based fix is only observable
for `claude` and `cursor`, and is a no-op change for the other three.

**Per-workspace copying.** The ticket asked whether the credential is copied into per-workspace
config homes. It already is not, as of VS-75: `credentialPaths` in `loader.ts` builds
`[hostPath, workspacePath]` pairs and `linkTo` makes the workspace path a symlink to the host path,
never an independent copy, except for the one-time "adopt whichever side is newer" step the first
time a workspace/runtime pair is set up. No change is needed here; it is recorded because the ticket
asked the question directly.

**Can `reconcileOne`'s expiry comparison pick a stale file over a fresher one.** Checked directly,
because the answer decides whether keeping the repair on the turn-spawn path (Decision 2) is safe.
`reconcileOne` compares `expiry(dst)` and `expiry(src)` as ISO-8601 strings and keeps whichever is
later; both are read by the same `credentialExpiry`, which for Claude decodes
`claudeAiOauth.expiresAt` (epoch ms) with no adjustment. An OAuth access token's expiry is fixed at
issuance to `issuedAt + TTL` with a constant TTL per client; under that (standard, and true of every
runtime's adapter here), a later `expiresAt` can only come from a *later* issuance, and a later
issuance is always the live one — the refresh that produced it is, by construction, the most recent
exchange against the shared refresh token, so nothing earlier is still valid regardless of what its
own `expiresAt` says. A credential whose expiry cannot be parsed at all (present but unreadable, or
the expiry-less `claude setup-token` case) is already excluded from ever winning by the
`theirs !== null && ours !== null` guard — the host's is kept, unmodified, exactly as
`single-credential`'s existing "an unreadable expiry is not a reason to overwrite" scenario requires.
No scenario was found where a stale file outranks a fresher one; no code change follows from this
check.

## Goals / Non-Goals

**Goals:**
- No code path spawns a CLI process for the purpose of causing it to refresh.
- No code path opens a runtime's credential file for writing except the existing fork-repair check
  (which only writes when it finds a real fork) and the one-time link/adopt step run when a
  workspace's runtime config homes are set up. Nothing new is added that writes.
- An already-failing credential is reported the same way it always has been — as the runtime's own
  authentication failure — with no new pre-spawn check standing in front of it.

**Non-Goals:**
- Replacing VS-105's coordination with a different, non-rotating coordination mechanism. The ticket's
  direction is strictly less session management; a narrower fix for the reopened race (Decision 3) is
  deferred, not designed here.
- Changing how a workspace's runtime config home is isolated from the host's own settings, session
  history or project list. Only the credential file is shared; that boundary is unchanged.
- Changing anything about `daemon-isolation` daemons, which never resolve to the host's real
  credential in the first place.

## Decisions

**Decision 1 — delete `credentialFreshness.ts` and its call sites; add no replacement check.**
Alternatives considered: (a) keep a read-only pre-spawn check that fails the turn immediately if the
credential file already shows an expiry in the past, without spawning anything. Rejected: an
access-token expiry in the credential file is routinely stale for a credential that is actually fine
(the CLI refreshes it transparently on its own, the same way it does for captain's interactive use);
turning that into a hard pre-spawn failure would fail turns that would otherwise have succeeded, for
no gain over just letting the turn's own CLI invocation decide. (b) Keep `minValidMs` but raise it or
lower it. Rejected: any positive margin still forces a probe ahead of actual need — the size of the
margin is not the defect, provoking a refresh at all is.

**Decision 2 — keep `reconcileRuntimeCredential`/`linkRuntimeCredentials` exactly where they run
today on the turn-spawn path (`engine.ts`); remove only the account/usage probe's call to it.**
Alternatives considered, and superseded from an earlier draft of this design that chose differently:
(a) remove the call from the turn-spawn path too, leaving it only at workspace/runtime bootstrap.
Rejected on review: a fork can occur without any daemon involvement — a real turn's own CLI process
may still refresh mid-turn if the credential was already close to real expiry when the turn started
(the CLI's normal behavior, unrelated to anything this change touches), which forks the symlink the
same way it always could. That fork leaves the *host's* copy holding the superseded, now-invalid
refresh token — exactly the failure captain experiences. Today that self-heals on the very next turn
spawn, because the repair runs every spawn and costs one `lstat` when there is nothing to repair.
Moving the repair to bootstrap-only would turn "self-heals within one turn" into "stays broken until
the next daemon restart" — a regression on the exact symptom this ticket exists to fix, traded for
literal compliance with a written acceptance criterion whose own text ("nothing writes ... anywhere in
a turn spawn") was based on the mistaken belief that this call writes unconditionally. It does not:
`reconcileOne` returns before touching the filesystem for writing whenever the symlink is already
intact. (b) Delete the repair function entirely. Rejected for the same reason, more severely. The
call site on the turn-spawn path stays as it is today, unchanged by this ticket; only its invocation
from `usage/accounts.ts`'s probe is removed, since a billing/plan read has no legitimate reason to
repair a credential.

**Decision 3 — the reopened concurrent-refresh race (Context) is accepted, not mitigated, in this
change.** A narrower fix — staggering real turn spawns for a runtime whose credential is close to
expiry, without spawning anything extra to provoke a refresh — is a legitimate future direction if
the race is observed to recur, but is new design work the ticket's "not in scope" section rules out
here ("the direction is strictly less session management, not different session management").

## Risks / Trade-offs

- **[Risk] A burst of concurrent turn spawns against a near-expiry credential can again race, exactly
  as it did before VS-105.** → Mitigated only by the existing `login-outage` gate: a turn that loses
  the race reports an ordinary auth failure, the runtime is gated once, one decision is raised, and
  every waiting agent resumes automatically once a probe confirms the credential works — unchanged
  machinery, not a new outage class. Not eliminated; accepted per Decision 1/3 and the ticket's own
  stated preference.
- **[Risk] A mid-turn natural refresh by the real CLI can still fork the symlink.** → Unchanged from
  today, and no longer a residual gap: the turn-spawn repair (Decision 2) still runs on the very next
  spawn and heals it within one turn, exactly as it does now. Named here only because it is the
  scenario Decision 2 is answering, not because anything about it is worse after this change.
- **[Risk] `usage/accounts.ts`'s billing/plan probe still spawns the real CLI on a supervisor cadence,
  and that CLI may refresh as an ordinary side effect of being invoked.** → This is inherent to
  spawning any real CLI and cannot be separated from the CLI's own internal behavior without patching
  the CLI; the ticket's own "not in scope" section accepts this explicitly for legitimate billing
  reporting. Only the reconcile *write* that preceded this probe is removed; a fork this probe's own
  CLI invocation causes is still healed by the next turn spawn on that runtime, per Decision 2.

## Migration Plan

No data migration. No `.openspec.yaml`/config change. Deploys as a normal code change: on upgrade,
the next daemon start still runs the one-time bootstrap link for every runtime in use (unchanged
code path), so an already-shared credential stays shared. No rollback concern beyond reverting the
commit — nothing here is stateful beyond the credential file itself, which this change stops writing
to more often, not less safely.
