# OpenSpec CLI — the contract you may rely on

Run everything with `cwd = work/`, `--json`, and one JSON document on stdout. The productive verbs (`propose`, `apply`, `verify`, `explore`) are **skills executed by you**, not CLI subcommands: there is no `openspec propose` binary. Only these mutate anything: `openspec new change` and `openspec archive` (which you never run).

| Purpose | Command | Fields you may depend on |
|---|---|---|
| Create the change | `openspec new change "<name>" --goal "<title>" --json` | `change.{id, path, metadataPath, schema}` |
| Artifact graph | `openspec status --all --json` | `changes[].{changeName, isPlanningComplete, artifacts[].{id, status, requires}}` |
| One change's graph | `openspec status --change <c> --json` | as above, for one change |
| What to write next | `openspec instructions <artifactId> --json` | the instruction text for that artifact |
| Apply state | `openspec instructions apply --change <c> --json` | `state: blocked \| ready \| all_done`, `progress`, `tasks[]`, `contextFiles` |
| Task counts (cheap) | `openspec list --json` | `changes[].{name, completedTasks, totalTasks, status}` |
| Gate before implementing | `openspec validate <c> --json --strict` | `items[].issues[].level`; exits 1 on failure |

Notes:

- Artifact status is **file existence**: `blocked | ready | done | skipped`. The default `spec-driven` schema is proposal → {specs, design} → tasks, with `apply.requires = [tasks]` and `apply.tracks = tasks.md`.
- `isComplete` is an alias of `isPlanningComplete`. There is no single "done" flag — planning-complete, apply `all_done` and the archive directory are three separate facts.
- Task progress is markdown checkboxes in `tasks.md`, parsed as `/^\s*[-*]\s*\[([\sxX])\]\s*(.*)/`. Nothing else counts as progress.
- A change with zero spec deltas **fails validation** unless `.openspec.yaml` has `skip_specs: true`. That is the tracker case only.
- There is no lock and no "active change" concept. One agent per change; you are that agent.
- The layout in your worktree: `openspec/config.yaml` (context and rules, injected into every artifact instruction), `openspec/specs/<capability>/spec.md` (source of truth after archive), `openspec/changes/<name>/{.openspec.yaml, proposal.md, design.md, tasks.md, specs/<cap>/spec.md}`.
- Skill prose changes between OpenSpec releases; the JSON contract does not. When the skill text and this file disagree about *process*, follow Weave AI. When they disagree about *CLI output*, trust the CLI.
