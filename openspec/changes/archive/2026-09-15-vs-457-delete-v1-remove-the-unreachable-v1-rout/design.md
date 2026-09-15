## Context

VS-456 left V1 registered nowhere but still on disk. The real work is deciding what "V1" means: the
`routes/` bucket contains seven files V2 still imports (two of them via dynamic `import()`, which a
static grep misses), and `app/`, `lib/`, `api/`, `index.css` and most of `components/` are shared
infrastructure V2 depends on today. The map is the VS-448 scout report §2.

## Goals / Non-Goals

- Delete the unreachable V1 tree and shell without changing what V2 renders.
- Collapse two stylesheets into one with V2's Mono values as the only defaults.
- Non-goal: un-nesting `v2/` or renaming directories; any URL or redirect change; any visual change.

## Decisions

### The reused pieces move to a shared module per subject, not a big-bang `shared/`

Each of the seven reused route files has a different shape:

| File | Reused export(s) | New home |
|---|---|---|
| `routes/Settings.tsx` | 9 section components + `KnowledgeBudgetsSection` | `settings/sections/v1-sections.tsx` (V1 page wrappers dropped) |
| `routes/KnowledgeDocs.tsx` | `DocsPanel`, `DocPanel`, `KnowledgeDocPanel`, `refFromPath`, `DocRef` | `knowledge/panels.tsx` |
| `routes/Changelog.tsx` | `KIND_LABEL` | `lib/changelog.ts` |
| `routes/GlobalScheduled.tsx` | `dueLabel`, `scheduleLabel` | `lib/schedule.ts` |
| `routes/Onboarding.tsx` | step machinery + `StepRow` | `lib/onboarding.tsx` |
| `routes/KnowledgeExplorer.tsx` | whole screen | `v2/knowledge/KnowledgeExplorerView.tsx` (moved, not rewritten) |
| `routes/KnowledgeGraph.tsx` | whole screen | `v2/knowledge/KnowledgeGraphView.tsx` (moved, not rewritten) |

A single relocation of each reused block, with the V1 route wrapper deleted around it, keeps the diff
reviewable and avoids a new `shared/` dumping ground. The two whole-screen files move under `v2/`
because that is the only consumer.

### `index.css` absorbs `v2.css`; the `.v2-root` token scope goes

`v2.css` overrides `--bg-*`, `--text-*`, `--line-*`, `--accent*`, `--status-*`, `--diff-*`,
`--syntax-*`, `--project-*`, `--overlay`, `--elev-*` and the `--approve*`/`--review-clean` tokens
under `.v2-root`; `index.css`'s `@theme inline` mapping, base resets, `.ac-*` and `.ac-code` hljs
rules stay. The merged `index.css` takes V2's values as the `:root, [data-theme='dark']` and
`[data-theme='light']` defaults, moves the `.v2-*` component classes in (unscoped, since the `v2-`
prefix is namespace enough and V1 no longer exists), and keeps the `--v2-*` motion/shape tokens.

`generateV2PluginCss` currently takes `(v2Css, indexCss)` and extracts tokens from one and rules from
the other. After the merge it takes the single stylesheet, so `daemon.ts`'s `dirs()` stops resolving a
`v2.css` path and the fallback is unchanged.

## Risks

- **Visual regression** from the token merge. Mitigated by before/after captures in dark and light.
- **The plugin theme endpoint** silently falling back if a path goes stale. Mitigated by updating
  `daemon.ts` and its test, and keeping the fallback path reachable.
- **A missed importer** of a deleted module. Mitigated by a repo-wide grep after deletion plus
  `pnpm typecheck` and both suites.
