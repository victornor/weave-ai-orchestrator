## 1. `ModelSettingFields`: make `disabled` actually disable everything

- [x] 1.1 Add `disabled` to the free-text escape-hatch `<input>` and its `CommitStatus`/save
      affordance; add an `if (disabled) return;` guard at the top of the runtime select's, the
      model select's, and the free-text field's change handlers.

## 2. `OverlaySetting`: explicit inherit/override scope control

- [x] 2.1 Replace the `filled`-inferred "Use per-workspace settings" button with a `<select>`
      (`aria-label="{label} scope"`) offering `inherit — <fallback.runtime> · <fallback.model ??
      'default'>` and `override`. Selecting `inherit` calls `onClear()`; selecting `override`
      calls `onFill(fallback)`.
- [x] 2.2 Pass `disabled={!filled}` into the wrapped `ModelSettingFields` (already piped through
      after task 1.1) so the row's runtime/model controls are inert while inheriting.
- [x] 2.3 Update the row's hint text to state plainly which state it is in, and — while
      inheriting — that the shown value is this workspace's own, not asserted as universal.

## 3. `DaemonModelsSection`: show the value actually being inherited

- [x] 3.1 Call `useModels()` alongside `useDaemonModels()`/`useRuntimes()`; gate the loading state
      on all three.
- [x] 3.2 Pass `workspaceModels.data.conductor` / `.workers` as each `OverlaySetting`'s `fallback`
      instead of `emptySetting(runtimes)`. Leave `DaemonWorkerOptions`' `fallback` as
      `emptySetting(runtimes)` (design.md Non-Goals — the catalog overlay keeps its own defaults,
      unrelated to what is being previewed as "inherited").

## 4. `WorkerOptionsEditor`: model field becomes a picker

- [x] 4.1 Factor the "is this model in the runtime's known list" check out of `ModelSettingFields`
      into a small shared helper (or export the inline expression) so both call sites agree on
      when to show the custom-text escape hatch.
- [x] 4.2 Add `useRuntimeModels(runtime)` to the new-option form; replace the free-text model
      `<input>` with a `<select>` (known models + an explicit "runtime default" entry + "something
      else…") over local state, matching `ModelSettingFields`' shape; the "something else…" choice
      reveals the existing free-text `<input>`, still local state, no auto-commit.
- [x] 4.3 Changing the new-option runtime re-queries `useRuntimeModels` for the new runtime and the
      model picker reflects it.

## 5. Tests

- [x] 5.1 `packages/ui/src/test/models.test.tsx`: rewrite "opens daemon Models from This daemon and
      PUTs an overlay (VS-185)" — assert that changing the runtime/model control while inheriting
      makes no write, and that choosing "override" from the scope select is what creates the
      overlay (seeded from the shown fallback).
- [x] 5.2 Add a test that the daemon Models scope select's `inherit` option states the workspace's
      own conductor/workers runtime and model (AC #4).
- [x] 5.3 Add a test that choosing `inherit` on an overridden row clears the overlay via the select,
      with no separate button involved (AC #2).
- [x] 5.4 Add a test for the worker-option model picker: known models offered, "runtime default"
      selectable, "something else…" reveals free text and that value is submitted on Add (mirrors
      the existing `ModelSettingFields` free-text test).
- [x] 5.5 Check `packages/ui/src/test/settingsScopes.test.tsx` for any assumption this change
      breaks (it navigates to `daemon-models`); fix if needed. (No assumption broken — it only
      asserts navigation/tab selection, not field state; all 16 tests still pass unchanged.)
- [x] 5.6 `pnpm --filter @agent-conductor/ui exec vitest run`, `pnpm lint`, `pnpm typecheck` all
      green. (Also ran `pnpm test` for the whole repo: 145 passed/1 skipped root + 79 passed ui.)

## 6. Screenshots (AC #7, for the PR body — not part of the diff)

- [x] 6.1 Using the `ui-screenshot-harness` knowledge doc's approach, capture phone-portrait-width
      screenshots of: an inheriting Conductor/Workers row, an overridden row, and the
      worker-option add form with the model picker open. Reference the files in the PR body.
      (Harness files deleted before commit, per convention; screenshots left uncommitted in
      `.vs207-screenshots/` in the worktree, referenced by absolute path in the PR/report.)
