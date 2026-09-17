## Why

The weaver has been learning from its own mistakes, but each lesson has been written into a private
notes file belonging to this deployment's runtime. No other Weave AI workspace receives it, so a
fresh weaver repeats the same failure. The product already ships the right home for these rules —
the weaver instructions installed into every agent home — and it was not being used.

## What Changes

- Fold five groups of operating lessons into the weaver's shipped instructions, written as terse
  rules in the voice of the existing documents rather than as an incident appendix:
  - **Choosing a worker** — deliberately left out. The change already on main makes
    `workerModelId` required on the agent filing path and its shipped text tells the weaver to read
    each option's description rather than guess, which is the lesson. The ticket's own rule is not
    to duplicate a rule the code enforces, so this change adds nothing here and defers to that text.
  - **Reviewing approval cards** — review the oldest unreviewed card first; mark every card that was
    read, including one held for a reason outside the work, and say what it waits on; a `concerns`
    mark wakes nobody, so return and re-review when the revision lands.
  - **Evidence** — a plan or report claiming something works is not evidence that it does; read the
    delivery. Rendered evidence for a visual change means the renders across the supported themes and
    viewport sizes, opened and confirmed, not asserted. Do not call a pull request ready while its
    checks are still running.
  - **Routing what the human says** — a stated want is acted on rather than turned into a poll; asks
    that arrive together are one ticket; a message carrying a roadmap block is a roadmap item, not a
    ticket.
  - **Reading worker state** — a run that succeeded with no wake scheduled is a stall whatever the
    digest label says; inspect a run before relaunching it and check whether the human already
    resumed it.
- Sharpening, not layering: where a shipped instruction already says something close, the nearest
  sentence is tightened rather than a second rule added beside it. Where a lesson is already stated
  in shipped text (the roadmap-block intake rule), it is verified and left alone.
- The added text names no workspace, project, ticket or human, and requires no local configuration.

## Capabilities

### New Capabilities

- `agent-prompts/weaver-operating-lessons`: the operating lessons the shipped weaver instructions
  must carry — worker-option choice, evidence over assertion, routing of arriving asks, and reading
  worker state — so every deployment's weaver gets them from the product.

### Modified Capabilities

- `agent-prompts/weaver-review-guidance`: the shipped review guidance adds oldest-first ordering,
  marking every card that was read (including one held with a waiting statement), and the fact that
  a `concerns` mark wakes nobody so the card must be re-reviewed when a revision lands.

## Impact

- `templates/weaver.AGENTS.md.tmpl` (always-loaded weaver prompt) and
  `skills/weave-ai-weaver/SKILL.md` (the review and supervision procedure), with
  `skills/weave-ai-weaver/references/routing.md` only if a routing rule needs the longer form.
  `templates/weaver.AGENTS.md.tmpl` keeps its under-200-line target.
- `packages/core/src/prompts/render.test.ts` gains assertions that the shipped template carries the
  new rules; `packages/shared/src/tools.test.ts`'s agent-facing prose guard must stay green (every
  tool named is already registered).
- `packages/core/src/prompts/defaults.ts` is a crash fallback for a missing template file, not the
  shipped source; it is deliberately left alone.
- The worker-option lesson is carried by the required-field change now on main, so this change
  deliberately does not touch it; the one shared sentence was resolved in favour of that change on
  rebase.
