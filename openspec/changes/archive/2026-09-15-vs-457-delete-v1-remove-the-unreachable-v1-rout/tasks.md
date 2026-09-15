## 1. Hoist the reused pieces out of `routes/`

- [x] 1.1 Move `routes/Settings.tsx`'s reused sections (`ProjectsSection`, `HostToolsSection`, `ChannelsSection`, `PresentationSection`, `SecuritySection`, `DictationSection`, `DeviceSection`, `UpdatesSection`, `KnowledgeBudgetsSection`) into a shared module and update `v2/settings/*` importers.
- [x] 1.2 Move `routes/KnowledgeDocs.tsx`'s `DocsPanel`, `DocPanel`, `KnowledgeDocPanel`, `refFromPath`, `DocRef` into a shared module and update V2 importers.
- [x] 1.3 Move `routes/Changelog.tsx`'s `KIND_LABEL` (and `KIND_TONE`) into a shared module and update V2 importers.
- [x] 1.4 Move `routes/GlobalScheduled.tsx`'s `dueLabel`/`scheduleLabel` into a shared module and update V2 importers.
- [x] 1.5 Move `routes/Onboarding.tsx`'s step machinery and `StepRow` into a shared module and update `V2Onboarding`.
- [x] 1.6 Move `routes/KnowledgeExplorer.tsx` and `routes/KnowledgeGraph.tsx` whole into `v2/knowledge/` and update their dynamic importers.

## 2. Delete the V1 surface

- [x] 2.1 Delete `packages/ui/src/routes/**` and `routes/project/**`, now empty of imported code.
- [x] 2.2 Delete the V1 shell files `app/AppShell.tsx`, `app/BottomBar.tsx`, `app/MoreSheet.tsx`, `app/NavGlyph.tsx`, `app/nav.ts`, `app/PlusGlyph.tsx`, `app/WorkspaceNav.tsx`, `app/barGeometry.ts`.
- [x] 2.3 Delete the `components/*` files with no remaining importers (re-verified per file; `RouteError` stays), and their V1-only tests.
- [x] 2.4 Grep `packages/` to confirm nothing imports a deleted module.

## 3. One stylesheet

- [x] 3.1 Merge `v2/v2.css`'s token values into `index.css` as the only defaults for dark and light; drop the `.v2-root` token scope.
- [x] 3.2 Move the V2 component classes (`.v2-tag`, `.v2-card`, `.v2-row`, `.v2-button`, `.v2-input`, `.v2-form-row`, `.v2-table`, `.v2-anim-*`, `.v2-jump-highlight`, `--v2-*` motion tokens) into `index.css` and delete `v2/v2.css`.
- [x] 3.3 Update `daemon.ts`'s `dirs()`/`cachedV2ThemeCss` and `generateV2PluginCss` to read one stylesheet; keep the fallback.
- [x] 3.4 `GET /api/w/:ws/plugins/theme.css` still generates from the merged stylesheet (test).

## 4. Specs and docs

- [x] 4.1 Retire `web-v1/ticket-page`: delete its spec file (a `## REMOVED` delta is refused by the archive gate).
- [x] 4.2 Fix the stale "no V2 counterpart" Purpose prose in `openspec/specs/plugins/web-pages/spec.md`.

## 5. Verification

- [x] 5.1 `pnpm lint`, `pnpm typecheck`, `pnpm build` clean.
- [x] 5.2 Core/server suite and UI suite green.
- [x] 5.3 Before/after captures in dark and light of Needs, Chat, Work, a ticket, Knowledge Explorer, Settings and a plugin page.
