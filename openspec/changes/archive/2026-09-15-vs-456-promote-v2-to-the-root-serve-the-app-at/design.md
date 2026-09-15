# Design — promoting the app to the root

## Context

See `proposal.md` for why. The state this design works against:

- `packages/ui/src/router.tsx` mounts two trees under `rootRoute`: V1's (`/`, `/login`,
  `/onboarding`, the global routes, and `/w/$ws/*`) and V2's, rooted at `/v2` with a pathless shell
  and a `/w/$ws/*` subtree. `v2RootRoute`'s children are already relative, so their full paths are
  just `v2RootRoute.path` + child path.
- `app/link.tsx`'s `A` and `useGo` are pass-through: they forward `to` to TanStack unchanged. The
  `/v2` prefix lives in ~120 string literals across 36 V2 source files (and ~270 in its tests), not
  in one place. The VS-448 scout's claim — echoed by the ticket — that `link.tsx` is "the single
  place that adds the prefix" does not match the code.
- `packages/server/src/static.ts` serves the built UI with an SPA fallback: any non-`assets/` path
  that is not a file returns `index.html`. `app.ts` registers `/api/*` and `/mcp/*` handlers and
  their 404 before `staticRoutes`, so `/api` is unaffected by any UI path.
- The four non-UI link builders (`pushDispatcher.ts`, `tools.ts`, `cli/commands/ticket.ts`,
  `tui/apps/Attach.tsx`) already emit `/w/...` paths.

## Goals / Non-Goals

- **Goal:** one frontend, at `/`, whose in-app navigation and generated links carry no `/v2`, with
  every retired address resolving to its replacement.
- **Goal:** the change is verifiable by the existing UI test suite plus a grep gate and rendered
  evidence.
- **Non-goal:** deleting V1 code (follow-up ticket), merging `index.css`/`v2.css`, un-nesting `v2/`,
  or any visual change.
- **Non-goal:** rewriting the incidental `/v2/...` path examples inside the other per-screen
  capability specs; the spec-cleanup follow-up rewrites them when "V2" stops naming a separate
  frontend. The acceptance grep is scoped to `packages/`.

## Decisions

### 1. Redirects are client-side router routes, not server 301s

Retired addresses are handled by redirect routes in `router.tsx`. A single `/v2` wildcard route
strips the prefix and forwards the remainder plus search; explicit routes cover the V1-only shapes
(`/w/$ws/board`, `/w/$ws/merge-queue`, `/w/$ws/live`, `/w/$ws/runs`, `/w/$ws/runs/$runId`,
`/w/$ws/settings`), each deriving its target from its own params/search. `/w/$ws/team` needs no new
route: VS-455 already made it a V2 redirect to `/w/$ws/roles`.

*Why not a server-side 301 map in `static.ts`:* it would duplicate routing knowledge in the server,
need its own table for query translation, and sit in front of a handler whose job is just to serve
assets and the shell. The SPA loads for any non-asset path already, so a typed address or a hard
reload reaches the redirect routes with no server work, and `/api` stays untouched by construction.
A client redirect also keeps the final address and history behaviour in one place (`replace`), so
Back does not bounce through the retired address.

*Consequence:* the redirect only runs once the SPA bundle has loaded. That is invisible in normal
use (the shell paints immediately) and is how the app already behaves for any deep link.

### 2. The V1 tree is unmounted, not shadowed

`router.tsx` stops adding the V1 routes to `routeTree`; the V1 route/shell modules stay on disk for
the follow-up deletion ticket. The ticket's "registered but unreachable" is read as "present in the
tree on disk, mounted by nothing".

*Why not mount V1 and rely on V2 winning the duplicate paths:* TanStack resolves a duplicate full
path to the route registered first (`parseSegments` only sets a node's route when it is empty), so
"V2 wins" is true only by registration order and is not a contract the code states. It would also
let V1-only paths (`/board`, `/merge-queue`, a workspace `/live`, `/runs`, `/settings`) render V1
screens unless each was pre-empted by a redirect route registered earlier still — fragile, and it
violates "must not answer any URL". Unmounting makes the property explicit and testable.

*Consequence:* the V1 imports and `createRoute` calls move out of `router.tsx` (the file's
`noUnusedLocals` forbids leaving them dangling), so the follow-up ticket deletes the orphaned
`routes/**` and app-shell modules rather than a router block. Nothing else imports them except their
own tests, which render components directly (no test builds a router from the real tree).

### 3. Rewrite the `/v2/...` literals per call site

Every `to`/`href`/route-`path` string that denotes a browser address loses the `/v2` prefix, in both
source and tests. The parse helpers that recognise the prefix (`v2/nav.ts`'s `workspaceFromV2Path`
and `activeNavKey`, `v2/auth.ts`'s `next` validation, `api/client.ts`'s sign-in bounce, `app/host.tsx`'s
`V2_HOST_ROUTES`) are rewritten to the root shape. The V1 "V2 preview" control is deleted from
`AppShell`/`MoreSheet` with its two assertions.

*Why not introduce a prefix constant first:* it would be a second refactor on top of this one, and
the prefix is only ever empty after this change. The literals are the honest shape of the app once
there is one frontend.

### 4. Non-UI link builders are verified, not rewritten

`pushDispatcher.ts`, `tools.ts`, `cli/commands/ticket.ts` and `tui/apps/Attach.tsx` already emit the
final `/w/...` paths, so no code changes. Their tests already assert those paths; this ticket keeps
them and adds an assertion that the path carries no `/v2` segment, so a future regression fails. The
one stale comment naming `/v2/runs/$runId` is corrected.

### 5. Static serving is unchanged and confirmed by a test

`static.ts` already answers the shell for `/`, every new root path and every retired path, and
`/api/*` is matched earlier. A server test asserts `index.html` is served for `/`, a root page path
and a retired path, and that a missing `/api/...` route still 404s rather than falling back to the
shell.

## Risks / Trade-offs

- **A missed `/v2/` literal breaks navigation at runtime** (TanStack rejects a `to` that matches no
  route) and is invisible to typecheck because `A`/`useGo` loosen the generics. → The grep gate plus
  the full UI suite; the suite mounts the screens, so a broken `to` surfaces as a thrown route error.
- **A test or screen hard-codes an address in a way the grep misses** (e.g. built by concatenation).
  → The rendered-evidence pass walks Needs, Chat and a ticket in a real browser and records the
  final URL list.
- **Unmounting V1 breaks a V1 test that navigated through the real router.** → No UI test builds a
  router from the real tree; the full suite is the check.
- **The sign-in return target.** `v2/auth.ts` validates `next` as a `/v2` path and `api/client.ts`
  bounces to `/v2/login`; both must move to root or an unauthenticated deep link loses its return
  target. → Covered by the auth/session tests and a rendered deep-link check.
- **Service worker / PWA.** `sw.js` is path-agnostic and `manifest.webmanifest`'s `start_url`/`scope`
  are `/`; verified in the rendered pass.

## Migration Plan

No data or server migration. The change is a new UI build; the daemon starts serving it after the
merge and captain's `weave daemon upgrade`. Retired addresses keep working through the client
redirect, so bookmarks, push deep links and chat links survive. Rollback is redeploying the previous
release (its shell still lives at `/v2`); the redirect layer only exists in the new build.

## Open Questions

None. The incidental spec path text is a stated non-goal, not a deferred decision.
