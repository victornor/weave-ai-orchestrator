## Context

See `proposal.md` — Why. The pieces this design builds on, as they exist today:

- `RolesService.update(actor, id, patch, reason, _opts)` (`packages/core/src/roles/index.ts:160`)
  already does the hard part: `RoleSpecSchema.partial().strict()` refuses an unknown key, the patch is
  merged over the current spec with `id`/`project` forced from `before`, `changedKeys` is computed
  from a JSON diff, `persistSpec` writes `roles/<id>/role.yaml` and bumps `roles.spec_revision`, a
  revision is written, `role.update` activity is recorded and `role.updated` is emitted. Its `_opts`
  is unused.
- `RolesService.updateCharter` (`:194`) writes `CHARTER.md`, bumps `spec_revision`, records a
  revision with `['charter']` and accepts `applyToRunning` — but only records the flag in the
  revision and activity; nothing consumes it.
- Home re-rendering is lazy and revision-driven: `ensureHomeCurrent` (`packages/core/src/workers/home.ts:63`)
  re-renders a worker's `AGENTS.md` when the marker's `specRevision` differs from the role row's, and
  `renderWorkerInstructions` inlines `roles.charter(id)`. So any `persistSpec` bump already refreshes
  the brief on the worker's next turn — but it re-reads the same stale `CHARTER.md` file unless the
  file itself was rewritten.
- The `hire_approval` card already exists (`packages/ui/src/components/DecisionCard.tsx:585`) with an
  approve/reject pair from `NAMED_CARD_OPTION_KEYS`, and `applyHireApproval`
  (`packages/core/src/decisions/service.ts:265`) consumes an approved card. Role retirement already
  reuses the `discard_approval` kind with a role-specific title and options
  (`packages/core/src/roles/index.ts:269`) — reusing an existing approval kind for a role lifecycle
  action is established practice, not a new pattern.
- Tool registration is one registry (`packages/server/src/tools.ts`), filtered by agent kind through
  `toolNamesFor` (`:924`); a weaver-only tool must be named in `WEAVER_TOOLS`
  (`packages/shared/src/tools.ts:10`) or `packages/shared/src/tools.test.ts` fails on prose that
  mentions it. `runTool` parses the input with its Zod schema and turns a failure into a `validation`
  ToolResult, so a `.strict()` patch schema refuses unknown keys before the handler runs.

## Goals / Non-Goals

**Goals:**
- One weaver-only tool edits every mutable `RoleSpec` field, reusing `roles.update` rather than a
  second writer.
- A security-sensitive `permission` change cannot apply without the approval the hire policy asks
  for; every other field applies with a revision immediately.
- A spec change keeps a spec-rendered charter and the live workers' briefs current; a hand-written
  charter is never silently overwritten, and the caller is told so.
- The result tells the caller exactly what happened: revision, `changedKeys`, whether the charter was
  rewritten, whether workers were re-briefed, and whether a permission change is pending.

**Non-Goals:**
- A web UI editor for role spec fields (VS-333 owns the Team/Roles rework; out of scope in the
  ticket).
- Changing the `hire_approval` option keys or adding a new decision kind.
- Letting `weave_role_update` change a role's `secrets` or `maxWorkers`; those keep their dedicated
  tools and their own validation.
- Re-plumbing how worker homes detect a changed role (the `specRevision` marker is sufficient and
  stays).

## Decisions

### The core writer is the single path; a policy wrapper sits in front of it

`RolesService.update` stays the unconditional writer and gains two core behaviors (charter sync and
`applyToRunning` re-briefing). A new `RolesService.requestUpdate(actor, id, patch, reason, opts)`
sits in front of it and owns everything the ticket calls "tool behavior": refusing `id`/`project` as
immutable, refusing `secrets`/`maxWorkers` with a message naming `weave_role_set_secrets` /
`weave_role_set_max_workers`, refusing an empty patch, and the permission gate. Only
`weave_role_update` calls `requestUpdate`; the session-authenticated `PATCH /roles/:id` route keeps
calling `update` directly. That is the human's own path (and the CLI's `role set-max-workers`) — a
human does not need to approve their own permission change — and its existing contract deliberately
accepts `maxWorkers` and `secrets`, which `requestUpdate` refuses for the tool. `applyHireApproval`
calls `update` directly, because approval has already been given and re-gating would be circular.

Alternative considered: put the gate in the tool handler in `packages/server/src/tools.ts`. Rejected
because the decision-apply handler lives in core and would duplicate the immutable/permission logic.

Alternative considered: route the HTTP PATCH through `requestUpdate` too, as defense in depth.
Rejected because it would refuse `maxWorkers`/`secrets` there and break the shipped HTTP/CLI contract
(the integration suite pins `PATCH {maxWorkers}` returning 200); the route is session-authenticated,
so its caller is the human, not an agent acting alone.

### A permission change reuses the `hire_approval` kind, with a target discriminator

When `patch.permission` differs from the current permission and `defaults.hireApproval !== 'none'`,
`requestUpdate` raises a decision of kind `hire_approval` — the same kind a hire uses, so
`defaultOwner` already translates `hireApproval` into the human/weaver owner and the card already
renders — with:

- `correlationKey: role-permission:<roleId>`, distinct from a hire's `hire:<roleId>`, so a pending
  hire and a pending permission change for the same role never supersede each other;
- `target: { roleId, permissionChange: true, patch, reason, applyToRunning }`, carrying the whole
  patch so approval applies exactly what was proposed;
- a role-specific title ("Change permission for <name>?") and context (the current and proposed
  mode/allowed/denied, plus the reason), and `recommendation: null` — a security change is not
  recommended for the human;
- options `NAMED_CARD_OPTION_KEYS.hire_approval.approve` / `.reject`.

`applyHireApproval` branches on `target.permissionChange`: it applies `target.patch` through
`roles.update` (carrying `target.applyToRunning`) and does **not** activate the role or assign the
project's describe scout ticket, which is what the hire path does. A `reject` answer changes nothing.
The whole patch is held, not just the permission object, so approval can never leave a half-applied
edit; a weaver that wants scope applied now makes two calls.

The `DecisionCard`'s hire branch checks `target.permissionChange` and renders the approve button as
"Approve" rather than "Hire", with the head label "Role approval" — otherwise a permission change
would present a "Hire" button to an existing role.

Alternative considered: a new `role_change_approval` decision kind. Rejected as churn across
`DECISION_KINDS`, `NAMED_CARD_OPTION_KEYS`, the owner switch, the apply switch and the UI for no
behavioral gain; `retire` already reuses `discard_approval` this way.

Alternative considered: apply non-permission fields immediately and hold only `permission`.
Rejected: two revisions from one call, and a confusing intermediate state where a patch's fields
land asynchronously.

### Charter sync is decided by content comparison, with no new persisted flag

Just before writing, `update` compares the on-disk `CHARTER.md` with `renderCharter(ctx, beforeSpec)`,
the template's output for the *current* spec. Equal means the file is the spec template's rendering
and is rewritten from the merged spec; not equal means a human or the weaver wrote it by hand, so it
is left alone and the result reports `charterRewritten: false`. This needs no migration and works for
every existing role, whose charters were rendered at hire time.

Alternative considered: a persisted `charter_source` column or a marker file. Rejected as a migration
and a rollback-compatibility surface (`role.yaml` is deliberately kept parseable by a pre-VS-263
daemon) for a fact the file's own content already carries. The trade-off is conservative: a charter
rendered by an *older* template that no longer matches today's `renderCharter` is treated as
hand-written and left alone, which is the safe direction — never overwrite prose the daemon cannot
prove it generated.

### `applyToRunning` re-briefs live workers eagerly; the marker remains the backstop

When `opts.applyToRunning === true`, `update` re-renders the home of each live worker of the role via
`renderHome` (`packages/core/src/workers/home.ts:35`) and reports how many. The `specRevision` bump
already causes `ensureHomeCurrent` to refresh any worker that was not re-rendered (and any worker
spawned later), so `applyToRunning` is an immediacy knob, not the thing that makes a spec change
visible. Scoping it to live workers only keeps a spec edit from touching retired or other roles'
homes.

Alternative considered: bump each live worker's `briefRevision` and let `ensureHomeCurrent` re-render
on the next turn. That is literally "on their next turn", but it still leaves a turn in flight
reading the old `AGENTS.md`, and the eager render is the observable the ticket's test asks for.

### Immutable and routed fields are refused in the service wrapper

`requestUpdate` rejects a patch containing `id` or `project` with a message naming them immutable,
and `secrets` or `maxWorkers` with a message naming the tool that owns them. It reuses
`roles.update`'s own `RoleSpecSchema.partial().strict()` for unknown keys, so the tool's input schema
and the service agree on the shape and there is one error path.

## Risks / Trade-offs

- **[Risk]** The content-comparison heuristic rewrites a hand-written charter that happens to be
  byte-identical to `renderCharter`. → **Mitigation**: the only way to produce a byte-identical file
  is to paste the rendered template verbatim; the rewrite then produces the same prose for the new
  spec, which is what a spec-rendered charter is. The inverse (a genuinely spec-rendered charter left
  stale because the template moved) is the conservative direction the ticket asks for.
- **[Risk]** A session-authenticated `PATCH /roles/:id` can still change `permission` without the
  approval card, since only the weaver tool is gated. → **Mitigation**: that route is the human's own
  path and the UI offers no permission editor, so the only actor reaching it is the human themselves;
  the gate exists to stop the weaver changing a security field unilaterally, which it does.
- **[Risk]** Reusing `hire_approval` means `applyHireApproval` now has two shapes. → **Mitigation**:
  branch on the explicit `target.permissionChange` flag, not on the correlation-key string, and keep
  the hire path (activate + assign the describe scout) untouched; tests cover both branches.
- **[Trade-off]** `roles.update`'s return type grows from `Role` to a result object so the caller can
  report `changedKeys`, charter and re-brief. The HTTP route returns `.role` to keep its response
  shape; the internal call sites (`setSecrets`, `weave_role_set_max_workers`) destructure `.role`.
- **[Trade-off]** A `permission`-bearing patch is held whole. A weaver that bundles a scope rename
  with a permission tweak waits for approval on both. Accepted for atomicity; the workaround (two
  calls) is one sentence in the skill.

## Migration Plan

1. Ship `roles.update`'s two new behaviors and the `requestUpdate` wrapper; nothing calls it until the
   tool lands, and the route's existing non-permission PATCHes are unchanged.
2. Ship the `weave_role_update` tool, its `WEAVER_TOOLS` entry and the skill/docs text; the weaver
   adopts it on its next turn.
3. Ship the `applyHireApproval` branch; only role-permission decisions carry
   `target.permissionChange`, so hires are unaffected.
4. No data migration. Rollback leaves a role-permission `hire_approval` decision open; a pre-change
   daemon opening it would activate an already-active role, which is inert (`activate` only sets
   `status: active`) — so roll back with no pending permission card.
