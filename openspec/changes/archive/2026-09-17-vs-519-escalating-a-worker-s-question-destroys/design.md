## Context

See `proposal.md` for the motivation. The mechanics that produce the bug:

- `create()` in `packages/core/src/decisions/service.ts` derives a default correlation key when the
  caller passes none: `correlationKey = input.correlationKey ?? \`${input.kind}:${requestedTicketId ?? 'workspace'}\``
  (service.ts:240). Owner is derived separately, from the kind and the asker
  (`defaultOwner`, service.ts:66): a worker's `question`/`concern` resolves to `weaver`; an ask
  raised by the weaver (or the human) resolves to `human`; `gate_finding` is always `weaver`.
- `create()` then calls `supersedeOpen(actor, ticketId, correlationKey)` (service.ts:245), and
  `supersedeOpen` (service.ts:118) closes **every** open decision with the same
  `(ticket_id, correlation_key)`, regardless of owner. The partial unique index
  `decisions_open_corr` enforces one open row per `(ticket_id, correlation_key)`.
- A worker's question and the weaver's escalation of it both have kind `question` and name the same
  ticket, so both derive `question:<ticketId>`. The escalation therefore supersedes the worker's
  card. The same is true for `concern` (both derive `concern:<ticketId>`).
- `gate_finding` does not collide this way in the escalation flow, because a `gate_finding` is
  always weaver-owned: a weaver-raised `gate_finding` cannot reach the human, so the weaver's
  human-reaching escalation of a worker's finding is necessarily a different kind (`question` or
  `concern`) and already lands in a different bucket. Two `gate_finding`s by the same owner on the
  same ticket do still share a bucket, which is the intended dedupe (both are asks to the weaver).

Explicit `correlationKey` callers are the system-raised approvals: `plan_approval:<ticketId>`,
`action_approval:<ticketId>`, `merge_approval:<ticketId>`, `merge_approval:archive:<ticketId>:<change>`,
`discard:<ticketId>`, `retry:<agentId>`, `hire:<roleId>`, `role-permission:<roleId>`,
`retire:<roleId>`, `stalled-worker:<agentId>`, the auth-gate keys, and the runtime-migration key.
Their supersede semantics are deliberate (a republished plan must supersede a held one even if the
owner policy changed), so they must not become owner-scoped.

## Goals / Non-Goals

**Goals:**

- A worker ask and the weaver's escalation of it are distinct objects that coexist, for `question`
  and `concern`.
- The dedupe that the correlation key exists for is unchanged: a repeat ask of the same kind, by the
  same owner, on the same ticket still supersedes.
- System-raised approvals keep their present supersede behavior exactly.
- The fix lives at the point the key is derived, not in each caller.

**Non-Goals:**

- No new tool input, decision field, or "escalation link" column. The audience (owner) already
  distinguishes the two objects; linking them explicitly is not needed for the relay to work.
- No rekeying of decisions already open under the old derived key (see Risks).
- No change to `supersedeOpen`, `supersedeForTarget`, `withdrawForTicket`, `replacementFor`, or the
  `decisions_open_corr` index — they stay key-based, and explicit keys keep their exact semantics.
- No change to which owner a kind resolves to, or to which kinds a worker may raise.

## Decisions

**Decision 1 — Make the derived default key owner-scoped: `<kind>:<owner>:<ticketId|workspace>`.**

The collision is between two objects with different audiences that happen to share a kind and a
ticket. The bucket a decision belongs to should therefore be the audience it is put to, and `owner`
is exactly that. Owner-scoping makes the worker's `question:weaver:<t>` and the weaver's
`question:human:<t>` separate buckets, while a second worker question re-derives the same
`question:weaver:<t>` and still supersedes. Placing the owner in the key also keeps the whole change
in one place (`create()`), leaves every explicit-key caller untouched, and needs no new column,
index or tool surface.

*Alternatives considered:*

- **Exempt cross-owner superseding in `supersedeOpen` (pass the new owner and only close rows with
  the same owner).** Also fixes `question`/`concern`, but it changes the shared closure used by
  `supersedeForTarget` (explicit plan/action republish), where superseding across an owner change is
  intentional and must not be weakened. It would force an owner argument through paths that have no
  single owner to give, and it silently leaves old-key rows in a state where the *next* same-owner
  ask now needs an owner comparison rather than a key match. A bigger blast radius for the same
  outcome.
- **An explicit escalation link between the two decisions (store the worker's decision id on the
  weaver's card).** Would make the relay discoverable, but the collision still destroys the worker's
  card unless it is combined with one of the above; and the weaver can already find the worker's
  open decision on the ticket. Adds a field and tool surface for no behavioral requirement in the
  spec.
- **Key by asker (`askedByAgentId`) rather than owner.** Would separate a worker's and the weaver's
  asks, but breaks dedupe across a worker relaunch (a new agent id) and between two workers on the
  same ticket — exactly the repeat-ask case the acceptance says must keep superseding. Owner is the
  stable, meaningful discriminator.

**Decision 2 — Only the derived default changes; explicit keys are untouched.**

`supersedeOpen` and the unique index keep matching on `(ticket_id, correlation_key)`. Callers that
pass a key are responsible for its shape and keep their current behavior, including a republish that
must supersede across an owner change. This is why the change is confined to the `??` branch in
`create()`.

**Decision 3 — `gate_finding` needs no special case.**

Its owner is always `weaver`, so a worker's and a weaver's `gate_finding` on one ticket stay one
bucket and supersede each other — which is the dedupe rule ("same kind, same owner"), not the
escalation bug. The escalation of a worker's `gate_finding` reaches the human through a different
kind, and the tests pin both facts.

## Risks / Trade-offs

- **[Risk] Decisions already open under an old derived key are not superseded by a post-upgrade
  repeat ask of the same kind/owner/ticket, because the new ask gets a different key.** → Accepted
  and stated in the proposal. The old card stays answerable; the terminal-ticket sweep and normal
  answering close it. This is a one-upgrade, at-most-one-extra-card artifact and does not justify a
  data migration that rewrites a column every explicit-key caller also writes.
- **[Risk] A caller that quietly relied on the exact string shape of the derived key (a test, a log
  filter).** → The derived key is internal; the tests that assert it are updated as part of this
  change. Callers that need a stable key already pass one.
- **[Trade-off] The key now encodes the resolved owner, so a decision created before an owner
  policy change and a repeat created after it land in different buckets.** → Only affects
  `question`/`concern`/`gate_finding` through the ask tool (plan approvals always pass explicit
  keys), and is the correct reading: an ask to a different audience is a different ask.

## Migration Plan

No schema or data migration. The change is behavioral: new decisions derive a new default key;
existing rows are read and answered exactly as before. Rollback is a revert of the derivation edit;
no persisted shape depends on the new form.

## Open Questions

None.
