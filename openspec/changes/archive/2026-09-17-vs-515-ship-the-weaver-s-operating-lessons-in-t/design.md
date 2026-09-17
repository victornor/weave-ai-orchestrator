## Context

See `proposal.md` — Why. The weaver's always-loaded prompt is rendered from
`templates/weaver.AGENTS.md.tmpl` by `packages/core/src/prompts/index.ts`; the per-topic procedures
live in `skills/weave-ai-weaver/SKILL.md` and its `references/`. Those two sources ship with the
product and are installed into every agent home, so both are read here. `packages/core/src/prompts/defaults.ts`
holds a much shorter `WEAVER_TMPL` used only when the template file is missing from
`ctx.templatesDir`; it is a crash fallback, not a second shipped source, so it is not edited.

`templates/weaver.AGENTS.md.tmpl` carries a target of under 200 lines in its own header and is
currently 134, so there is room, but the ticket asks that anything already said be sharpened rather
than duplicated. `packages/shared/src/tools.test.ts` scans `skills/`, `templates/`, `docs/` and
`packages/core/src/prompts/` for `weave_*` tokens and fails on any name the server does not
register, so every tool named in the new text must be an existing one (`weave_worker_models`,
`weave_run_inspect` and `weave_roadmap_add` all are).

## Goals / Non-Goals

**Goals:**

- Carry each of the five lesson groups in the shipped sources, in the existing voice and brevity.
- Put each lesson where the procedure already handles that subject, so a rule is found where it is
  needed rather than in an appendix.
- Keep the change rebase-safe against the in-flight change that makes the worker option required.

**Non-Goals:**

- Changing any tool, the decision service, the digest, or the stalled-worker sweep. Those behaviors
  already exist; this change only moves what the weaver is told.
- Editing `templates/weaver.AGENTS.md.tmpl`'s fallback twin in `packages/core/src/prompts/defaults.ts`.
- Restating an enforcement that lives in code (the required worker option) or a rule already stated
  in shipped text (the roadmap-block intake rule).

## Decisions

### The shipped prompt is the always-loaded template plus the weaver skill

Each new rule is written once, in the document the weaver reads for that topic: a short
always-loaded statement in the template, and the operational detail in the skill. This matches how
the existing review and intake rules are split, and it is what makes the lesson reach a fresh
workspace with no local configuration.

### Sharpen the nearest existing sentence instead of adding a rule beside it

The lessons map onto sentences that already exist; the edit is a rewrite of the nearest one, or an
addition only where nothing covers the point:

| Lesson | Target | Edit |
|---|---|---|
| Choose a worker option | — | Left to the required-field change now on main; no edit here. |
| Oldest card first | skill *Reviewing a card*; template card paragraph | Add one clause naming age order and why a waiting card does not re-wake. |
| Mark every card read | skill *Reviewing a card*; template card paragraph | Extend the existing `waitingOn` sentence to say a card held for a reason outside the work is still marked, and that unmarked reads as forgotten. |
| `concerns` wakes nobody | skill *Reviewing a card* | One clause: a concern does not re-wake the weaver, so return when the revision lands. |
| Read the delivery | skill *Reviewing a card* | One clause: an assertion of success is not evidence; read the plan or the PR itself. |
| Rendered evidence | skill *Reviewing a card* | One clause: visual evidence is the renders across supported themes and viewport sizes, opened and confirmed. |
| Do not call a PR ready while checks run | template card paragraph | Fold into the existing `waitingOn` guidance rather than a new sentence. |
| Stated want, not a question | skill *Intake* classification note | One clause in the classification step: a stated want is acted on, not turned into a poll. |
| Asks that arrive together are one ticket | skill *The ticket template* / *Intake* | One clause beside "one ticket per distinct deliverable". |
| A block-carrying message is a roadmap item | already shipped (skill *Roadmap blocks*) | Verify; no new text. |
| Succeeded run with no wake is a stall | skill *Supervision* table | Extend the "worker quiet past its window" row to name a succeeded run with no scheduled wake. |
| Inspect before relaunch; check for a human resume | skill *Supervision* / *Relaunching* | Extend the relaunch sentence: inspect first and check whether the human already resumed it. |

### The worker-option lesson is left to the required-field change

The change now on main makes `workerModelId` required on the agent filing path, has the refusal name
the catalogue, and already ships the instruction to read each option's description rather than
guess. Duplicating that rule here would be noise, so this change touches neither sentence and
records the deferral in the proposal; the one shared sentence was resolved in favour of the landed
change on rebase.

### The roadmap-block rule is verified, not rewritten

The skill already routes a `blockId`-carrying message into its block rather than a ticket. The task
verifies the rendered text still says this; adding a second rule would be noise.

## Risks / Trade-offs

- [Risk] The text drifts into deployment specifics (a project, ticket or human name) → a task
  includes a read of the diff for those words, and the acceptance list repeats the constraint.
- [Risk] The template grows past its 200-line target or repeats itself → the edit is a rewrite of
  the nearest sentence; a task checks the rendered line count and the diff size against the value.
- [Risk] A named tool does not exist and the prose guard fails → every tool named is already in
  `COMMON_TOOLS`/`WEAVER_TOOLS`, and the suite is run before delivery.
- [Risk] The overlap with the required-worker-option change caused a rebase conflict on one sentence
  → resolved in favour of that landed change; this change adds no worker-option text.

## Migration Plan

Nothing to migrate: the files are prompt sources rendered at run time and installed into agent homes
on the next worker spawn. Rollback is the revert of the two-file change.

## Open Questions

None.
