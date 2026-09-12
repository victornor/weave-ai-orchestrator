# When the gate rejects you

The daemon rejects a `proposed` transition when `isPlanningComplete` is false or `validate --strict` reports issues. The rejection carries the issues. Work through them; do not request the transition again unchanged.

| Symptom | Cause | Fix |
|---|---|---|
| `isPlanningComplete: false` | an artifact the schema requires is missing | `openspec status --change <c> --json`, find the artifact whose status is `ready`, run `openspec instructions <id> --json`, write it |
| Validation: no spec deltas | the change touches no capability, e.g. a chore or a docs ticket | only for a `task` tracker change: set `skip_specs: true` in `openspec/changes/<c>/.openspec.yaml`. Never on a real `change` ticket — if a `change` genuinely has no spec delta, it was mis-classified: say so on the ticket |
| Validation: requirement has no scenarios | a requirement was written as prose | give every requirement at least one scenario in the delta spec |
| Validation: unknown capability | the delta names a capability that does not exist and was not declared as added | either use the existing capability id (`weave_spec_list`) or declare the addition properly in the delta |
| `openspec new change` says the change exists | a previous turn already created it | good — continue in it; never create a second one under a different name |
| `root.path` is not your worktree | OpenSpec walked up to an ancestor repo | you are not where you think you are: `weave_worktree_status`, and if it disagrees with your brief, report `blocked` |
| Apply `state: blocked` | tasks depend on an artifact that is not `done` | finish the planning artifact it names before implementing |
| `tasks.md` progress not reflected outside | checkboxes not in the parsed form | use `- [ ]` / `- [x]` at the start of the line |
| Change name in the ticket differs from the one in `work/` | you created it under a name you chose | stop. The bound name is authoritative. Move the artifacts into the correctly named change, or report `blocked` if you cannot |

Run the CLI with `CI=1 OPENSPEC_TELEMETRY=0 OPENSPEC_NO_UPDATE_CHECK=1 NO_COLOR=1` if a command tries to be interactive or prints an update banner into your JSON.
