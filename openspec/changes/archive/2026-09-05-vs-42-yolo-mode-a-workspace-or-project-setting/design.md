## Context

See `proposal.md` — Why. The state this design has to fit into:

- `packages/core/src/tickets/service.ts:284` raises the `plan_approval` in the post-transition side
  effects of `transition(to: 'proposed')`, but only after `approvalOwner(next)` (`:143`) returns
  something other than `'none'`; `'none'` recurses into `transition(to: 'approved')` with no decision.
- `packages/core/src/tickets/service.ts:301` raises the `merge_approval` in the side effects of
  `transition(to: 'in_review')`, but only `if (!next.autoMerge)`; an `autoMerge` ticket instead gets
  a deferred `autoMergeSweep()` (`:317`).
- `autoMergeSweep` (`:725`) selects `in_review AND auto_merge = 1`, checks `deliveryMode` and
  `requireCi` against the project's policies, asks the github forge for `prState`, skips on
  `pending`, comments on `failure`, and otherwise transitions the ticket to `merging` itself. The
  supervisor calls it every tick (`packages/core/src/supervisor/index.ts:468`).
- `decisions.answer` (`decisions/service.ts:191`) records the answer first and runs the side effect
  second, so `applyPlanApproval` / `applyMergeApproval` are exactly the transitions a human triggers.
- Project policies reach core as an untyped `Record<string, unknown>`; `mergeConcurrencyOf`
  (`shared/src/config.ts:27`) is the house pattern for resolving one safely.
- `PLAN` §15 states the ownership policy as `merge_approval: human` — "not overridable; only a
  ticket's `auto_merge` flag bypasses it". This change makes it overridable.

## Goals / Non-Goals

**Goals:**

- Reuse the existing approval path end to end: the auto-approval is an answer on the real decision,
  not a second way to move a ticket.
- One resolver for "is YOLO on here", read by core, the API consumers and the prompts, so the daemon
  and the surfaces can never disagree.
- No new table, column or migration.

**Non-Goals:**

- Replacing `autoMerge` or `proposalApproval: 'none'`. Both keep their current behaviour and win
  where they already apply; YOLO is the workspace-wide mode layered beside them.
- Auto-answering anything that is not a plan or merge approval.
- A new CLI command. The two generic policy setters already take arbitrary keys.

## Decisions

**Answer the decision instead of skipping it.** The alternative — extending the two existing
short-circuits (`approvalOwner() === 'none'`, `!next.autoMerge`) to cover YOLO — is a smaller diff,
but it leaves no record: today a ticket approved that way has nothing in `decisions` saying so, which
is precisely the complaint in the ticket ("recorded as answered by the system with the mode named").
Creating and then answering costs one extra row per approval and buys the whole audit trail,
supersession, wake and knowledge-append machinery for free.

**Plan: answer inline; merge: answer from the sweep.** A plan is ready the moment the decision
exists, because `transition(to: 'proposed')` has already run `validateForProposed`. So the plan
approval is answered in the same side-effect block that creates it. A merge is *not* ready when the
decision exists — the spec says "as soon as the PR is open with green checks" — and the sweep is
already the thing that knows how to wait for that. So the merge decision is created and left open,
and `autoMergeSweep` gains the job of answering it.

**The sweep's candidate set widens; its CI logic does not change.** It selects `in_review` tickets
that are `auto_merge = 1` **or** whose project has YOLO on, runs the same delivery-mode / `requireCi`
/ `prState` gate, and then branches once at the end: if the ticket has an open `merge_approval`,
answer it as the system; otherwise transition directly, which is exactly today's `autoMerge`
behaviour. That keeps `autoMerge` tickets on their current path byte for byte and makes the two
mechanisms compose rather than conflict.

**Policy is read at the point of action, not stamped on the decision.** No `autoApproved` column on
`decisions`; the sweep re-reads the setting on every tick, and the plan path reads it at `proposed`.
This is what makes "turning the mode off stops auto-approval for decisions created afterwards" fall
out for free, and it also makes turning the mode *on* pick up decisions already waiting. The cost is
that the mode's effect on an open decision is not durable — acceptable, because the decision itself
is durable and the human can always answer it.

**Precedence with the existing escapes.** `approvalOwner() === 'none'` is checked first and keeps
winning: a project that explicitly said "nobody approves plans here" gets the current no-decision
path. `autoMerge` on a ticket keeps suppressing the merge decision. YOLO applies to everything else.
Stated in the spec's terms: YOLO decides what happens to a decision that *is* raised.

**Resolver shape.** `yoloEnabled(policies: Record<string, unknown> | null | undefined, workspaceDefault: boolean): boolean`
in `packages/shared/src/config.ts`, next to `mergeConcurrencyOf` and parsed through
`ProjectPoliciesSchema.shape.yolo` so a malformed value falls back to the workspace rather than
throwing. `ProjectPoliciesSchema` is already `.partial()`, so an absent key is `undefined` = inherit;
the workspace default is a plain `z.boolean().default(false)` on `WorkspaceDefaultsSchema`.

**Surfaces read the same setting, not a new endpoint.** `GET /api/w/:ws` already returns the whole
`config` (so `config.defaults.yolo`), and the projects list already returns `policies`. The web app
resolves the flag client-side with the same rule; no route is added, and `docs/API.md` needs no new
entry. `DecisionCard` takes an `autoApproving?: boolean` prop rather than growing a hook — the UI
route tests mock `../api/hooks` wholesale, so a new hook would break every route test.

**Recursion.** Answering the plan decision inside `transition(to: 'proposed')` re-enters
`transition(to: 'approved')`, the same shape the existing `'none'` branch already has. The write
transaction has committed by then, so there is no nested `tx`. The outer call must re-read the row
before returning, or its caller gets a ticket that still says `proposed`.

## Risks / Trade-offs

- **A run-away workspace.** With the mode on, a bad plan lands without anyone reading it. → The mode
  is off by default, is a deliberate act to turn on, and is shown persistently in the shell so it can
  never be on unnoticed; a project can opt out; nothing bypasses CI, the merge queue or the landing
  verification.
- **Answering the plan decision re-enters `transition`.** → Same pattern as the existing `'none'`
  branch; the side effect runs after the transaction commits, and the failure path in
  `decisions.answer` already logs and rethrows without losing the recorded answer.
- **The sweep now touches every `in_review` ticket in a YOLO workspace, not just `auto_merge` ones.**
  Each one costs a `prState` call per supervisor tick. → Same cost profile as an `autoMerge`-heavy
  workspace today; the query is still one indexed scan of `in_review` rows, and only tickets with a
  PR reach the forge.
- **A decision answered by the system while the human is looking at its card.** → `answer` already
  rejects a non-open decision with `wrong_status`, and the UI already surfaces that as "could not
  record that answer" and shows the decision's real state.
- **Deviation from `PLAN` §15.** → Recorded in a new ADR and the §15 sentence updated, per
  `CLAUDE.md`'s rule that deviations get an ADR rather than a silent edit.

## Migration Plan

Nothing to migrate: no schema change, and an absent `yolo` in either place means off, which is
today's behaviour. Rollback is turning the setting off (or shipping the previous release); decisions
already answered by the system stay answered, exactly as decisions answered by a human do.
