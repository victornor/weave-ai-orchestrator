## 1. Reserve the `plan` document key

- [x] 1.1 `packages/core/src/tickets/service.ts`: `putDocument` gained an optional
      `opts?: { system?: boolean }` fifth parameter; `key === 'plan'` without `opts.system` throws
      `OcError('forbidden', ...)`. `transition()`'s own internal write now passes `{ system: true }`.
      `TicketsService.putDocument` in `packages/core/src/api.ts` carries the same optional parameter,
      documented as internal-only — never to be set from a tool or route handling external input.
- [x] 1.2 / 1.3 **Deviation from the plan:** no change needed in `packages/server/src/tools.ts` or
      `packages/server/src/routes/tickets.ts`. Both already call `tickets.putDocument(actor, ...)`
      with no `opts`, and both already propagate a thrown `OcError` correctly without any change:
      `runTool` (`tools.ts`) catches every handler throw and returns `fail(toOcError(e))`, and the
      HTTP app's global `onError` (`http.ts`, wired in `app.ts`) maps any thrown `OcError` to its
      status via `OcError.status(code)`. `actorFor()` (`packages/server/src/types.ts`) never produces
      a `system` actor for a real request, so the guard inside `putDocument` is already the single,
      sufficient choke point for the agent tool, the HTTP route, and any other caller — reached before
      either boundary would need to know `key === 'plan'` is special. Adding a duplicate check at
      either boundary would only re-implement the same error with no behavioural difference.
- [x] 1.4 Tests in `packages/core/src/tickets/tickets.test.ts`: the existing "supersedes an open plan
      approval…" test now passes `{ system: true }` (it simulates the internal path) and is renamed to
      say so; a new test asserts an external-shaped `putDocument(..., 'plan', ...)` throws `forbidden`,
      creates no revision, and leaves an already-open approval's supersession uncalled.
      **Deviation:** no test added in `packages/server/test/app.test.ts` or a tools test file.
      `packages/server/test/fakes.ts`'s `tickets.putDocument` is a hand-rolled fake (a documents Map),
      not the real service, so a test through that harness would exercise the fake's own logic, not
      the guard — it would only prove something once duplicated there too, which 1.2/1.3 established
      is not needed. The guard is exercised once, at its actual source, in `tickets.test.ts`.

## 2. Repair a stranded approval

- [x] 2.1 `packages/core/src/api.ts`: `TicketsService.repairApprovals(): Promise<Array<{ id: string;
      identifier: string; kind: 'plan_approval' | 'merge_approval' }>>`.
- [x] 2.2 `packages/core/src/tickets/service.ts`: implemented `repairApprovals()` — scans `proposed`
      `change` tickets with no open `plan_approval` and raises a fresh one (same shape as
      `transition()`'s, context noting it was re-raised; owner `'none'` policy transitions straight to
      `approved` exactly as `transition()` does; auto-answered under YOLO via the existing
      `autoApprove` helper). Scans `in_review` tickets without `auto_merge` and no open
      `merge_approval` and raises a fresh one (not auto-answered here — `autoMergeSweep()` already
      picks up a pending one on its own next pass). Exposed on the returned `service` object.
- [x] 2.3 `packages/core/src/supervisor/index.ts`: added `approvalIntegrityScan()`, called on the same
      `LIVENESS_EVERY_MS` cadence as `livenessScan()` inside `tick()`; when `repairApprovals()` returns
      anything, wakes the conductor once, naming every repaired ticket and the kind of approval that
      was missing (`payload.kind: 'approval_repaired'`).
- [x] 2.4 Tests in `packages/core/src/tickets/tickets.test.ts` (`describe('repairApprovals', …)`):
      raises a `plan_approval` for a `proposed` ticket with none open and leaves alone one that
      already has an open approval; raises a `merge_approval` for an `in_review`, non-`auto_merge`
      ticket with none open, and skips an `auto_merge` one; reports nothing when every waiting ticket
      already has an open approval. Tests in `packages/core/src/supervisor/supervisor.test.ts`
      (`describe('approval integrity (VS-104)', …)`): a tick with something to repair wakes the
      conductor exactly once, naming every repaired ticket; a tick with nothing to repair wakes
      nobody; a repair scan that throws does not fail the tick.

## 3. Stop pointing workers at `plan`

- [x] 3.1 `templates/worker.AGENTS.md.tmpl`: "a comment, a `plan` or `report` document, a work
      product" → "a comment, a `report` document, a work product".
- [x] 3.2 `skills/agent-conductor-knowledge/SKILL.md`: the same phrase, same change.
- [x] 3.3 `skills/agent-conductor-worker/references/tools.md`: `ac_ticket_document_put`'s row drops
      `plan` from the worker-writable key list and notes it is daemon-reserved; `ac_ticket_document_get`'s
      row now mentions the daemon's `plan` digest as something still readable.
- [x] 3.4 `templates/brief.md.tmpl:91` left unchanged — it describes reading a `report` or `plan`
      document (`ac_ticket_document_get`), which stays true.

## 4. Verification

- [x] 4.1 `pnpm typecheck && pnpm lint && pnpm test` green (1499 core/server tests, 834 UI tests, all
      passing; 1 pre-existing skip, unrelated).
- [x] 4.2 Stated in the PR: reserving the `plan` document key (not narrowing the supersession) —
      reasoning in `design.md`'s "Rejected" note and the ticket comment on VS-104.
