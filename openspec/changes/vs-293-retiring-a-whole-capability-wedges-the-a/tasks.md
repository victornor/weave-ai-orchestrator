## 1. Unblock VS-285

- [x] 1.1 Add `retire_capabilities: true` to `openspec/changes/vs-285-stop-forcing-claude-credential-refreshes/.openspec.yaml`, alongside its existing `schema:` key. Verify `openspec validate vs-285-stop-forcing-claude-credential-refreshes --strict --json` still reports clean and the file parses as valid YAML.

## 2. Gate a future wholesale retirement at the proposed step

- [x] 2.1 Add a pure helper in `packages/core/src/openspec/index.ts` (or a sibling module) that, given a change's spec-delta files and the current main specs, returns the capabilities whose delta would leave zero requirements. Verify with a unit test built from a fixture shaped like VS-285's real `runtime-credentials/serialized-refresh` delta (all-REMOVED, no other sections) plus a fixture of a partial removal that must NOT trigger.
- [x] 2.2 Wire that helper into `validateForProposed`: when a returned capability's change `.openspec.yaml` does not set `retire_capabilities: true`, append an error-level issue naming the capability and the marker to the same `issues` array `cli.validate`'s issues already populate. Verify a test that calls `validateForProposed` against a fixture change directory shaped like VS-285's (no marker) returns `ok: false` with that issue, and the same fixture with the marker set returns `ok` unaffected by this check.
- [x] 2.3 Verify (existing suite, no new test needed) that a change whose deltas only ever modify or partially remove a capability's requirements is unaffected by the new check, whether or not `retire_capabilities` is set.

## 3. Close the loop

- [x] 3.1 Run `pnpm typecheck`, `pnpm lint`, and both `pnpm test` suite blocks (core/server and UI) and paste both blocks verbatim in the delivery report.
- [x] 3.2 Record a project-knowledge note (linked from `[[tickets-and-openspec]]`) about the `retire_capabilities` marker and this gate, so the next wholesale-retirement change is written correctly the first time.
