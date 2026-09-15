# Promote V2 to the root and retire the `/v2` prefix

Tracker change for [VS-456](weave://tickets/VS-456). Plan and file inventory: the VS-448 scout
report, sections 3, 4 and 6. Blocked-by VS-455 has landed (Live `?ws=`, V2 `/team` alias), so the
redirect table's targets exist.

## Why

Captain moved to V2 and wants V1 removed (2026-09-14), in two PRs: this one flips the routing and
redirects the old addresses; a follow-up deletes the V1 code. Today the app is served at `/v2` and
V1 owns `/`. Until the prefix is dropped, every bookmarked, pushed or printed link still carries a
`v2` vanity segment, and the old V1 URLs and the interim `/v2` URLs have no single address that
still resolves after the flip. VS-448 §4 recommended dropping the prefix (captain accepted), so this
ticket writes every generated link and every redirect once, against the final shape.

## What Changes

- **Serve the app at `/`.** `v2RootRoute` moves from `/v2` to `/`; its children keep their relative
  paths, so the app's addresses become `/needs`, `/live`, `/w/:ws/work`, and so on. `/` still
  resolves the remembered workspace to that workspace's Needs you, else onboarding/sign-in.
- **The V1 route tree answers no URL.** It is removed from the router's mounted tree (the V1 route
  and shell modules stay on disk for the follow-up deletion ticket). Old V1-only addresses are
  handled by an explicit redirect layer instead.
- **Redirect the retired addresses** (every row, query params kept):
  `/v2/*` → the same path without the prefix; `/w/:ws/board` → `/w/:ws/work`;
  `/w/:ws/merge-queue?project=X` → `/w/:ws/work?project=X`; `/w/:ws/team` → `/w/:ws/roles` (already
  a V2 route); `/w/:ws/live` → `/live?ws=:ws`; `/w/:ws/runs` → `/runs?ws=:ws`;
  `/w/:ws/runs/:runId` → `/runs/:runId`; `/w/:ws/settings` → `/settings?scope=:ws`. Every other
  retired address already has the target's shape and loads directly. Each row gets a test.
- **Rewrite every generated browser path from `/v2/...` to root.** The route files, nav model,
  auth/session redirects and the shared-component host map carry ~120 hard-coded `/v2/...` path
  literals across 36 source files, plus ~270 in the UI tests. **The ticket and VS-448 §3 describe
  `app/link.tsx` as "the single place that adds the prefix"; that is not true of the current code —
  `A`/`useGo` pass `to` straight through and every call site spells the prefix itself.** The rewrite
  is mechanical across those files, not a one-line prefix change; the change's own acceptance
  criterion ("no `/v2/` browser path outside the redirect code") already requires the sweep, so no
  scope changes — only the mechanism in the ticket text is wrong. The V1 "V2 preview" control and
  its two test assertions are removed with it (there is no second app to preview).
- **Non-UI link builders need no path change.** `pushDispatcher.ts`, `tools.ts` (`weave_artifact_put`),
  `cli/commands/ticket.ts` (`ticketUrl`) and `tui/apps/Attach.tsx` already emit `/w/...` root paths
  (VS-448 §3's "rewrite to" column equals their current value). Their tests already assert the root
  path; this ticket verifies them against the promoted router and sharpens the assertions to fail on
  a `/v2` prefix. One stale comment (`routes/daemon.ts:155`) is corrected.
- **Docs.** `docs/PLUGINS.md`, `docs/PLAN.md` (two places), `docs/API.md`, `README.md`,
  `docs/ui-screenshot-harness.md` — drop the `/v2` prefix and the "V1" asides.
- **Specs.** Deltas for the promoted address and the redirect layer; correct the stale
  `plugins/web-pages` Purpose prose (the V2 plugin route exists).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `web-v2/shell`: the app is served at `/` on the same daemon; the root resolves a workspace at `/`;
  V1 answers no address; the V1↔V2 toggle is retired.
- `web-v2/navigation`: an address that a previous URL scheme used redirects to the destination that
  replaced it, with its query preserved.
- `plugins/web-pages`: a plugin's page is addressed at `/w/:ws/plugins/:pluginId` (the promoted V2
  route); the interim `/v2/w/:ws/plugins/:pluginId` address is gone, and the capability's Purpose
  prose is corrected.

## Impact

- **Router** — `packages/ui/src/router.tsx`: `v2RootRoute` path, the V2 auth guard's `/v2/login`
  exemption, the V1 tree unmounted, and a legacy-redirect layer.
- **UI paths** — 36 source files carrying `/v2/...` (notably `v2/nav.ts` path parsing and
  `activeNavKey`, `v2/auth.ts` return-target validation, `api/client.ts` sign-in bounce, `app/host.tsx`
  `V2_HOST_ROUTES`, `v2/map/model.ts` hrefs, `v2/V2Shell.tsx`, and every `v2/**` screen's `to`/`href`)
  plus ~60 UI test files.
- **V1 shell** — `app/AppShell.tsx` and `app/MoreSheet.tsx` lose the "V2 preview" control;
  `app/link.tsx` is unchanged (it never added the prefix).
- **Non-UI** — `packages/server/src/routes/daemon.ts` (one comment); no code change in
  `pushDispatcher.ts`, `tools.ts`, `cli/`, `tui/`, the Telegram channel or the skills.
- **Server static serving** — no change; `static.ts` already falls back to `index.html` for every
  non-asset path and `/api/*` is matched before it. Confirmed by a test.
- **Docs** — the five listed files.
- **Out of scope** — deleting V1 route/shell files (follow-up ticket); merging `index.css` and
  `v2.css`; un-nesting `v2/`; any visual change. The incidental `/v2/...` path examples inside the
  19 per-screen capability specs are left to the V1-removal/spec-cleanup follow-up, which rewrites
  them wholesale when "V2" stops being a separate frontend; the acceptance grep is scoped to
  `packages/` for exactly that reason.
