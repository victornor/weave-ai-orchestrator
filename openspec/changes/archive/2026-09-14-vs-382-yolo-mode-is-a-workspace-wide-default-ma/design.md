## Context

See proposal.md — Why. Today the model is a workspace default `defaults.yolo` that `yoloEnabled`
resolves as `policies.yolo ?? workspaceDefault`, so a project with no override follows the
workspace and every project added later inherits it. The three read sites are
`packages/core/src/tickets/service.ts` `yolo(t)`, `packages/core/src/prompts/index.ts` (the worker
brief's `yolo` field), and `packages/ui/src/lib/yolo.ts` (`workspaceYolo`/`projectYolo`/
`isAutoApproving`). The Project row is the resolution source for the daemon: `tickets/service.ts`
reads `projects.policies_json` from SQLite, while `workspace.yaml`'s `projects[].policies` is the
declaration that `projects.update` writes alongside the row.

Precedent for a one-time config migration is in the same loader: VS-77 (model settings, gated by a
`meta` row) and VS-125 (telegram allowlist, gated by `telegram_allowlist_migrated`), both reading
the raw YAML before Zod has shaped it.

## Goals / Non-Goals

**Goals:**
- YOLO is on only where a project explicitly turns it on; unset is off; new projects off.
- No running workspace silently loses or silently gains autonomy across the upgrade.
- One obvious place to grant it (Settings → Projects, CLI `project set-policy`), with a deliberate
  confirmation, and a visible marker wherever the project is shown.

**Non-Goals:**
- Changing what YOLO auto-approves (plan and merge only; action/hire/discard/retry/questions never).
- Changing `auto_merge`, the merge queue, CI or landing verification.
- Reworking the other project policies' inheritance (proposalApproval, deliveryMode, …) — those
  keep the workspace-default fallback.

## Decisions

### Decision 1: Remove `defaults.yolo` from the model rather than keep it inert

`WorkspaceDefaultsSchema` drops `yolo`, and `yoloEnabled` loses its `workspaceDefault` parameter:
one argument, `policies`, true only when `policies.yolo === true`. A structural signature change is
chosen over always passing `false`, so a future caller cannot reintroduce inheritance by accident.
The loader still reads the raw YAML (`raw.defaults.yolo`) for the migration, before the schema
strips the now-unknown key, so a workspace written by an older release is detected. An explicit
write of `defaults.yolo` is refused at both edges — `PATCH /api/w/:ws/config` and
`weave workspace set-default` — with an error naming the project setting, instead of being accepted
and ignored.

Alternative considered: leave `yolo` in the schema and only make resolution ignore it, warning on
write. Rejected: a request that succeeds while doing nothing is the worst failure mode, and the UI
would read a stale `defaults.yolo` that no longer means anything.

### Decision 2: The migration writes both config sources, once, preserving explicit opt-outs

A loader migration gated by a new `meta` key (`vs382_yolo_migrated`) runs when
`raw.defaults.yolo === true`. For every project known to the workspace (declared in
`config.projects` and present as a non-archived DB row), it sets `policies.yolo: true` only where
`policies.yolo` is unset, then writes both the DB row's `policies_json` and the declared config, and
logs the number changed. An explicit `policies.yolo: false` is a deliberate opt-out and stays. The
`meta` row is inserted whether or not anything changed, so it never re-runs. After the write,
`workspace.yaml` no longer carries `defaults.yolo` (the schema dropped it).

Why both sources: the daemon resolves YOLO from the DB row, but `projects.reconcile`/`configFor`
can rebuild a project from the declaration and `workspace.yaml` is what an operator reads. Writing
only one would drift.

### Decision 3: Onboarding keeps the chip and scopes it to the projects it adds

"Let the weaver decide" no longer writes `defaults.yolo`. After a successful create it patches each
project added in the run to `policies.yolo: true`. "Ask me before any plan" and "Only merges and
actions" keep writing `defaults.proposalApproval`. With no projects added, the answer writes
nothing. Removing the chip was the alternative; keeping it preserves the designed autonomy question
and gives it a truthful, project-scoped meaning.

### Decision 4: The workspace-wide banner goes, per-project markers take over

The V1 `AppShell` banner "YOLO mode — plans and merges are approved for you" is removed. With the
mode varying by project it can no longer be truthful, and the "unmistakable" property is carried
instead by: the marker in the project's Settings row, the marker in the V2 project overview header,
and the existing per-decision "auto-approved under this mode" copy, which already resolves per
project. `isAutoApproving` continues to be the single resolver the boards use.

### Decision 5: Confirmation lives in the shared ProjectsSection

The YOLO control is implemented in `ActiveProjectRow`, which both V1 and V2 render via
`ProjectsSection`. Turning it on opens a confirmation dialog that names what the daemon will grant
(that project's plan and merge approvals) and that action approvals always stay with the human; the
PATCH is sent only on confirm. Turning it off patches immediately. This keeps one implementation and
one test surface for both apps.

## Risks / Trade-offs

- [The migration could turn YOLO on for a project the operator never chose] → It only copies a value
  the workspace already had in force for that project, and preserves explicit opt-outs; the change
  is logged with a count.
- [Removing `defaults.yolo` breaks clients that send it] → The write is refused with an actionable
  error rather than silently dropped; `GET` responses simply no longer carry the key, and the UI
  stops reading it.
- [V2 `ApprovalsSection` still lists YOLO] → It is edited in the same change to show the one-line
  note pointing at Projects, so no dead control remains.
- [A project overview marker is easy to miss] → It is not the only signal; the decision cards and
  board marks already say auto-approval per decision.

## Migration Plan

1. Land schema + `yoloEnabled` + loader migration + server/CLI refusal together; the migration runs
   on the first workspace load after the daemon is upgraded.
2. Rollback: an older daemon reading the migrated `workspace.yaml` finds no `defaults.yolo`
   (defaults false) and the per-project `policies.yolo: true` values it does not understand only in
   that it never reads them as a workspace default — but the older daemon *does* read
   `policies.yolo` as a project override, so behaviour is preserved. An un-upgraded workspace's
   `defaults.yolo: true` is still read by the newer daemon (migration) and by the older one
   (as before).
3. Human deploys with `weave daemon upgrade`; the migration is a side effect of load.

## Open Questions

None. The two product choices the ticket left open — onboard per-project vs remove the chip, and
reject vs warn on the deprecated key — are resolved in Decisions 1 and 3 and stated in the spec
deltas.
