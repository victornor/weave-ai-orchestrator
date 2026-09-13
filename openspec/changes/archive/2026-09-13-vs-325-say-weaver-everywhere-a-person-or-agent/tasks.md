# Tasks

## 1. Web app display strings

- [x] 1.1 `packages/ui/src/routes/Chat.tsx`: the header `title="Conductor"` becomes `"Weaver"`, and
  the queued reason `'Conductor is replying — your message is queued'` becomes
  `'Weaver is replying — your message is queued'`. The `askedByConductor` identifier and the
  `conductor` comment on line ~155 stay.
- [x] 1.2 `packages/ui/src/routes/NeedsYou.tsx`: `Conductor is deciding` becomes `Weaver is deciding`.
- [x] 1.3 `packages/ui/src/routes/Team.tsx`: the section label `Conductor` becomes `Weaver` (keep the
  `{/* conductor */}` code comment out of scope or update it for consistency — identifier, not
  display).
- [x] 1.4 `packages/ui/src/routes/Settings.tsx`: the workspace-knowledge hint `WORKSPACE.md. Conductor
  only.` becomes `WORKSPACE.md. Weaver only.`; the three `label="Conductor"` props (workspace Models
  `ModelSettingFields`, daemon Models `OverlaySetting`, and the Presentation `PresentationBlockRow`)
  become `label="Weaver"`. Leave the `conductorFallback` identifier.
- [x] 1.5 `packages/ui/src/lib/dictation.ts` (three strings) and `packages/ui/src/components/Composer.tsx`
  (the two `Settings → Conductor` strings, including the doc comment on line ~31) point at
  `Settings → Dictation` — the section that actually holds the transcription-provider setting. See
  design.md Decision 2.

## 2. Server-written text

- [x] 2.1 `packages/server/src/channels.ts`: the review follow-up becomes
  `` `Weaver reviewed ${decision.title} — has concerns: ${note}` ``. (Only `concerns` produces a
  follow-up line; the `looked` copy lives in `packages/shared/src/weaver-review.ts` and already says
  `Weaver reviewed — no concerns`.)
- [x] 2.2 `packages/server/src/routetable.ts`: the `/presenter/desired` summary `Conductor + worker
  views the presenter should show` becomes `Weaver + worker views the presenter should show`.

## 3. Core seed and layout text

- [x] 3.1 `packages/core/src/knowledge/files.ts`: the workspace `seedBody` blurb `Conductor-only. What
  this workspace is for, …` becomes `Weaver-only. What this workspace is for, …`.
- [x] 3.2 `packages/core/src/workspace/loader.ts`: the WORKSPACE.md skeleton comment `Conductor-only.
  Budget … tokens. …` becomes `Weaver-only. Budget … tokens. …`.

## 4. TUI

- [x] 4.1 `packages/tui/src/apps/Chat.tsx`: the terminal title literal `'Conductor'` becomes
  `'Weaver'`. Leave the `isConductor`/`conductorId` identifiers.

## 5. Agent-facing skills

- [x] 5.1 `skills/weave-ai-knowledge/SKILL.md`: both `**Conductor only**` occurrences (SHARED.md and
  WORKSPACE.md routing bullets) become `**Weaver only**`.
- [x] 5.2 `skills/weave-ai-worker/references/tools.md`: the `## Conductor only` heading becomes
  `## Weaver only`.
- [x] 5.3 `skills/weave-ai-weaver/references/examples.md`: the `# Conductor replies — worked examples`
  heading becomes `# Weaver replies — worked examples`.

## 6. Stored agent name

- [x] 6.1 Add `packages/db/src/migrations/0034_rename_default_weaver_agent.sql` containing
  `UPDATE agents SET name = 'Weaver' WHERE kind = 'weaver' AND name = 'Conductor';` with a one-line
  header comment naming VS-325 and why only the default is renamed. **Before committing, re-check
  `origin/main` and open PRs VS-316/VS-320**: if `0032`/`0033` landed or the sequence moved, use the
  next free number instead (design.md Decision 3).
- [x] 6.2 Add a migration test in `packages/db/src/migrations.test.ts` (its own `describe`, opening a
  workspace-shaped DB): a `kind='weaver', name='Conductor'` row becomes `Weaver`; a
  `kind='weaver', name='Chief'` row is unchanged; a `kind='worker'` row named `Conductor` is
  unchanged. Assert the exact names, not merely that the migration ran.
- [x] 6.3 Confirm `packages/core/src/workers/index.ts` `ensureConductor` still creates the weaver with
  `name: 'Weaver'`; adjust nothing if true, and add a `workers.test.ts` assertion that the fresh
  weaver's name is `Weaver`.

## 7. Tests assert the new text

- [x] 7.1 `packages/ui/src/test/models.test.tsx`: every `getByLabelText('Conductor …')` becomes
  `'Weaver …'` (`runtime`, `model`, `scope`, `thinking level`), `Clear Conductor overlay` becomes
  `Clear Weaver overlay`, and the `tab` name `'Conductor'` becomes `'Weaver'`.
- [x] 7.2 `packages/ui/src/test/presentation.test.tsx`: `row('Conductor')` becomes `row('Weaver')` in
  both assertions.
- [x] 7.3 `packages/ui/src/test/globalMap.test.tsx`: the fixture agent name `'Conductor'` becomes
  `'Weaver'` and the expected label list uses `'Weaver'`.
- [x] 7.4 `packages/ui/src/test/components.test.tsx`: the `queuedReason` sample string becomes
  `'Weaver is replying — your message is queued'` and its assertion follows. Leave the
  `ticketFiledByConductor` prop name (identifier) and the `queryByText(/Conductor/)` absence check.
- [x] 7.5 `packages/core/src/knowledge/files.test.ts`: the `isHubStub` fixture blurb `Conductor-only`
  becomes `Weaver-only` so the fixture matches the shipped seed.
- [x] 7.6 `packages/server/test/channels.test.ts`: strengthen the concerns-review follow-up test to
  assert `followUp` contains `Weaver reviewed` (not only `has concerns`).
- [x] 7.7 Add a direct assertion that the chat header reads `Weaver` (e.g. in `chat.test.tsx` or
  `components.test.tsx`) and that the Team section label and NeedsYou line read `Weaver`, so the
  label change is asserted rather than only implied by other queries.

## 8. Verify and report

- [x] 8.1 Run `rg -n "Conductor" packages/ui/src packages/server/src packages/core/src` excluding
  tests and internal identifiers, and record the result with a one-line reason for each remaining
  match (should be identifiers, legacy values, comments only). Result: 41 matches remain, every one
  an identifier (`ensureConductor`, `isConductor`, `askedByConductor`, `ticketFiledByConductor`,
  `ConductorReviewLine`, `rawConductor`, `nudgeIdleConductor`, `renderConductorInstructions`,
  `conductor` local vars) or an internal log line; no user- or agent-visible display string.
- [x] 8.2 Run `pnpm lint`, `pnpm typecheck`, and both suites; paste both suite blocks verbatim in the
  report (core/server and UI separately, never summed, never one block described as both). Result:
  `pnpm lint` ok; `pnpm typecheck` ok; core/server `Test Files 182 passed | 1 skipped (183)`,
  `Tests 2796 passed | 1 skipped (2797)`; UI `Test Files 98 passed (98)`, `Tests 1631 passed (1631)`.
- [x] 8.3 Record as a work product the PR/branch and a report stating: every file touched, the
  `Settings → Dictation` correction, the migration number used and the re-check result, and any
  intentional leftovers from 8.1.

## Task 7 note (criterion 1, lowercase mid-sentence)

The spec's web-app requirement says "read Weaver (or weaver where the sentence needs lowercase)", so
the web app and TUI sweep includes lowercase role mentions in visible text ("Message the weaver…",
"Replying to the weaver", "ask the weaver", the dictation pointers, …), beyond the plan's original
capital-only list. Identifiers, wire values and legacy spellings stay as they are (design.md
Decision 1, criterion 5).
