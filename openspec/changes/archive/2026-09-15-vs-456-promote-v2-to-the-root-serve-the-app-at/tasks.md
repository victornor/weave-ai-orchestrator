# Tasks

## 1. Serve the app at the root

- [x] 1.1 In `packages/ui/src/router.tsx`, move `v2RootRoute` from `/v2` to `/`, and update the V2 auth guard's sign-in exemption and `?next=` target from `/v2/login` to `/login`.
- [x] 1.2 Make the root index resolve at `/` (`/w/<ws>/needs` with a remembered workspace, else `/onboarding`), and re-parent the shell and its children so every V2 destination keeps its relative path (global `/needs`, `/live`, `/runs`, `/settings`, …; workspace `/w/$ws/work`, …).
- [x] 1.3 Unmount the V1 route tree from `routeTree` (remove the V1 imports and `createRoute` calls from `router.tsx`; leave the `routes/**` and app-shell modules on disk for the follow-up deletion ticket) and confirm `tsc`/`noUnusedLocals` is clean.

## 2. Redirect the retired addresses

- [x] 2.1 Add the `/v2` wildcard redirect: `/v2/*` → the same path without the prefix, query preserved, queried and reloaded.
- [x] 2.2 Add the V1-only redirects, each deriving its target from its own params/search: `/w/$ws/board` → `/w/$ws/work`; `/w/$ws/merge-queue?project=X` → `/w/$ws/work?project=X`; `/w/$ws/live` → `/live?ws=$ws`; `/w/$ws/runs` → `/runs?ws=$ws`; `/w/$ws/runs/$runId` → `/runs/$runId`; `/w/$ws/settings` → `/settings?scope=$ws`. Confirm `/w/$ws/team` still resolves through VS-455's Roles alias.
- [x] 2.3 Tests: one per row of the redirect table (typed address and again as a hard load), asserting the landed address and that query values are kept; plus a case that an already-matching shape (`/w/$ws/tickets/$ticketId`) loads without a redirect and that an unknown path is not-found rather than redirected.

## 3. Rewrite every generated `/v2` path to the root

- [x] 3.1 Rewrite the path literals in `v2/**` screens and shared modules from `/v2/...` to the root (every `to`/`href`/`go` and TUI-visible title), and update the prefix-aware helpers: `v2/nav.ts` (`workspaceFromV2Path`, `activeNavKey`, `hrefFor`), `v2/auth.ts` (`next` validation and the landing path), `api/client.ts` (the sign-in bounce and its login path), `app/host.tsx` (`V2_HOST_ROUTES`), `v2/map/model.ts`.
- [x] 3.2 Remove the V1 "V2 preview" control from `app/AppShell.tsx` and `app/MoreSheet.tsx` and delete/adjust its assertions in `appshell.test.tsx` and `moreSheet.test.tsx`; correct the stale `/v2/runs/$runId` comment in `packages/server/src/routes/daemon.ts`.
- [x] 3.3 Update the ~60 UI test files' path assertions (expected `href`/`to`/landed URL) to the root addresses, including `v2router.test.ts`'s route-tree structure test.
- [x] 3.4 Grep gate: `rg "/v2/" packages` finds no browser path outside the redirect routes (file paths such as `ui/src/v2/v2.css` and the `v2/**` module names remain).

## 4. Non-UI link builders

- [x] 4.1 Verify `pushDispatcher.ts`, `tools.ts` (`weave_artifact_put`), `cli/commands/ticket.ts` and `tui/apps/Attach.tsx` emit the final root paths against the promoted router; they already do — record the check rather than editing them.
- [x] 4.2 Sharpen `packages/server/test/pushDispatcher.test.ts` and `integration.test.ts` so the asserted push/artifact path is a root `/w/...` path with no `/v2` segment.

## 5. Server static serving

- [x] 5.1 Add/extend a server test proving the SPA fallback returns `index.html` for `/`, for a new root page path and for a retired path (e.g. `/w/acme/board`), while a missing `/api/...` route still returns its `not_found` JSON and never the shell.

## 6. Docs and specs

- [x] 6.1 Update `docs/PLUGINS.md:205`, `docs/PLAN.md:830,1245`, `docs/API.md:59`, `README.md:529` and `docs/ui-screenshot-harness.md:10` for the root paths and without the V1 asides.
- [x] 6.2 Confirm the corrected `plugins/web-pages` Purpose (edited in propose) and the three spec deltas validate.

## 7. Checks and evidence

- [x] 7.1 `pnpm lint`, `pnpm typecheck`, and both suites (`pnpm test` — core/server block and UI block reported verbatim).
- [x] 7.2 Rendered evidence under `docs/reviews/vs-456/`, from a scratch daemon (never the live one) and a headless browser: dark- and light-theme captures of Needs, Chat and a ticket at the root URLs; a PWA install check at `/`; a plugin page loads themed.
- [x] 7.3 A recorded old URL → final URL list from a real browser, one line per row of the redirect table.
