## Context

See `proposal.md` for the incident. This section establishes *which* of the ticket's two candidate paths
ran, by static trace, and lays out the pieces the fix touches.

### How (a) vs (b) was established

By reading the code, not by reproducing against any daemon:

1. `packages/cli/src/upgrade-runner.ts`'s `restartCommand()` builds its `RestartEnvironment` from
   `unitInstalled: existsSync(serviceUnitPath())`, where `serviceUnitPath` is imported from
   `packages/cli/src/daemon.ts:129-131`:
   ```ts
   export function serviceUnitPath(): string {
     return join(process.env['XDG_CONFIG_HOME'] ?? join(homedir(), '.config'), 'systemd', 'user', SERVICE_NAME);
   }
   ```
   This checks **only** `SERVICE_NAME` (`weave-ai.service`, the post-VS-260 name). It has no legacy
   fallback. This is a *different* function from the similarly-named one in
   `packages/server/src/upgrade.ts:515-521`, which does fall back to `agent-conductor.service` — but that
   copy is only ever used to decide whether the *runner* needs its own `systemd-run` scope
   (`launchRunner`), never to build the restart command itself.
2. On this host the installed unit is `agent-conductor.service`. `existsSync(serviceUnitPath())` (the
   CLI's copy, no fallback) is therefore `false`, so `planRestart` (`packages/release/src/index.ts:279-297`)
   falls through both the `linux && unitInstalled` and `darwin` branches and returns
   `{ restart: null, launch: 'detached', runnerSurvives: true, how: 'stop and start the daemon' }`.
3. `restartCommand()` sees `!plan.restart` and returns `run: async () => { await stopDaemon(); startDaemon({}); }`.
   `stopDaemon()` (`packages/cli/src/daemon.ts:87-102`) reads `<stateHome>/daemon.pid` — a file only
   `weave daemon start` ever writes. The service-managed daemon was started by systemd's own
   `ExecStart=`, never through that path, so the file is absent (or stale); `stopDaemon()` sees nothing
   running and returns immediately having touched nothing. **The live daemon is never signalled.**
4. `startDaemon({})` (`packages/cli/src/daemon.ts:62-79`) then spawns a **second**, independent daemon
   process from the just-built release (`resolveServerBin()` follows the already-switched `current`
   symlink). It runs inside the runner's own `systemd-run --scope --collect` wrapper
   (`inOwnScope`, `packages/release/src/index.ts:301-303`), which the daemon chose in step 2 because
   `systemdRunAvailable` was true.
5. That second daemon boots normally: `packages/server/src/daemon.ts:136-140` unconditionally
   overwrites `<configDir>/daemon.json` with its **own** `pid` and `loopbackUrl` — the loopback listener
   binds `AC_LOOPBACK_PORT ?? 0` (`packages/server/src/daemon.ts:432`), i.e. an OS-assigned free port, so
   it never collides with the live daemon's socket. The runner's health probe
   (`packages/cli/src/upgrade-runner.ts` → `healthUrl(config)`) reads `daemon.json` fresh, so it now
   points at this second daemon, which truthfully reports the target release. `driveRestart` accepts
   that as `completed` in the next probe tick.
6. The second daemon also boots its channel manager and polls Telegram with the workspace's bot token —
   the same token the still-live daemon (pid 765706) is already polling with — which is exactly the
   `getUpdates` conflict the incident recorded one second after the runner started.
7. Because the second daemon runs inside the runner's `--collect` scope, systemd tears the whole scope
   down, second daemon included, the moment the runner process exits after writing its verdict — matching
   the observed ~3.09s runner lifetime. The live daemon, untouched throughout, keeps serving the old
   release.

This is **candidate (a)**, confirmed by tracing every step against the actual source rather than by
inference from the symptoms alone; no command was run against any real daemon or unit to establish it.

## Goals / Non-Goals

**Goals:**
- A restart command that can fail loudly, targets whatever unit is actually on the host, and is only
  trusted once the process it targeted has verifiably been replaced.
- The runner can never again have two daemons live at once.
- Dispatch never again stays held indefinitely in a process whose restart silently never happened
  (Decision 6).

**Non-Goals:**
- A manual "migrate my unit now" command. Migration (Decision 4, revised 2026-09-13 per captain) only
  ever happens as a side effect of an upgrade that finds the legacy unit installed — never standalone,
  never outside the upgrade pipeline.
- launchd (macOS) *verification* stays best-effort as before (see Decision 3); the migration path
  covers launchd symmetrically with systemd (per captain's direction below) but with the same
  best-effort caveat on the legacy label, since no host has exercised it yet — see Decision 4.
- Anything about the upgrade *announcement* (VS-315) itself — out of scope per the ticket, but see the
  coordination note in Risks / Trade-offs: VS-315 touches the same file and the same outcome/failure
  vocabulary this change extends.

## Decisions

### Decision 1: One `resolveInstalledUnit()`, not two `serviceUnitPath()`s

`packages/release/src/index.ts` (a leaf package both `server` and `cli` already depend on for
`SERVICE_NAME`/`planRestart`/`inOwnScope`) gains:

```ts
export interface InstalledUnit { name: string; path: string; legacy: boolean }
export function resolveInstalledUnit(): InstalledUnit | null {
  const dir = join(process.env['XDG_CONFIG_HOME'] ?? join(homedir(), '.config'), 'systemd', 'user');
  const legacy = join(dir, 'agent-conductor.service');
  if (existsSync(legacy)) return { name: 'agent-conductor.service', path: legacy, legacy: true };
  const current = join(dir, SERVICE_NAME);
  return existsSync(current) ? { name: SERVICE_NAME, path: current, legacy: false } : null;
}
```

(`legacy` added 2026-09-13, for Decision 4: migration only ever triggers off this flag, never off a
name comparison scattered at each call site.) **Revised 2026-09-13 (PR #265 review): legacy wins when
both files exist**, not current. Originally this preferred whichever name's file existed, current first
— but an interrupted migration (Decision 4) can leave the new unit's file on disk without it ever having
become the one actually running (prepare wrote it, then `enable` failed; or cutover's own `start` never
came up). Preferring it just because the file exists would make a *later* upgrade `systemctl restart` a
unit nothing replaced — recreating the exact two-daemons shape this ticket removes. Migration is safe to
re-attempt from the legacy side (prepare's `writeFileSync` simply overwrites the stale file); it is not
safe to assume the new side already won. Decision 4's own fix (undoing prepare on every path that
doesn't finalize) means the new file is not normally left behind at all — this ordering is the second,
independent layer of defense, not the only one.

The launchd equivalent, `resolveInstalledLaunchdAgent(): { label: string; path: string; legacy: boolean
} | null`, mirrors it exactly, legacy-first too: the inferred pre-rename label
`com.agent-conductor.daemon` — inferred by the same "agent-conductor" ↔ "weave"/"weave-ai" convention
`resolveInstallPath` already applies to paths (VS-258), since no shipped macOS install has confirmed
this literal in code; if it's wrong on some host, that host's legacy agent simply never matches either
lookup and behaves exactly as "no unit installed" does today — not a new failure mode.

Both `packages/server/src/upgrade.ts`'s `launchRunner` (deciding whether the runner needs its own scope)
and `packages/cli/src/upgrade-runner.ts`'s `restartCommand()` (deciding what to restart) call this one
function. `packages/cli/src/daemon.ts`'s existing `serviceUnitPath()` is kept as-is and unchanged in
meaning: it is "where a *new* unit gets written" (`installService()`), which must always be the current
name — conflating it with "what's installed today" is exactly the class of bug this fixes, so the two
stay separate functions with separate jobs.

**Alternative considered**: teach the existing `serviceUnitPath()` the legacy fallback in place. Rejected
— it is still imported by `installService()`, and a fallback there would make a *fresh* install silently
prefer to overwrite a legacy file it happens to find, which is a different, unrelated decision (Decision
4) that should not ride along with this fix.

### Decision 2: `RestartEnvironment.unitInstalled: boolean` becomes `unitName: string | null`

`planRestart` (`packages/release/src/index.ts`) currently hardcodes `SERVICE_NAME` into the restart
command whenever *some* unit exists, regardless of which one. It now receives and uses the resolved name:

```ts
if (env.platform === 'linux' && env.unitName) {
  return {
    restart: { cmd: 'systemctl', args: ['--user', 'restart', env.unitName] },
    ...
    how: `systemctl --user restart ${env.unitName}`,
  };
}
```

`planRestart` stays pure (a mapping from environment facts to a plan); both call sites pass
`unitName: resolveInstalledUnit()?.name ?? null` instead of a boolean.

### Decision 3: verifying "the process that was replaced is gone"

Adding `pid: process.pid` to `/api/health`'s response (`packages/server/src/routes/daemon.ts`) is not
enough on its own — a stray process also has *some* pid, and "the pid changed" is true for a legitimate
restart and for the incident's stray process alike. What is checked instead is whether the pid that
answered the probe matches the pid the restart path itself trusts as authoritative:

- **systemd path**: after `systemctl --user restart <unit>` succeeds, `systemctl --user show <unit>
  --property=MainPID --value` is systemd's own record of who it is running as that unit right now.
- **direct-start fallback**: the runner started the replacement itself; `startDaemon()`'s return value
  *is* the authoritative pid, no introspection needed.
- **launchd**: best-effort via `launchctl print`; `null` (i.e. "can't verify," see Non-Goals) on parse
  failure, same as today's behavior.

`driveRestart` (`packages/cli/src/upgrade-runner.ts`) gains a `RunnerIo.confirmsReplacement(pid:
number): Promise<boolean | null>` seam alongside the existing `probe()`, called with the probe's own
`health.pid`. A probe is only accepted as `completed` when it answers `ok`, matches the target release
(unchanged `onTarget` check), **and** `confirmsReplacement(health.pid)` is `true`. `null` means the host
can't tell either way — the existing release-match check is trusted alone, no regression for a platform
or configuration this can't reach; `false` means a process other than the service-managed one answered,
so this probe is rejected but polling continues (it might still complete on a later tick, e.g. once the
migrated unit's own process comes up — see Decision 4).

**Revised 2026-09-13 (review rev 1)**: a bare `health.pid === MainPID` equality check rejects a
legitimate service whose `ExecStart` is a wrapper that doesn't `exec` into the final process — systemd's
`MainPID` then names the wrapper, not the node process that answers `/api/health`. `confirmsReplacement`
is therefore two checks, either sufficient: (1) the fast path, `pid === MainPID` (queried once), true
today on this machine (both are `550308`, because `ExecStart` runs node directly, no wrapper); (2) a
fallback that reads `/proc/<pid>/cgroup` and checks it names the unit — a process inside the unit's
cgroup is service-managed regardless of whether it is `MainPID` itself or a child `ExecStart` spawned
indirectly. Only when *neither* check can be made (no `/proc`, the pid is already gone by the time it's
read, `MainPID` itself couldn't be queried, or the platform has no cgroup concept at all — non-Linux)
does `confirmsReplacement` return `null`, preserving the release-match-only behavior.

**Alternative considered**: compare the probe's pid before and after the restart ("pid changed").
Rejected in analysis above — it cannot distinguish a legitimate replacement from the incident's stray
process, since both produce a different pid from before.

**Alternative considered**: query `ActiveEnterTimestamp` instead of `MainPID`. Either proves the same
fact (systemd's own bookkeeping says who is running); `MainPID` was chosen as the fast path because it
can be compared directly against the health probe's own `pid` field with no timestamp-parsing/clock-skew
concerns; the cgroup check is the fallback for exactly the case `MainPID` alone misses.

### Decision 4: migrating the unit is product behaviour, folded into the cutover step

**Revised 2026-09-13.** This change originally argued for leaving the legacy unit alone indefinitely
and requiring a human to re-run `weave daemon install-service`. Captain's direction (2026-09-13,
relayed on this ticket) overrides that: the rename to Weave AI means the installed unit name is itself
a defect on any host still on `agent-conductor.service`, and every install must migrate itself, not
just this host. Two constraints came with it: migration must never leave two units running or none, and
a migration failure must roll back to the *working legacy unit* — this sits on top of the same
restart/verify defect already being fixed here, so it is designed as one mechanism, not two.

**Where it hooks in.** `resolveInstalledUnit()` (Decision 1) now reports `legacy: true` when only the
pre-rename name is found. The restart step (`packages/cli/src/upgrade-runner.ts`, the same place
Decisions 2-3 land) checks that flag once, before doing an ordinary restart: if the installed unit is
legacy, it attempts migration as part of *this* restart; otherwise nothing changes from Decisions 1-3.

**Before any of that: don't render a fresh unit at all — copy the one that's actually installed.**
(Revised 2026-09-13, review rev 2, replacing rev 1's byte-for-byte "safe to migrate?" check.) The rev 1
version compared the legacy unit's content against what *today's* `renderServiceUnit` would produce, and
treated any difference as a hand edit to skip. That's wrong in a way rev 1 missed: it also flags every
unit written by an *older* version of this renderer — before VS-262 added `TimeoutStopSec`, or before
any future change to the renderer or its constants — as unsafe, forever, since the comparison is against
whatever the renderer produces *today*. That would mean an old-but-untouched unit never migrates and
nobody would notice, which breaks captain's "every install migrates" requirement quietly. (Checked
against this host's actual unit: it happens to match today's renderer byte for byte, `TimeoutStopSec`
included — so rev 1's check would have passed here. It is hosts on an *older* shape that it silently
fails forever.)

The fix needs no comparison and no skip branch at all: **the new unit's content is the legacy unit
file's own content, verbatim, with only the `Description=` line changed.** Whatever the legacy unit
says — a hand edit, an old renderer's shape, a custom `Environment=` line — is preserved exactly,
because nothing about it is re-derived. `ExecStart` needs no rewriting either, since it already follows
the `current` symlink rather than naming a specific release path, in every renderer version that has
shipped. A drop-in directory alongside the legacy unit, if one exists, is carried the same way (copied,
not regenerated).

**The sequence, in three phases that bound the risk to one of them:**

1. **Prepare (no running process touched)**: write the new unit file as the legacy unit's content with
   `Description=` swapped (as above), and if a legacy drop-in directory exists, copy it to
   `weave-ai.service.d/` (never move — the legacy copy stays put until finalize, same reasoning as the
   unit file itself). `systemctl --user daemon-reload`, `systemctl --user enable weave-ai.service` (marks
   it enabled, starts nothing). Any failure here — a permissions problem, a full disk — aborts migration
   cleanly (the legacy unit and its drop-in were never touched) and this restart falls back to Decision
   2's ordinary "restart the legacy unit" path, unchanged, and the upgrade row records migration as
   `prepare_failed` (see "Recording what happened" below). Migration is retried automatically on the
   *next* upgrade, since detection re-runs every time.
2. **Cutover (the only phase that touches a running process, and the only one with real risk)**:
   `systemctl --user stop agent-conductor.service`, then `systemctl --user start weave-ai.service`. This
   is the same "stop, then start" systemd already performs internally for an ordinary same-name
   `restart` (Decision 1/2's fixed path) — migration adds no new kind of gap, just a different unit name
   on each side of it. **If the `start` step fails**, immediately `systemctl --user start
   agent-conductor.service` (the legacy unit's file and drop-in are still present — nothing has removed
   them yet) to get the daemon back up under the *old* name, on whatever release `current` already
   points to (the symlink switch happened earlier in the same upgrade, independent of which unit serves
   it). The upgrade itself is **not** failed by a migration-cutover failure that successfully falls back
   — the release still gets verified and the upgrade still completes, on the legacy unit, exactly as it
   would have without attempting migration. Only if *both* the new-unit start and the legacy-unit
   fallback start fail does this become a hard upgrade failure (falls through to the existing "gone"
   outcome). Either way the upgrade row records migration as `fallback` (see "Recording what happened").
3. **Verify, then finalize**: once cutover succeeds, the *same* probe + `confirmsReplacement()` loop
   from Decision 3 runs, now confirming against the new unit. Only once that confirms healthy-on-target does migration
   retire the legacy unit — and, per review rev 1, "retire" means **move, not delete**: `systemctl
   --user disable agent-conductor.service` (already stopped, so no `--now` needed), then rename the unit
   file to `agent-conductor.service.migrated` and, if it existed, the drop-in directory to
   `agent-conductor.service.d.migrated`, then `daemon-reload` once more so systemd forgets the old name.
   A `.migrated` file is inert (not a `.service` suffix, so systemd never loads it) but recoverable by
   hand if a human ever needs to see exactly what was installed before. Retiring is deliberately the
   *last* step, after verification, not part of cutover — for the entire window where the outcome is
   still uncertain, the legacy unit and its drop-in remain live on disk as the rollback target the
   constraint asked for. The upgrade row records migration as `migrated`.

**Recording what happened (added 2026-09-13, review rev 2).** Whether migration succeeded, fell back, or
never got past prepare is not otherwise visible anywhere an operator would look — a log line inside
`logJson`'s bounded tail is easy to miss, and the upgrade's own `state`/`reason`/`message` describe the
*release* restart's outcome, which is unaffected by a migration-cutover failure that fell back
successfully (the upgrade still completes). So the weaver needs to be able to tell captain the rename
did or didn't happen without reading logs. A new column on the `upgrades` row, `migrationOutcome:
'migrated' | 'fallback' | 'prepare_failed' | null` (`null` = migration not applicable — the host was
already on the current unit, or the platform has neither systemd nor launchd), written by the runner at
whichever phase migration stops at, alongside its existing `recordVerdict`-style guarded writes.

**Revised 2026-09-13 (review rev 3): this change also carries it into the announcement, not a
follow-up.** VS-315 (PR #259) merged in the meantime without a `migrationOutcome` field — it couldn't
have had one, since this change hadn't landed yet — so if surfacing it were left to "VS-315 or a small
follow-up" as first drafted, nobody would actually do it. Confirmed against VS-315's landed code
(`packages/server/src/upgrade-announce.ts`): `UpgradeAnnouncement.failure` already reads `row.reason`/
`row.message` exactly as this change's other new failure reasons assumed, so that part of the
coordination note held; `migrationOutcome` gets the same treatment as those fields — added to
`UpgradeAnnouncement`, threaded through `buildAnnouncement`, and given a short clause in
`announcementText` for `'fallback'`/`'prepare_failed'` (silent for `'migrated'`/`null`, since a
successful or not-applicable migration needs no separate mention — the ordinary completed-upgrade line
already covers that case). Task 8.1.

**The existing deadline/rollback path needs no migration-specific branch.** If cutover succeeds but the
new unit's daemon never verifies healthy within `HEALTH_DEADLINE_MS`, the *already-being-fixed* rollback
(`switchRelease(previous)` + restart) just restarts `weave-ai.service` again — it is the one live unit by
that point, exactly as an ordinary rollback restarts whichever unit is already in service. Two units are
never simultaneously live at any point in this sequence, and at most one instant (between "stop legacy"
and "start new," bounded by two synchronous `systemctl` calls) has zero live daemons — no worse than the
gap an ordinary restart already has.

**launchd** mirrors this with `launchctl bootstrap`/`bootout`/`kickstart` in place of
`daemon-reload`/`enable`/`stop`+`start`, using `resolveInstalledLaunchdAgent()` (Decision 1). Best-effort
per the Non-Goals note: if the inferred legacy label doesn't match a real host, migration simply never
triggers there, same as "no unit installed" behaves today.

**Testing this safely (added 2026-09-13, review rev 1).** `systemctl --user` always talks to the one
real, already-running systemd user manager for whoever's session runs the tests — a scratch
`XDG_CONFIG_HOME` changes where *this codebase's own lookups* (`resolveInstalledUnit`,
`serviceUnitPath`) look for unit files, but **not** where the real systemd instance resolves a unit
*name* it's asked to `stop`/`start`/`enable`/`disable`. A test unit literally named
`agent-conductor.service` or `weave-ai.service` **is** either this project's real installed unit or a
name the real manager could confuse with one — either way, a real `systemctl --user stop
agent-conductor.service` in a test stops production. So:

- Every test of the migration sequence (prepare/cutover/finalize, the verbatim-copy-plus-Description=
  content, the drop-in copy) runs at the `RunnerIo`/host-wiring seam: a fake `systemctl` function that
  *records* the calls it receives (command, args, in order) and returns a scripted result, never
  spawning a real process. Assertions check the call sequence itself — `daemon-reload`, `enable`,
  `stop <legacy>`, `start <new>`, (verify happens through the existing probe/`confirmsReplacement`
  fakes), `disable`, the rename-to-`.migrated` — the new unit file's content matching the legacy one
  (a custom `Environment=` line; a unit predating `TimeoutStopSec`) with only `Description=` different,
  and both fallback branches (prepare failure untouched; cutover-start failure restarts the legacy unit
  and the upgrade still completes).
- `confirmsReplacement()`'s `MainPID` parsing and its `/proc/<pid>/cgroup` fallback (Decision 3) are
  tested against **canned strings** (`systemctl show` output; cgroup file contents), not a real
  invocation or a real `/proc` read.
- If one test should exercise a genuinely real systemd user manager end to end (proving the parsing and
  cgroup-reading logic against real output shapes, not just hand-written fixtures — this project's own
  convention, see the project KB on matching real output), it creates a **uniquely named transient
  unit** via `systemd-run --user --unit=weave-test-<random>-<pid> ...`, asserts against *that*, and
  cleans it up (`systemctl --user stop`) afterward. It never names, writes, enables, disables, or
  reloads anything using either product unit name (`agent-conductor.service` / `weave-ai.service`), and
  it never touches a `.service.d/` drop-in for either. This is the same "throwaway unit" the ticket asks
  for reproduction against — precisely defined now as *uniquely-named and transient*, not "a unit that
  happens to share a product name in a scratch directory."

**Alternative considered**: leave migration manual (the original Decision 4). Rejected — overridden by
captain's explicit direction that this must be product behaviour every install gets, not a fix scoped to
one host.

**Alternative considered**: start the new unit before stopping the legacy one, relying on the OS-assigned
loopback port (as the incident's stray daemon accidentally did) to avoid a zero-daemon gap. Rejected:
both units would then try to bind the same *public* HTTP port and one would fail to start, which is a
messier and less bounded failure than a sub-second gap with nothing listening — and it is exactly the
"two daemons alive at once" shape the ticket says must never happen again.

**Alternative considered (review rev 1, superseded by rev 2)**: compare the legacy unit's content against
what today's `renderServiceUnit` would produce and skip migration on any difference beyond
`Description=`. Rejected on rev 2 — this makes migration silently and permanently fail on any unit
written by an older version of the renderer, not just a genuinely hand-edited one, defeating captain's
"every install migrates" requirement without anyone noticing. Copying the legacy unit's own content
verbatim (this decision, as written above) needs no such comparison and has no failure mode tied to the
renderer's own history.

**Revised 2026-09-13 (PR #265 review): every non-finalizing path undoes what prepare wrote.** The
sequence as first written left the new unit's file (and, on Linux, its `enable`d state) on disk
whenever the upgrade did *not* end with migration committed — a `prepare_failed` outcome, a `fallback`
after cutover's `start` failed, and, subtly, a cutover that *did* succeed but whose overall release
never verified within `HEALTH_DEADLINE_MS` (`finalizeMigration()` is only ever called on a `completed`
verdict, so it never ran for that third case either). Left behind, that file — even disabled — is what
Decision 1's revised `resolveInstalledUnit()` is the *second* layer of defense against; this is the
first: every one of those three paths now calls `undoPrepare()` before returning — `disable` the new
unit (its result is not checked: "not enabled" is an expected, harmless outcome), delete the new unit
file and its copied `.service.d`, `daemon-reload`. For the third case specifically — cutover succeeded,
release never verified — the sequence first brings the daemon back under the legacy unit (`stop` new,
`start` legacy) *before* removing the new one, so at every instant exactly one unit is ever live, never
zero and never two; only after that does it call `undoPrepare()`. This is the same
`HEALTH_DEADLINE_MS`-deadline rollback call `driveRestart` already makes into `io.restart()` a second
time — `migrateSystemdUnit`'s closure recognizes it via its own `attempted`/`cutoverSucceeded` state,
no new hook into `driveRestart` itself was needed.

**Also revised (PR #265 review): the launchd Label bug.** `withCurrentDescription` only rewrites a
systemd unit's `Description=` line — a plist has no such field. The copied plist was landing at
`com.weave-ai.daemon.plist` while its own `<key>Label</key><string>com.agent-conductor.daemon</string>`
still named the legacy label, so `bootstrap`, `launchdPid` and a rollback `kickstart` all ended up
addressing `gui/<uid>/com.weave-ai.daemon` — a label nothing had ever registered. A dedicated
`withCurrentLabel()` rewrites the `Label` string specifically; `migrateLaunchdAgent` gets the same
undo-on-every-non-finalizing-path treatment as its systemd counterpart, simplified by launchd having no
separate "enabled but not started" state (`bootstrap` either fully loads and starts the job or fails
outright), so undo there is only ever "remove the copied plist file."

**Revised again (PR #265 review, round 2): `start`/`bootstrap` is now conditional on `stop`/`bootout`
having actually succeeded, in every place the two are paired** — cutover, its no-longer-migrated
fallback, and the deadline-rollback revert, on both systemd and launchd. As first written, the two calls
were independent statements: `const stop = io.run(...); const start = io.run(...); if (stop.status === 0
&& start.status === 0) {...}` — `start` ran regardless of whether `stop` had succeeded. A legacy `stop`
that exits non-zero (a cancelled or failed stop job) while the new unit's `start` happens to succeed left
both live — the exact two-daemons shape this ticket removes, reached through the *fix* for it rather
than the original bug. `start`/`bootstrap` is now only ever attempted when the paired `stop`/`bootout`
returned exactly `0`; `undoPrepare()` on every side now also stops/boots-out the new
unit/agent first (a harmless no-op when it was never actually started), so a `start` that races ahead of
its own `stop`'s result can no longer happen, and any of these calls failing in a way that leaves the
outcome unconfirmed throws rather than proceeding as if it were safe.

### Decision 5: the no-unit fallback stops-and-verifies before starting a replacement

`stopDaemon()` (`packages/cli/src/daemon.ts`) already SIGTERMs then SIGKILLs the pid it tracked, but
never re-checks after the SIGKILL, and nothing today stops `startDaemon()` from being called if some
*other*, untracked process is answering health. The fallback path (used only when `resolveInstalledUnit()`
finds nothing — a genuinely bare `weave daemon start` install) now: (1) confirms the tracked pid is
actually dead after the kill, failing loudly if not; (2) probes the health URL once more and refuses to
start a second daemon if anything still answers there. Both checks are cheap and only run on the fallback
path; the systemd/launchd paths never reach them because a working unit restart never has two daemons up
at once.

### Decision 6: the still-serving process resumes its own dispatch if the restart never replaces it

**Added 2026-09-13**, from a ticket comment made before this change's first draft and missed until this
revision (see the report for how). Treat it as part of this ticket's acceptance, per the weaver.

**The evidence.** On 2026-09-12, across three workspaces, zero runs dispatched from 17:27 to 19:09:40
UTC — over 1h40m — while wakeups kept queuing (6, 3 and 3 respectively) and captain's own chat messages
at 18:13 and 18:17 went unanswered. The first run dispatched again at 19:09:48, eight seconds after
systemd itself finally restarted the unit — not because anything in this codebase noticed the restart
had not happened, but because a brand-new process booted and dispatches by default.

**Why.** `advance()` (`packages/server/src/upgrade.ts`) calls `holdDispatch()` before doing anything
else. Every failure branch up to and including "the runner could not even be spawned" calls
`resumeDispatch()` on its way out. The success path — `spawnRunner()` returns without throwing —
deliberately does *not*: the assumption baked into the code is that this process is about to be replaced
by a new one that dispatches normally on its own boot. That assumption is exactly what this ticket's
other defects broke: when the restart silently never replaces this process, dispatch stays held here
*forever*, because nothing else can undo an in-memory `dispatcher.stop()` except this same process's own
code, and this process is never told anything went wrong — the runner is a separate OS process that
writes only to `daemon.sqlite`; there is no channel back into this suspended `advance()` call.

**The fix.** Right after `spawnRunner()` succeeds, arm a bounded watchdog in this same process: if this
upgrade's row is still `restarting` once `RESTART_VERIFY_MS` has elapsed — the *same* constant boot-time
`reconcile()` already uses for "how long a `restarting` record may sit before it's called unverified,"
reused deliberately so the guarantee reads identically regardless of which of the two mechanisms (a
fresh boot's `reconcile()`, or this timer in the still-alive old process) is the one that actually fires
— then this process is, by definition, still running: the restart did not replace it. The watchdog
writes the row `failed`/`restart_unverified` (a guarded `UPDATE ... WHERE state = 'restarting'`, the
same pattern `recordVerdict` already uses, so a genuine last-second verdict write from the runner and
this watchdog can never both apply) and calls `resumeDispatch()` in this process.

**Confirmed (review rev 3): the two windows can't collide.** `RESTART_VERIFY_MS` is 10 minutes;
`HEALTH_DEADLINE_MS` — how long the runner itself keeps probing before giving up and rolling back — is
90 seconds. The watchdog fires only after the runner has long since finished its own verify-or-rollback
attempt and written *some* verdict, so it can never cut off a runner that is still legitimately working;
it only catches the case the runner never got to write anything at all (killed outright, never started,
or otherwise silently never touched the record).

`reconcile()` itself is left untouched — it already has its own scenarios and its own contract (a
*fresh* process reconciling at boot, whose own dispatcher is already active regardless), and folding
this into it would risk perturbing behavior the spec already pins down. The watchdog is new,
narrowly-scoped code next to `advance()`, sharing only the constant and the `fail()`/`resumeDispatch()`
helpers already in this module.

**A bootstrapping caveat, stated plainly rather than hidden.** This guarantee protects every upgrade
*after* the one that ships it — the daemon currently serving (running pre-fix code) has no watchdog
until this fix's own release is what's running. The upgrade that lands this fix is still only verified
the way task 6's manual/report check already covers: a human confirms it worked.

**Alternative considered**: have the runner (a separate process) signal the original process directly —
a Unix socket, a signal, a shared pidfile poke. Rejected: more moving parts than a timer already reading
the same database both processes already share, and it adds a second thing that can itself fail
silently.

## Risks / Trade-offs

- [Risk] `systemctl --user show` could itself be slow or fail transiently right after a restart. →
  Mitigation: `confirmsReplacement()` returning `null` on any error falls back to the pre-existing release-match
  check rather than blocking completion forever; this only *removes* a false-accept, it never introduces
  a new false-reject beyond "poll again next tick," bounded by the existing `HEALTH_DEADLINE_MS`.
- [Risk] A host with neither systemd nor launchd (containers, some CI-like environments) still uses the
  direct-start fallback, whose stronger stop-verification could reject a start that would have worked
  before if the health-probe-still-answering check races a slow shutdown. → Mitigation: the check runs
  once, immediately after `stopDaemon()`'s own bounded wait already completed; it adds one HTTP round
  trip, not a new indefinite wait.
- [Risk] Changing `RestartEnvironment`'s shape (`unitInstalled` → `unitName`) touches two call sites and
  their tests. → Mitigation: both are covered by existing unit tests for `planRestart` and
  `upgrade-runner.test.ts`'s `driveRestart`; the task list updates both alongside the production code.
- [Risk] The runner process itself dies between the "stop legacy" and "start new" `systemctl` calls in
  Decision 4's cutover (host OOM-killed it, power loss), leaving zero units running. → Mitigation: this
  is not a new risk class — an ordinary same-unit `systemctl restart` has the identical window (systemd
  itself stops-then-starts) and this codebase has never tried to make that atomic. `weave daemon
  upgrade`'s own doctor/status tooling already exists for a human to notice and recover a fully-down
  daemon; this change does not attempt to close that pre-existing gap, only to not make it worse or more
  frequent.
- [Risk] **Coordination with VS-315** (the upgrade-announcement fix; PR #259, **merged** `14c166a2` on
  `main`, 2026-09-13 — this change rebases onto it first, task 0.1, rather than leaving that until the
  end): it edited the same file, `packages/server/src/upgrade.ts` (`facts()`, `landedTickets`), and
  changed the announcement contract — `upgradeOutcome` gains a `recorded_completed` outcome, and
  `UpgradeAnnouncement` gains a required `ticketsOmitted` field. → Mitigation, confirmed against the
  landed code rather than assumed: this change's new failure reasons (`restart_failed` with command
  stderr, a migration-cutover failure, the Decision 6 `restart_unverified` watchdog case) slot into the
  existing `reason`/`message` fields `buildAnnouncement` already reads (`failure: outcome === 'completed'
  ? null : { reason: row.reason, message: row.message }`) — not a parallel vocabulary — so VS-315's
  `recorded_completed` outcome and this change's new reasons compose rather than collide. Any
  `UpgradeAnnouncement` literal this change's own tests construct includes `ticketsOmitted`, now required
  by the type. VS-315 shipped with no way to report `migrationOutcome` — it couldn't have, since this
  change hadn't landed — so, per review rev 3, this change carries it the rest of the way itself (task
  8.1) rather than leaving that to a follow-up nobody would then own.
- [Risk] The Decision 6 watchdog and a genuine restart succeeding at nearly the same instant. →
  Mitigation: both write through the same guarded `UPDATE ... WHERE state = 'restarting'` pattern
  `recordVerdict` already uses, so whichever lands first in the database wins and the other is a no-op;
  no new race is introduced beyond the one `recordVerdict`'s own doc comment already describes and tests
  cover.
- [Risk] The watchdog timer itself leaking or keeping the process alive if an upgrade never resolves. →
  Mitigation: `unref()`'d, matching the existing convention for background timers in this codebase (the
  `waitForIdle` poll loop), so it never blocks process exit; explicitly cleared if the row leaves
  `restarting` before it fires (the runner's own verdict, or a cancellation).

## Migration Plan

No *data* migration — existing `upgrades` rows and their schema are unchanged, and this section is about
deploying the code change itself, not the unit-name migration Decision 4 describes (that one is the
change's own subject, not a deployment step for it). Deploys the normal way: VS-316 lands, a human runs
`weave daemon upgrade` once this release is current. That upgrade is itself the first real exercise of
Decision 4's migration on any host still running the legacy unit — including this one — so task 7.2's
seam-level rehearsal (never a real command against either product unit, per "Testing this safely" above)
is this change's closest dry run of it. No rollback concerns beyond the existing upgrade
rollback-on-unhealthy path, which this change strengthens rather than replaces.
