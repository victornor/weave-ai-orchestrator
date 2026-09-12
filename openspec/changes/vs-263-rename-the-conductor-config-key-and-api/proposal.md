## Why

VS-259 renamed the `conductor` agent kind wherever it is a value the database stores. It deliberately
left one surface for this ticket: the same word as a **config key on disk** and as an **API field
over the wire** — `workspace.yaml`, `daemon.yaml`, `PUT /models`, `PUT /api/daemon/models`, and the
locked-state response. Those files are not written by this system alone (an operator hand-edits
them), so renaming the key outright would either fail to parse an existing file or, worse, parse it
with the setting silently dropped to a default. Research for this proposal also found the surface is
wider than VS-263's own filing knew: `presentation.conductor` (a config block, missed by the
original inventory) and `APPROVAL_OWNERS` (`'human' | 'conductor' | 'none'`, the value behind
`proposalApproval` / `taskApproval` / `hireApproval`) carry the identical problem and were left with
inline `raw === 'conductor' ? 'weaver' : raw` translations by VS-259's worker, each commented as
"VS-263's deferred config-key surface" — this proposal is that deferred work, done in full.

## What Changes

- Every schema field in the table below is renamed to `weaver`, and internal code moves to the new
  field name throughout. Parsing accepts either spelling everywhere.
- **Writing is not uniform, by deliberate choice (design.md Decision 6), because two rounds of
  plan-review feedback changed it mid-propose:** the two `PUT` responses and the locked-state
  response — nothing a rollback could ever read back — canonicalize to `weaver` immediately.
  `workspace.yaml`, `daemon.yaml`, a role spec's `createdBy`, and a project's stored policy
  (`policies_json`, the `APPROVAL_OWNERS` fields) — every artifact a pre-VS-263 daemon could still
  read after `conductor daemon rollback` — keep being **written under the old spelling for now**, so a
  rollback is fully safe, uniformly, with no field-by-field exception. (A first revision carved
  `APPROVAL_OWNERS` out as safe to write `weaver` immediately, reasoning from one read-site shim; a
  second review found two *other* read sites for the same field that are not idempotent and would
  have silently misrouted approvals on a rollback — see design.md Decision 6.) This is a considered
  exception to "newly written configuration uses the new spelling," not an oversight; see design.md
  for the two rejected write-everywhere/write-both alternatives.
- A file, request body, or stored record carrying **both** spellings for the same field is a refused,
  loud validation error — never a silent pick — matching the policy `path-compatibility` (VS-258)
  already established for on-disk directories, extended here to config keys.
- `createdBy: 'conductor'` (role specs) and `'conductor'` as an `APPROVAL_OWNERS` value are value-level
  aliases, not key renames: the literal old value is accepted on read either way, and (per the write
  exception above) is also what still gets written back, for now.
- No user file is rewritten as a side effect of loading it.
- **BREAKING (internal only, not user-facing):** every in-repo consumer of the renamed
  TypeScript fields (`WorkspaceConfig.conductor`, `WorkspaceModels.conductor`, `DaemonModels.conductor`,
  `ModelsLocked.conductor`, `PresentationConfig.conductor`, the CLI's and UI's own duplicated wire
  types) moves to `.weaver`. No external contract breaks: old files and old request bodies keep
  parsing exactly as before.
- Not changed: `agents.kind`, `decisions.owner`, the per-workspace directory name, and any other
  value VS-259 already migrated in the database — this ticket touches config files and API payloads
  only. `@agent-conductor/*` package names, the `conductor` CLI binary name, and CLI-vocabulary prose
  (e.g. `conductor models set conductor|workers`, the `conductor` process/window markers in
  `packages/surfaces/herdr`, `chatPrefs`/`dictationDiagnostics` local-storage event names) are VS-260's
  job, not this one — none of those are a config key or a wire field.
- The `workers.conductor()` service method and similarly-named local variables are a code-identifier
  cleanup, not a config/API surface; left alone here on purpose to keep this diff bounded to what the
  ticket actually asks for.

Renamed fields (`packages/shared/src/config.ts` unless noted). "Written as" is new per design.md
Decision 6: a persisted artifact a rollback could read back keeps the old spelling on write, for now;
a wire response, which persists nothing, does not.

| Schema | Field | Read | Written as |
|---|---|---|---|
| `WorkspaceConfigSchema` (`workspace.yaml`) | top-level `conductor: {...}` → `weaver` | either | `conductor` (unchanged, for now) |
| `WorkspaceDefaultsSchema` (`workspace.yaml`) | `conductorDigestIntervalSec` → `weaverDigestIntervalSec` | either | `conductorDigestIntervalSec` (unchanged, for now) |
| `WorkspaceModelsSchema` (`workspace.yaml`'s `models:`) | `conductor` → `weaver` | either | `conductor` (unchanged, for now) |
| `WorkspaceModelsPutSchema` (`PUT /models` body) | `conductor` → `weaver` | either | n/a (request, not written by the daemon) |
| `DaemonModelsSchema` (`daemon.yaml`'s `models:`) | `conductor` → `weaver` | either | `conductor` (unchanged, for now) |
| `DaemonModelsPutSchema` (`PUT /api/daemon/models` body) | `conductor` → `weaver` | either | n/a (request, not written by the daemon) |
| `ModelsLockedSchema` (locked-state response) | `conductor` → `weaver` | n/a (never parsed from input) | `weaver` (wire; no rollback exposure) |
| `PresentationConfigSchema` (`workspace.yaml`'s `presentation:`) | `conductor` → `weaver` | either | `conductor` (unchanged, for now) |
| `RoleSpecSchema` (a role's spec file) | `createdBy` value `'conductor'` → `'weaver'` | either | `'conductor'` (unchanged, for now) |
| `enums.ts` `APPROVAL_OWNERS` (`policies_json` / `workspace.yaml` defaults) | value `'conductor'` → `'weaver'` | either, where re-parsed | `'conductor'` (unchanged, for now — two of its three read sites are not idempotent for a stored `'weaver'`, design.md Decision 6) |

`PUT /models` and `PUT /api/daemon/models`'s *response bodies* (what the two schemas above compute
after applying a change) are `WorkspaceModelsSchema`/`DaemonModelsSchema`-shaped and follow those
rows: `weaver` in memory, but re-serialized to `workspace.yaml`/`daemon.yaml` under the old spelling
per Decision 6 — the HTTP response itself says `weaver`, since that part is wire, not disk.

## Capabilities

### New Capabilities
- `config-compatibility`: how the daemon reads a config file or an API request body that may carry
  either the old or the new spelling of a renamed field, what it writes back, and what happens when
  a record carries both spellings at once.

### Modified Capabilities
- `worker-provisioning/runtime-skill-path`: found during apply, not at propose time — `skills/manifest.json`'s
  `audience` vocabulary (`worker | conductor | all`) is exactly this ticket's surface, explicitly deferred
  here by VS-259's own design.md ("its `audience` value stays `'conductor'` only if VS-263 is the one that
  [fixes it]"). Unlike `workspace.yaml`/`daemon.yaml`/`role.yaml`, the manifest ships inside the release
  directory itself, so a rollback restores the old manifest alongside the old code that reads it — no
  Decision-6 legacy-write mechanism is needed, just a plain rename to `weaver`.

## Impact

- `packages/shared/src/config.ts`, `packages/shared/src/enums.ts`: schema and enum changes, plus the
  small alias-handling helpers they're built on.
- `packages/core/src/workspace/loader.ts`, `packages/core/src/models/{index,resolve,migrate}.ts`,
  `packages/core/src/prompts/index.ts`, `packages/core/src/roles/index.ts`,
  `packages/core/src/usage/accounts.ts`: internal call sites reading the renamed fields.
- `packages/server/src/routes/{daemon,models,workspace}.ts`, `packages/server/src/channels.ts`:
  route handlers and the `DaemonModelsView` response shape.
- `packages/presenter/src/{reconcile,index}.ts`: presentation-block resolution.
- `packages/cli/src/commands/{models,daemon,presentation}.ts`, `packages/ui/src/api/types.ts`,
  `packages/ui/src/routes/{Settings,Onboarding}.tsx`: the CLI's and the UI's own duplicated wire types.
- `docs/API.md`: the two `PUT` bodies and the models response document `weaver`, noting the accepted
  legacy alias.
- No database migration: nothing here is a stored column value VS-259 didn't already handle.
