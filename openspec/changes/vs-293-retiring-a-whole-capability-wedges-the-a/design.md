## Context

`openspec` 1.12.0 (installed globally, `@fission-ai/openspec`, not vendored) already implements
capability retirement: `archive.js` rebuilds each touched capability's spec from its delta, and if
the rebuild is empty, it checks the change's `.openspec.yaml` for `retire_capabilities: true`
(`change-metadata/schema.js`). Set, it deletes the capability's `spec.md` (`fs.rm`, not recursive —
the directory itself is left empty on disk, and disappears from git once the deletion is committed,
since these capability directories hold nothing but `spec.md`). Unset, it throws
`archive_spec_validation_failed`. This is a real, documented mechanism, not a gap in the tool — see
proposal.md's Why. `openspec validate --strict`, however, never runs this rebuild; it validates each
delta's own shape, which VS-285's delta satisfied. So a change can validate clean at propose time and
still be guaranteed to fail at archive time, which only runs after merge.

`packages/core/src/openspec/index.ts`'s `validateForProposed` is the function `tickets/service.ts`'s
`transition()` calls (for `to === 'proposed'` on a `change` ticket) before it writes the `plan`
document and raises the `plan_approval` decision — whose card text (`"OpenSpec change ... is
planning-complete and validates"`) is exactly what told VS-285's reviewer nothing was wrong.

## Goals / Non-Goals

**Goals:**
- Move the "would this empty a capability without declaring it?" check to the one point in the
  pipeline where a worker can still fix it: before `proposed`.
- Reuse the existing `retire_capabilities` marker and `.openspec.yaml` schema field exactly as
  `openspec` itself defines them — this is enforcement of an existing contract, not a new one.

**Non-Goals:**
- Reimplementing `openspec archive`'s actual spec-merge/rebuild. The check only needs to detect the
  narrow shape archive already treats specially (a capability driven to zero requirements), not
  reproduce the full merge (MODIFIED text substitution, RENAMED bookkeeping, scenario diffing).
- Patching `@fission-ai/openspec`. It is a third-party global install; VS-285's ticket already ruled
  this out, correctly.
- Changing VS-285's shipped code, or touching `runtime-credentials/credential-visibility`.

## Decisions

**Detect the "would-empty" shape by counting, not by re-running the merge.** For each capability a
change's `specs/**/spec.md` delta touches:
1. Read the delta file's `## ADDED Requirements` / `## MODIFIED Requirements` / `## REMOVED
   Requirements` / `## RENAMED Requirements` sections and count `### Requirement:` entries under
   each.
2. Read the capability's current main spec, if any (`openspec/specs/<capability-path>/spec.md`, via
   the existing `cli.showSpec` wrapper's `requirementCount` — already used by `statusFor`).
3. Survivors = mainCount − removed + added (MODIFIED and RENAMED requirements keep an existing
   requirement alive; they don't change the survivor count). If the capability has no main spec yet,
   it is being introduced, not retired — never flagged.
4. If survivors ≤ 0 and the change's `.openspec.yaml` does not set `retire_capabilities: true`, add an
   error-level issue naming the capability.

This is a deliberately narrower question than "will archive succeed" — it does not need to be, since
archive already owns that authority and already answers it correctly. Counting is enough because
`openspec validate --strict` (run in the same gate, immediately before this check) has already
proven every named requirement in the delta is real and every section is well-formed; this check
only adds the one fact `validate` does not check, which is whether the survivor count is zero.

**Rejected alternative: shell out to a real `openspec archive --json` as a dry run.** Archive has no
`--dry-run`/`--check` flag (confirmed via `openspec archive --help`), and it mutates the working
directory it runs in (moves the change under `changes/archive/`, rewrites `openspec/specs/`) — running
it against the ticket's own worktree to "just check" would require staging the whole project into a
disposable copy first, for a question that counting already answers. Not worth the cost or the new
failure surface (a `.git` clone step that itself needs a timeout, cleanup-on-error, etc.).

**Where the check lives.** Inside `validateForProposed`, after the existing `cli.validate` call:
merge its issues into the same `issues` array `validateForProposed` already returns, so a `change`
ticket's `proposed` request is rejected through the exact same `openspec_validation_failed` path
(`tickets/service.ts:527`) a real `openspec validate --strict` failure uses today. No new error code,
no new decision kind.

## What happens when VS-285's archive runs with the marker set

Read directly off `archive.js`'s rebuild/retire logic (see proposal.md's Impact), against VS-285's
actual deltas at `openspec/changes/vs-285-stop-forcing-claude-credential-refreshes/specs/`:

| Capability | Delta shape | Outcome once `retire_capabilities: true` is set |
|---|---|---|
| `runtime-credentials/serialized-refresh` | `## REMOVED Requirements`, all 3 of its 3 current requirements | Rebuild is empty; retirement is authorized, so archive deletes `spec.md` (`fs.rm`, not the directory) instead of writing an empty spec. Once the daemon's post-archive `git add -A && git commit` (or push, per project policy) lands, the directory holds no tracked file and is gone from `main`. |
| `runtime-credentials/single-credential` | `## MODIFIED Requirements`, 1 of its 4 current requirements | Rebuild keeps all 4 (3 unchanged + 1 with new text); written in place, not deleted. |
| `runtime-credentials/login-outage` | `## MODIFIED Requirements`, 1 of its 7 current requirements | Rebuild keeps all 7 (6 unchanged + 1 with new text); written in place, not deleted. |
| `runtime-credentials/credential-visibility` | no delta in this change | Untouched — archive has nothing to do for a capability the change never mentions. |

The change directory itself moves to `openspec/changes/archive/<date>-vs-285-stop-forcing-claude-credential-refreshes/`,
same as any other archived change (`archivedDirFor`). This is the daemon's own post-merge
`archiveAfterMerge` step (`packages/core/src/openspec/index.ts`), run in the primary clone once the
weaver retries VS-285's merge after this ticket's fix lands — not something this ticket executes
itself.

## Risks / Trade-offs

- **[Risk]** The counting approach could, in principle, disagree with `archive`'s own rebuild in an
  edge case neither VS-285 nor this design anticipated (e.g., a delta with a malformed or
  duplicate-named `### Requirement:` entry that `validate --strict` itself would already reject
  first). → Mitigation: this check runs immediately after `cli.validate` in the same gate and only
  adds its own issues when `cli.validate` reported none for that delta, so a shape `validate` already
  rejects is reported through the existing path, not this one.
- **[Risk]** A false positive would block a legitimate propose. → Mitigation: the check only ever
  adds an error; it never turns an `openspec validate --strict` failure into a pass, and the fix for
  a false positive is always the same one-line marker a real retirement needs anyway.

## Migration Plan

1. Add `retire_capabilities: true` to VS-285's `.openspec.yaml` (already-merged change; this is a
   direct data fix, not new code).
2. Add the counting check to `validateForProposed` and its helper.
3. Add the new capability's spec delta (this document's sibling).
4. Test against a fixture shaped like VS-285's real delta (per [[tickets-and-openspec]]'s note on
   fixtures from real bytes), not a guessed one.
5. Once merged, the weaver retries VS-285's merge; its archive step runs with the marker now present
   and completes per the table above.

No rollback beyond a normal revert: the check only ever blocks a `proposed` request, and the VS-285
marker fix does not change any behavior until the weaver's archive retry runs.
