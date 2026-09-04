# OpenSpec research report (v1.12.0, analyzed 2026-09-03)

Summary of the findings that drive the agent-conductor integration design. Full CLI reference lives in the OpenSpec repo (`docs/agent-contract.md`, `docs/cli.md`).

## Bottom line

- OpenSpec's *state model and read surfaces* are headless and contract-documented (`docs/agent-contract.md`).
- The productive verbs `propose`, `apply`, `archive` (skill form), `verify`, `explore` are **SKILL.md prompt artifacts executed by an LLM agent**, not CLI subcommands. There is no `openspec propose` / `openspec apply` binary.
- The only real CLI mutations: `openspec new change <name>` and `openspec archive <name> --yes --json`.
- Task progress = markdown checkboxes in `tasks.md`, edited by the agent, parsed by `/^\s*[-*]\s*\[([\sxX])\]\s*(.*)/`.

## Layout it creates in a project

```
openspec/
  config.yaml            # schema, context (<=50KB, injected into every artifact instruction), rules{artifactId:[..]}, operations{apply,archive}.guidance
  specs/<capability>/spec.md
  changes/<change-name>/
    .openspec.yaml       # schema, created, goal, affected_areas, skip_specs, retire_capabilities  (OpenSpec-owned, unknown keys not preserved)
    proposal.md design.md tasks.md specs/<cap>/spec.md
  changes/archive/YYYY-MM-DD-<name>/
.claude/skills/openspec-*/SKILL.md, .claude/commands/opsx/<id>.md     # claude
.agents/skills/openspec-*/SKILL.md                                    # codex (invoke $openspec-<id>)
.opencode/skills/openspec-*/SKILL.md, .opencode/commands/opsx-<id>.md # opencode
```

Artifact graph (default `spec-driven` schema): proposal -> {specs, design} -> tasks; `apply.requires=[tasks]`, `apply.tracks=tasks.md`. Artifact status = file existence: `blocked | ready | done | skipped`.

## CLI calls the orchestrator uses

Always run with `cwd=<project clone root>`, `--json`, env `CI=1 OPENSPEC_TELEMETRY=0 OPENSPEC_NO_UPDATE_CHECK=1 NO_COLOR=1`. Parse stdout only (exactly one JSON doc). Assert `root.path === expected clone root` on every response (root walk can escalate to an ancestor repo).

| Purpose | Command | Key fields |
|---|---|---|
| Bootstrap | `openspec init --tools claude,codex,opencode` | installs skills/commands |
| Create change | `openspec new change "<t-id>-<slug>" --goal "..." --json` | `change.{id,path,metadataPath,schema}` |
| Poll all changes (artifact graph) | `openspec status --all --json` | `changes[].{changeName,isPlanningComplete,artifacts[].{id,status,requires}}` |
| Poll task counts (cheap batch) | `openspec list --json` | `changes[].{name,completedTasks,totalTasks,status: no-tasks|complete|in-progress}` |
| Per-change apply state | `openspec instructions apply --change X --json` | `state: blocked|ready|all_done`, `progress`, `tasks[]`, `contextFiles` |
| Gate before implement | `openspec validate <change> --json --strict` | `items[].issues[].level` (exit 1 on failure) |
| Archive (deterministic merge) | `openspec archive <change> --yes --json` | `archive.{archivedAs,specsUpdated,warnings}` |
| Invariants (CI) | `openspec validate --archived`, `validate --all --json`, `doctor --json` | |

Notes:
- `isComplete` is an alias of `isPlanningComplete`. There is no single "done" flag; combine planning-complete + apply `all_done` + archive dir existence.
- `--yes` also suppresses `archive_tasks_incomplete`; gate on task counts *before* archiving.
- A change with zero spec deltas fails validation unless `.openspec.yaml` has `skip_specs: true` (chores/docs tickets).
- No lock, no "active change" concept, no run state, no events. One agent per change, serialize archives per project.
- Skills ask interactive questions (propose on ambiguity/name collision, explore before any write, archive on sync choice). Headless dispatch must supply answers up front and demand a structured QUESTION block instead of a prompt.
- Two archive implementations exist (CLI structural merge vs skill LLM merge + `mv`). **Use the CLI**; instruct agents never to run `/opsx:archive`.
- Generated skill files are OpenSpec-owned and overwritten by `openspec update`; keep our instructions in our own skills.
- Per-workspace isolation of global config/store registry: set `XDG_CONFIG_HOME` / `XDG_DATA_HOME` per workspace.
- Stores (beta) map well to "workspace shared specs" (`references:` in project config injects a spec index) but shape may change; defer to v2.

## Skill behaviors worth knowing (verbatim-ish)

- propose: "This workflow creates planning artifacts only... Do not edit project code. After the planning artifacts are complete, stop." Loop: `new change` -> `status --json` -> for each `ready` artifact `instructions <id> --json` -> write file -> repeat. Ends with "The artifacts are ready for review. When you are ready, run /opsx:apply."
- apply: `status` -> `instructions apply` -> read contextFiles -> per task: implement, tick `- [x]`, continue. "Only mark a task `- [x]` when its specified behavior is fully implemented"; "Pause on errors, blockers, or unclear requirements - don't guess".
- verify: read-only three-dimension report (Completeness/Correctness/Coherence), prose output, no JSON.
- explore: "a stance, not a workflow"; never writes; requires yes/no confirmation before any write. Do not dispatch unattended.

## Version-churn risk

Skill prose changes every release. Decisions must depend on the CLI JSON contract only; pin `@fission-ai/openspec` per workspace and diff SKILL.md on upgrade. Only `validate --json` carries a `version` field.
