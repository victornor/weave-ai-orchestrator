## Why

The documented escalation flow is: a worker raises a `question` (or `concern`), the weaver cannot
resolve it, so the weaver raises its own `weave_ask` to the human about it, and once the human
answers the weaver relays the resolution onto the worker's own decision with
`weave_decision_answer`, waking the worker.

That last step is impossible today. Both decisions derive the same default correlation key,
`<kind>:<ticketId>`, so the moment the weaver raises its escalation the worker's card is marked
`superseded`. When the human answers, the relay to the worker's decision fails with `wrong_status`
(`superseded`), and the only way to reach the worker is an ordinary steering message, which is not an
answer and leaves its decision open forever. Escalation silently destroys the object the whole flow
depends on. Observed on VS-507, 2026-09-17.

## What Changes

- The default correlation key a decision is created under becomes owner-scoped:
  `<kind>:<owner>:<ticketId|workspace>` instead of `<kind>:<ticketId|workspace>`. A worker's
  `question` (owner `weaver`) and the weaver's escalation of it (owner `human`) therefore land in
  different buckets, and neither supersedes the other. A repeat ask of the same kind, by the same
  owner, on the same ticket still supersedes as it does today.
- Callers that pass an explicit `correlationKey` (every system-raised approval: plan, action, merge,
  archive-backfill, discard, retry, hire, permission change, stall escalation, login) are unchanged;
  their supersede semantics — which deliberately need to cross owner boundaries on a republish — are
  not affected.
- Escalating a worker's `gate_finding` already uses a different kind (a `gate_finding` is always
  weaver-owned and can never reach the human), so the same default-key rule leaves that pair
  non-colliding as well.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `worker-escalation`: adds a requirement that escalating a worker's ask to the human leaves the
  worker's own decision open and answerable, and that the relay `weave_decision_answer` closes it —
  while a same-kind, same-owner repeat still supersedes.

## Impact

- `packages/core/src/decisions/service.ts` — the derived default `correlationKey` in `create()`.
- `packages/core/src/decisions/decisions.test.ts` and any test asserting a derived key
  (`question:<ticketId>`, `approval:workspace`, `question:<ticketId>` for detached follow-ups).
- `openspec/specs/worker-escalation/spec.md` (after archive).
- No API, schema or migration change: the key is a plain column and explicit keys are untouched.
  Decisions already open under an old derived key are not rekeyed, so a post-upgrade repeat ask of
  the same kind/owner/ticket creates its own card rather than superseding the pre-upgrade one; the
  pre-upgrade card remains answerable and any stale one is swept by the existing terminal-ticket
  sweep. This is a one-upgrade, human-visible-at-most artifact and is not worth a data migration.
