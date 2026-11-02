## Context

Motivation: see proposal.md — Why. The state of the code that shapes the approach:

- **Retirement.** The supervisor's `retireFinished()` (`supervisor/index.ts`, every 15 s tick) calls `WorkersService.retireIfLanded()` for every `active|done|error` worker whose ticket is terminal. On refusal it logs `worker not retired: work has not landed` and writes the reason into `agents.error_text`. `landedWorkTest()` (`worktrees/landed.ts`) returns `{ landed, reason, evidence }`; its counts are loose `evidence` keys (`uncommitted`, `untracked`, `commitsNotInBase`, `commitsNotOnAnyRemote`, …). A missing branch appears only in `reason` (`branch X not found in …`).
- **VS-859 reclaim.** `reclaimFinishedHomes()` (daily, from `retentionPass`) deletes only `retired|done` homes past `workerArchiveDays` that are clean (no tracked or untracked change) and proven landed (merged PR work product, or `landedWorkTest`). It measures no sizes. Everything else is skipped and logged again every day.
- **`discard_approval` today.** It is raised per ticket by `POST /tickets/:id/discard` and per role by `RolesService.retire`. `applyDiscardApproval()` posts a comment, records activity and wakes the weaver. **It deletes nothing.** The only code that removes an unlanded worktree is `POST /worktrees/:id/discard` (`deleteBranch: true, force: true`, no decision check). The ticket route offers the option key `keep`, while `NAMED_CARD_OPTION_KEYS.discard_approval` is `{ approve, reject }`. `Decision.target` is a free JSON field. YOLO and relayed answers already exclude `discard_approval`.
- **No free-space or size measurement exists**, except the private `directorySize()` in `tickets/scratch.ts`. No workspace overview page exists in v2: `/w/$ws` redirects to Needs you. Workspace settings sections live in `ui/src/v2/settings/sections.ts`.
- **Alerts to the human.** The paths are `threads.notifyHuman()` (primary chat thread, channels, web), daemon incidents (`createIncidentsService(daemonDb)`; system-filed and deduped by open title, as in `engine.ts` memory-kill), and system wakes to the weaver.
- **Restart lifecycle.** `observeBoot()` reads `shutdown_at`/`shutdown_reason` from `daemon.sqlite` meta and serves them as `downAt`/`shutdownReason` even when `clean` is false. That is the stale-value bug. The daemon reads `INVOCATION_ID` only for the stall watchdog. Nothing reads the journal.
- **Real systemd record of the 2026-11-02 crash.** Captured from `journalctl --user -u weave-ai.service -o json`, read-only, on this host:

  ```
  MESSAGE_ID=98e322203f7a4ed290d09fe03c09fe15  EXIT_CODE=dumped  EXIT_STATUS=7   "Main process exited, code=dumped, status=7/BUS"
  MESSAGE_ID=d9b373ed55a64feb8242e02dbe79a49c  UNIT_RESULT=core-dump             "Failed with result 'core-dump'."
  MESSAGE_ID=5eb03494b6584870a536b337290809b3  N_RESTARTS=1                      "Scheduled restart job, restart counter is at 1."
  ```

  All three entries carry `USER_INVOCATION_ID=40c354b0…` (the crashed process), and the next start has a new one. `_SOURCE_REALTIME_TIMESTAMP` is µs since the epoch. `EXIT_STATUS` holds the **number** (`7`), not the name.

## Goals / Non-Goals

**Goals**
- Captain can see, in one view, every retained copy: its size, its class and why it is kept.
- A reclaim is only ever carried out by captain's approval. A copy with unpushed commits needs its own approval.
- Captain is warned before the disk fills, and the warning names what to delete.
- A crash restart never reports a time or reason that belongs to an earlier process. Where systemd knows how the process died, the report says so.

**Non-Goals**
- **Any automatic deletion of unlanded work**, whatever its age or class.
- **Changing VS-859's reclaim of landed, clean homes.** It keeps its rules, window and behaviour.
- **The 15 s retire pass re-testing every refused worker** (git calls and an info log line per worker per tick). It is noisy and costly, but it is not what fills the disk. It is noted on the ticket for a follow-up, not built here.
- **Stripping `node_modules`/`bin` from retained copies.** VS-859 rejected it, because a resumed worker's tests would fail confusingly.
- **Fixing `POST /worktrees/:id/verify` passing `prMerged`/`deliveryMode` `as never`.** It is a separate bug, found during this survey and noted on the ticket.
- **macOS launchd exit lookup.** Off systemd, the exit is reported as unknown.

## Decisions

### D1. A retained-copy scan stored in its own table, run off the tick

The new `WorkersService.scanRetainedCopies()` walks `paths.workers`. A directory is *retained* when it has `work/` and its agent is not live (`active|running|paused|provisioning`), or when it has no agent row. For each retained copy it records:

| Field | Source |
|---|---|
| ids, ticket and status, project, branch | DB rows |
| `ageFrom` | `tickets.completed_at`/`cancelled_at`, else the agent's finish time, else the directory's mtime (orphans only) |
| `uncommitted` | `worktreeChanges()` — tracked and untracked counts |
| `commitsNotOnLandingBranch`, `commitsOnNoRemote` | `git rev-list --count origin/<landing>..<branch>`, then `<branch> --not --remotes` |
| `commitsOnlyHere` | in the checkout, `git rev-list --count HEAD --not --branches --remotes --tags` (null when git cannot answer) |
| `branchGone` | `git rev-parse --verify refs/heads/<branch>` fails in the project clone |
| `bytes` | `du -sk <home>` in a child process |
| `headSha` | the checkout's HEAD, for D3's re-check |

Rows go into a new workspace table `retained_copies` (directory PK; columns above, `class`, `reasons_json`, `scanned_at`). Each scan replaces the table in one transaction at the end. The API, CLI and UI read the table; they never walk the disk on a request.

- **Running off the tick.** The supervisor triggers the scan through `due('supervisor:retained_scan_at', DAY_MS)` but does **not** await it inside `runStep`. A scan of 224 copies with `du` can take minutes. A step in flight for 30 min marks the supervisor `stalled`, and under systemd VS-952 then exits the daemon. So the scan is a detached promise, guarded by a module-level `scanning` flag so two never overlap, with one copy processed at a time. Each `du` and git call is spawned async with its own timeout (`du` 120 s, git 15 s); a timeout records `bytes: null` or `unreadable` for that copy and moves on. `POST …/retained/scan` triggers the same function and returns at once (202, with `scanning: true`).
- *Alternative:* compute on request. Rejected — hundreds of git calls and a full `du` per page load.
- *Alternative:* reuse `directorySize()` (an in-process `lstat` walk). Rejected for the scan: millions of `node_modules` entries walked on the event loop thread pool would compete with the daemon itself. `du` runs outside the process. Where `du` is unavailable it falls back to the walk.
- **Not-retired reasons are typed now.** `landedWorkTest` stays as it is. The scan reads git directly through small helpers in `worktrees/landed.ts`, so `branch_gone` is a field, not a parsed `reason` string.

### D2. Classes and the offer window

The classes (`open`, `finished_unlanded`, `branch_gone`, `orphan`) go into `RETAINED_COPY_CLASSES` in `shared/enums.ts`, and the reasons into `RETAINED_COPY_REASONS`. `offerable = class !== 'open' && age >= defaults.retainedCopyOfferDays` (workspace config, default 30). The flag only orders and highlights rows, and is what the low-disk warning sums as "offerable now". Nothing acts on it.

### D3. Reclaim = per-copy or batch `discard_approval`; the answer carries out the removal

`WorkersService.offerReclaim(actor, directories[])`:

1. Re-reads each selected copy and drops `open` ones with a reason.
2. Partitions the rest. A copy is **solo** when `commitsOnNoRemote > 0`, or `commitsOnlyHere !== 0` (including null), or its state is unreadable. The rest form one **batch**.
3. Raises one human-owned `discard_approval` per solo copy (`correlationKey: reclaim:<directory>`) and one for the batch (`correlationKey: reclaim-batch:<ulid>`). Options are `NAMED_CARD_OPTION_KEYS.discard_approval` (`approve` / `reject`, reject recommended).
   - `target` carries `{ kind: 'retained_copy_reclaim', copies: [{ directory, workerId, branch, headSha, uncommitted, commitsOnNoRemote, commitsOnlyHere, bytes }] }` as the snapshot the card states.
   - The context lists, per copy, the bytes freed and the losses ("3 untracked, 2 modified files; branch `ac/vs-349-…` and its 4 commits stay in the clone").
   - A copy already on an open reclaim card is not re-offered.

`applyDiscardApproval` gains a branch on `target.kind === 'retained_copy_reclaim'`. On `approve` it calls `WorkersService.reclaimRetained(actor, decision)`. For each copy that call:

- re-reads it;
- refuses it when the worker is live or any snapshot field differs (head, branch, counts — a larger size alone is not a refusal);
- otherwise removes it through the project's worktree provider with `deleteBranch: false, force: true`, then `rmSync(home)`;
- records `worker.retained_copy_reclaimed` (bytes) or `worker.retained_copy_reclaim_refused` (reason);
- deletes the `retained_copies` row.

It posts one result line on the chat thread. On `reject` it records the decline and changes nothing.

- **Why keeping the branch is the default:** it makes the reclaim lose only the copy's own files, never committed work. That is why copies without commits-only-here may share a card. "Per copy, not per batch" is then exactly the set whose commits could be lost or are unpushed.
- **Why `force: true` here, when VS-859 uses `false`:** a reclaim card's whole purpose is to discard uncommitted files that captain has seen listed and approved. The snapshot re-check is the guard instead.
- **Approval integrity:** the card is `owner: 'human'`; `discard_approval` is already outside YOLO and relays. A test pins that a weaver's answer and the auto-approval pass leave it open.
- *Alternative:* the daemon raises the offer cards itself once copies pass the window. Rejected: on this host that is about 200 cards in Needs you on the first day. The Storage view, the CLI and the low-disk warning carry the offer instead.
- *Alternative:* reuse `POST /worktrees/:id/discard`. Rejected: it deletes the branch and checks no decision.

### D4. Storage view, routes and CLI

| Surface | Behaviour |
|---|---|
| `GET /api/w/:ws/workers/retained` | `{ scannedAt, scanning, totals: { count, bytes, byClass }, copies: [...] }` |
| `POST /api/w/:ws/workers/retained/scan` | 202 |
| `POST /api/w/:ws/workers/retained/reclaim` | `{ directories: string[] }` → `{ cards: [{ decisionId, directories }], skipped: [{ directory, reason }] }` |
| `GET /api/w/:ws/` | gains `retainedCopies: { count, bytes, scannedAt }` |
| `weave worker retained [--json] [--scan]` | prints a table, largest first |
| `weave worker reclaim <directory…> \| --class <c> [--offerable]` | raises the cards and prints their ids. It never removes anything itself. |

The web app gets a workspace settings section **Storage** (`/w/$ws/settings/storage`):

- the filesystem free/total line, from the last disk check;
- the totals by class;
- a table of copies — size, worker, ticket and status, class, age, reasons — sortable by size, with checkboxes;
- an "Offer reclaim" button that shows the card split before sending.

The cards then appear in Needs you. All routes are added to `routetable.ts` and `docs/API.md`.

### D5. Low-disk check: a daemon timer, `fs.statfs`, episode state in `daemon.sqlite`

`createDiskWatch({ workspaces, readFs, notify, incidents, db, thresholds })` lives in `server/src/diskWatch.ts`, beside the stall watchdog, on an unref'd 10-minute interval plus one check 1 minute after boot.

- `readFs(path)` defaults to `fs.promises.statfs` (`bavail*bsize`, `blocks*bsize`) and `fs.stat(path).dev` for de-duplication. Tests inject it.
- **Thresholds:** `disk.warnFreePercent` (10) and `disk.warnFreeBytes` (50 GiB), in `DaemonConfigSchema`. Recovery requires above the threshold by 5 % of total.
- **Episode state:** stored per `dev` in meta (`disk.low.<dev>` = `{ startedAt, freeAtStart, lastWarnFree }`). A re-warn happens when free space falls to `lastWarnFree / 2`.
- **Consumers:** read from each workspace's `retained_copies` table (top 5 by bytes across the workspaces on that filesystem) plus each workspace's total. When no scan has run yet, it says so and triggers one.
- **Delivery:** `notifyHuman` on each workspace on that filesystem (the line names the Storage view path), and one incident through `incidents.create({ reporterKind: 'system', title: 'Low disk space on <mount>', … })`, skipped when an open incident with that title exists. The incident is left for captain to resolve.

*Alternative:* a supervisor step per workspace. Rejected: workspaces share a filesystem and would warn N times, and a supervisor stall must not silence the disk check.

### D6. Restart: never serve an earlier process's shutdown; liveness; journal lookup

1. **`observeBoot`.** `downAt` and `shutdownReason` are returned only when `clean`, that is when they come after `previousBootAt`. Otherwise both are null. This alone fixes the reported bug.
2. **Liveness.** `markBooted` also writes `daemon.lifecycle.alive_at`. A 60 s unref'd interval in `daemon.ts` rewrites it, wrapped in try/catch: a full disk must not crash the daemon from this timer. `observeBoot` returns `lastAliveAt` only when it is ≥ `previousBootAt`.
3. **Invocation id.** `markBooted` stores `INVOCATION_ID`, when set, as `daemon.lifecycle.boot_invocation_id`, and `observeBoot` returns it as `previousInvocationId`.
4. **Journal lookup.** `readServiceExit(invocationId, run)` in `server/src/serviceExit.ts` runs only when `!clean && previousInvocationId`, inside the already-unawaited `announceRestart`.
   - It runs `journalctl --user USER_INVOCATION_ID=<id> -o json --no-pager`, and if that is empty, `journalctl INVOCATION_ID=<id> -o json --no-pager` (a system unit). Each has a 3 s timeout and a 1 MiB output cap.
   - It parses the three `MESSAGE_ID`s above into `{ source: 'systemd', exitCode, exitStatus, signal, unitResult, restarts, exitedAt }`.
   - `signal` is the name for `killed|dumped`, by reverse lookup of `os.constants.signals` (7 → `SIGBUS`).
   - `exitedAt` comes from `_SOURCE_REALTIME_TIMESTAMP`, falling back to `__REALTIME_TIMESTAMP`.
   - Any failure returns null.
   - `run` is injected, and the test fixture is the captured JSON lines above.
5. **The notice.** `RestartNotice` gains:
   - `downAtSource: 'recorded_shutdown' | 'service_manager' | null`
   - `lastAliveAt: string | null`
   - `exit: ServiceExit | null`

   `downAt` is the recorded shutdown when clean, else `exit.exitedAt`, else null. `shutdownReason` is the recorded reason only when clean.

   `restartNoticeText` for a crash:
   - "Back up at 20:00:46 after a crash (SIGBUS, core dumped); down 3 s."
   - with no exit: "Back up at 20:00:46 after an unclean shutdown; when it went down was not recorded (last alive 19:59:50)."
   - with nothing at all: "…; when it went down and why are unknown."
6. **Weaver instructions.** `templates/weaver.AGENTS.md.tmpl` item 9 and `skills/weave-ai-weaver/SKILL.md` add: a null `downAt` is reported as unknown; `lastAliveAt` is only an upper bound; never compute an outage length the payload does not carry.

*Alternative:* an `ExecStopPost=` hook writing `$SERVICE_RESULT/$EXIT_CODE/$EXIT_STATUS` to a file. Rejected for now:
- it needs a unit rewrite on every installed host;
- systemd `$`/`%` escaping in the unit is error-prone;
- it would not cover any crash before the rewrite.

The journal already holds the same facts, keyed by an id the daemon can record itself.

## Risks / Trade-offs

- [`du` over about 255 GB takes minutes and loads the disk] → it runs once a day and on request, one copy at a time, in a child process, and never blocks the tick.
- [The table goes stale between scans; a size shown can be a day old] → `scannedAt` is shown everywhere sizes are, and a reclaim re-reads git state before acting.
- [The journal is volatile or rotated, or `journalctl` is missing] → the report falls back to unknown, which is the honest answer. Nothing depends on it.
- [`force: true` removal discards uncommitted files] → only after a human `approve`, and only when the card's snapshot still matches.
- [Approving many solo cards one by one is tedious at 200 copies] → that is the rule the ticket set for unpushed commits. Batching covers every copy that cannot lose commits, and the Storage view sorts by size, so the few largest go first.
- [`branch_gone` copies whose `.git` link is dangling cannot answer `commitsOnlyHere`] → null makes them solo, never batched.
- [The liveness write fails on a full disk] → it is caught and logged once per episode. A stale `lastAliveAt` only widens the bound and is never shown as a down time.

## Migration Plan

- One workspace DB migration adds `retained_copies`. It needs no backfill: the first daily scan, or the first `--scan`, fills it.
- The new config keys have defaults, and existing configs parse unchanged.
- `RestartNotice` gains fields only. `downAt` can now be null on a crash, which it already could be per its type.
- Rollback: the previous release ignores the new table and meta keys.
- Nothing is removed on upgrade. After the deploy, captain runs `weave worker retained --scan` once to see the 255 GB broken down.

## Open Questions

None that change the specs or tasks.
