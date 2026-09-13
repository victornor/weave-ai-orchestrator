# Design — say "Weaver" everywhere a person or agent reads the name

## Context

This is the display-name layer of a rename that has already moved the machine layers: the agent
kind and stored kind values to `weaver` (VS-259, migration `0027`), packages / CLI / service to
`weave` (VS-260), config keys and API fields (VS-263), the web manifest (VS-292). What is left is
what a person or an agent actually reads: labels, server strings, seed text, the TUI title, and the
stored agent's own name.

The rename tickets deliberately kept lowercase `'conductor'` *values* in place for rollback safety
and compatibility — `WAKE_SOURCES`' `conductor_request`, the on-disk policy spelling
(`VS-263` Decision 6), and the pre-`0027` kind values. Those are wire/legacy values, not text.

## Decision 1: rename the display name, nothing that merely spells the word

The ticket says "wherever it currently says Conductor **as a display name**" and its acceptance
search is for the capitalised `Conductor`. That boundary is followed exactly:

- **Renamed**: the capitalised name a reader sees — UI labels/status/help/error text, server-written
  messages, seeded knowledge text, the shipped skill headings that name the role, and the TUI title.
- **Not renamed**: TypeScript identifiers (`isConductor`, `ensureConductor`, `ConductorReviewLine`,
  `askedByConductor`, `ensureConductorView`, …), string-literal wire values (`conductor_request`,
  `models.conductor`, legacy `createdBy`/`owner` spellings), the `agent-conductor` repository name,
  and legacy on-disk paths VS-258 keeps readable. Criterion 5 of the ticket names these explicitly,
  and renaming a wire value would break stored data and rollback.

Lowercase conceptual prose ("the conductor decides", "workspace knowledge is conductor-only") is
also left for now: it is the role noun, not the display name, and the ticket's own search is
case-sensitive on the capitalised name. If captain wants the prose noun swept too, that is a
separate, larger pass over skills, tool descriptions and docs — noted here rather than absorbed.

## Decision 2: the "Settings → Conductor" pointers are wrong today, fix them to the real section

Four strings (`lib/dictation.ts` ×3, `components/Composer.tsx` ×1) tell the reader to set a
transcription provider in "Settings → Conductor". **No Settings section named `Conductor` exists** —
the sections are Workspace, Projects, Models, Channels, Presentation, and the daemon's Models,
**Dictation**, Host tools, Security, This device (`packages/ui/src/lib/settings.ts`). The
transcription provider is set in the **Dictation** section (`DictationSection`, which calls
`useTranscription`/`useSetTranscription`).

The ticket assumed these pointers name a Settings label that is being renamed; they do not. The
correct fix is "Settings → Dictation". This is a small correction beyond the literal instruction,
recorded here so the plan reviewer sees it and the report can state it.

## Decision 3: migration `0034`, re-checked before delivery

`0027_agent_kind_weaver.sql` set the agent *kind* to `weaver` but did not touch `agents.name`, which
is why every workspace on this host still has `kind = 'weaver'`, `name = 'Conductor'`.

The new migration is a one-line data fix:

```sql
UPDATE agents SET name = 'Weaver' WHERE kind = 'weaver' AND name = 'Conductor';
```

Only the untouched default is renamed; a weaver someone deliberately renamed keeps its name. New
workspaces already create the weaver as `Weaver` (`packages/core/src/workers/index.ts`
`ensureConductor`), so no code default changes — the migration only repairs existing rows.

`main` carries up to `0031_relayed_decision_answers.sql`. `0032` is claimed by VS-316 and `0033` by
VS-320, neither merged. Use `0034`, and **re-check `origin/main` and both PRs immediately before
delivery** for a moved number; if either landed and shifted the sequence, renumber rather than
collide.

The migration needs its own test (the existing `scanForLiteralConductor` scans for the lowercase
`'conductor'` value, which is not what this renames): assert the default `Conductor` becomes
`Weaver` and a custom name is untouched. A workspace-shaped database is the fixture.

## Decision 4: the TUI title is in scope

`tui/src/apps/Chat.tsx` sets the terminal title from the literal `'Conductor'` — a person reads it
whenever they run `weave chat`. The ticket enumerates the web app for labels but the title says
"everywhere a person reads the name", so the one visible literal in the TUI is included. Its
identifiers (`isConductor`, `conductorId`) are not.

## Decision 5: repository docs are left for a separate pass

`README.md`, `docs/PLAN.md`, `docs/SCENARIOS.md` and `docs/prompts/` still use the role word. They
are engineering/product documents, not a screen a captain chats on, and the ticket's acceptance
search is scoped to `packages/{ui,server,core}/src`. `docs/prompts/worker.AGENTS.md.tmpl` is a stale
copy (the shipped `templates/` already say "Weaver's notes"). A docs sweep can be its own ticket;
folding it in here would balloon a label fix into a full-documentation rewrite.
