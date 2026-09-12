# Shipped skills

The agent-facing instruction layer. Each skill is a directory with a `SKILL.md` and, where the material is longer than a turn needs, a `references/` directory that the agent loads only when it gets there.

Always-loaded prompts live in `templates/` (`conductor.AGENTS.md.tmpl`, `worker.AGENTS.md.tmpl`, `charter.md.tmpl`, `brief.md.tmpl`). Skills hold everything conditional. The rule that keeps this working: a line in an always-loaded file is paid for by every turn of every agent; a line in a skill is paid for only by the turns that load it. When in doubt it goes in a skill, and the always-loaded file names the trigger.

## What is here

| Skill | Audience | Purpose |
|---|---|---|
| `weave-ai-worker` | worker | The turn loop, brief verification, ticket rules, status protocol, delivery and merge, report format, common mistakes. |
| `weave-ai-openspec` | worker | How ticket status maps onto the OpenSpec workflows; what never to do. |
| `weave-ai-scout` | worker | Report format and rules for investigation tickets. |
| `weave-ai-weaver` | weaver | Intake, routing, supervision, digest handling, outcome language. |
| `weave-ai-hire` | weaver | Role overlap check, spec drafting, activation flow, charter refinement. |
| `weave-ai-planning` | weaver | Minimal ticket graphs, qualifying split reasons, acceptance criteria. |
| `weave-ai-briefing` | weaver | The four-section briefing, one decision at a time. |
| `weave-ai-knowledge` | all | Knowledge placement, entry rules, the curation procedure. |
| `weave-ai-artifacts` | all | When and how to publish a self-contained HTML artifact with the AC Artifact Kit; diagram, table, comparison, plan, code and change playbooks. |

`manifest.json` is the machine-readable version of that table: `skills[].{name, audience, description}` where `audience` is `weaver`, `worker` or `all`, plus the per-runtime install paths.

## How the daemon installs them

Skills are installed **into each agent's home** — `conductor/` for the conductor, `workers/<id>/` for a worker — at provisioning time, and regenerated whenever the shipped version changes. The daemon reads `manifest.json`, filters by the agent's `kind`, and writes each selected skill directory to the path its runtime discovers:

| Runtime | Install path (relative to the agent home) | How the agent invokes it |
|---|---|---|
| `claude` | `.claude/skills/<name>/SKILL.md` | loaded by description, or `/`-invoked |
| `codex` | `.agents/skills/<name>/SKILL.md` | `$<name>` |
| `opencode` | `.opencode/skills/<name>/SKILL.md` | loaded by description |
| `gemini` | `.gemini/skills/<name>/SKILL.md` | loaded by description |

`references/` is copied alongside `SKILL.md`, preserving relative paths, so the links inside a skill resolve in every runtime.

Installation is idempotent and content-addressed: an unchanged skill is not rewritten, and a skill the agent should no longer have is removed. Agents never edit their own skills; a skill changed in an agent home is overwritten on the next run.

OpenSpec's own generated skills (`openspec-*`) live in the **project worktree**, not the agent home, and are owned by OpenSpec — `openspec update` overwrites them. Ours never collide with them, and nothing here should ever be written into a project.

## Writing or changing a skill

- **Frontmatter** is `name` and `description`. The description is one line saying *when to load this*, because that is the only text a runtime sees before deciding.
- **Keep `SKILL.md` under 250 lines.** Longer material goes into `references/` and is linked from a closing section. An agent that never needs the merge procedure should never pay for it.
- **Rules over prose.** Tables, imperatives, and the exact tool call shape. If a rule has a "why", give it one clause.
- **Tool names are API.** They come from `packages/shared/src/tools.ts`; never invent one, never rename one in prose.
- **Statuses, kinds, states and report fields** come from `packages/shared/src/enums.ts` and `report.ts`. Spell them exactly as they appear there.
- Rules lifted from the prior-art research keep close to their original wording — they were chosen for their phrasing.
- Adding a skill means adding it to `manifest.json` and to the table above, and naming its trigger in whichever template should load it.
