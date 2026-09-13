---
name: weave-ai-openspec
description: How an Weave AI ticket maps onto the OpenSpec propose/apply workflows — the change is already named for you, planning artifacts come before code, and you never archive. Load on any `change` ticket (or a `task` ticket with a tracker change).
---

# OpenSpec, as Weave AI drives it

Your ticket is bound to exactly one OpenSpec change. Its name is in your brief and in `weave_ticket_get(id).openspecChangeName`. **Never ask whether to create or continue a change, never pick a different name, and never work in someone else's change.** If the change does not exist yet in `work/`, create it and move on:

```
cd work && openspec new change "<the name from your brief>" --goal "<ticket title>" --json
```

For a `task` ticket with a tracker change, write `skip_specs: true` into the change's `.openspec.yaml` right after creating it, so `validate` passes without spec deltas.

## The mapping

| Ticket status | What you run | Phase is done when | You request |
|---|---|---|---|
| `todo` | the **propose** workflow (`/opsx:propose <change>` on Claude/OpenCode, `$openspec-propose` on Codex) | proposal, specs, design and tasks all written; `openspec validate <change> --json --strict` clean | `weave_ticket_transition(id, "proposed")` |
| `proposing` | fix what the gate or the revision comment listed | the same as above | `proposed` again |
| `proposed` | nothing — the human is deciding | — | — |
| `approved` | the **apply** workflow (`/opsx:apply <change>` / `$openspec-apply`) | every task in `tasks.md` ticked and committed | deliver, then `in_review` |
| `in_progress` | continue apply | as above | `in_review` |
| `in_review` | nothing; answer comments | — | — |
| `merging` | the merge procedure (`weave-ai-worker` → `references/delivery.md`) | merged and verified | `weave_ticket_merge_done` |

The daemon runs `openspec status --change <c> --json` and `openspec validate <c> --json --strict` when you request `proposed`. A rejection lists the exact issues; fix them and request again. It also polls `openspec instructions apply --change <c> --json` after each turn to mirror your progress — so ticking tasks honestly is what makes the outside world see the truth.

## Propose

> This workflow creates planning artifacts only. Do not edit project code. After the planning artifacts are complete, stop.

- Loop: `openspec status --all --json` → for each `ready` artifact, `openspec instructions <id> --json` → write that file → repeat.
- Write the proposal, the spec deltas, the design where the schema asks for it, and `tasks.md`. Tasks are the unit the apply phase and the daemon both track: each one a discrete, verifiable piece of behavior.
- A change that **creates a capability** puts that capability's `## Purpose` in its delta spec (`specs/<capability>/spec.md`), above the `## ADDED Requirements` heading. `openspec archive` reads it when it builds the main spec, so your wording is what readers get; without it the archive step has to substitute the proposal's "Why", and a change with no usable "Why" cannot land.
- **Material ambiguity is an `weave_ask`, not a question in prose and not a guess.** Give concrete options and a recommendation, then end the turn. Prose questions reach nobody: the OpenSpec skill's own interactive questions have no human on the other end here.
- Do not write code. Do not create files outside `openspec/changes/<change>/`. Do not start "just the scaffolding".
- When the artifacts are complete, request `proposed` and stop. The skill's closing line tells you to run `/opsx:apply`; **ignore it** — apply happens on a later turn, after the human approves.

## Apply

- Start from `openspec instructions apply --change <c> --json`: it gives you `state` (`blocked` | `ready` | `all_done`), the task list, and `contextFiles`. Read the context files.
- Implement pending tasks in order. Tick `- [x]` **only when the specified behavior is fully implemented** — not when it is scaffolded, not when it is "basically there".
- Commit per task or per logical group, with the ticket id in the message.
- Pause on errors, blockers, or unclear requirements — do not guess. Same obstacle twice → `blocked` with a routable path.
- **Scope beyond the spec** → `weave_ask` and pause that task. Never absorb it silently, never drop it silently. If it is genuinely separate work, say so on the ticket and let the weaver decide.
- When `state` is `all_done`, deliver per your delivery mode and transition to `in_review`.

## Revision

`revise` on a plan approval puts your ticket back to `proposing` with the feedback as a comment. Read the comment, change the artifacts (not the code), re-validate, request `proposed` again. A new plan revision supersedes the old approval — you do not need to chase the old decision.

## Never

- **Never run `openspec archive` or `/opsx:archive`.** The daemon archives your change onto your own branch as part of landing it, before the merge — not you, and not after a merge that already happened. Running it yourself corrupts that.
- **Never run `openspec update`** — it overwrites the generated skill files, which are OpenSpec's, not ours.
- Never run the `explore` workflow unattended; it requires confirmation before any write and there is nobody to confirm.
- Never implement during propose, and never re-plan during apply.
- Never edit `.openspec.yaml` beyond `skip_specs` on a tracker change: unknown keys are not preserved.

## References

- `references/openspec-cli.md` — the JSON fields you may rely on.
- `references/troubleshooting.md` — validation failures and what fixes them.
