## Context

V2 is the parallel frontend at `/v2` built by VS-343: a lazy-loaded subtree in `packages/ui` with
Mono tokens (`v2/v2.css`), a `V2Root` that owns the token element and theme, a `V2Shell` that renders
the rail and phone tab bar, a pure `v2/nav.ts` registry, and a `V2Page` header primitive. Its route
subtree lives in `packages/ui/src/router.tsx` under a single `/v2` route whose component is
`V2Root` (tokens **and** shell).

V1 already implements both things this ticket restyles. `routes/Login.tsx` runs the daemon's whole
sign-in flow against `/api/auth/*`: first-run `set-password`, password, the TOTP second step, a
remembered device name, lockout countdown and expired-session errors, and a post-login landing. The
API client (`api/client.ts`) stores the bearer token and the remembered workspace, and turns a 401
into `window.location.assign('/login?next=…')`. `routes/Onboarding.tsx` runs `weave init` through
`useInitWorkspace`, sets the models with `PUT /models`, adds projects with `POST /projects` (a
job-backed clone shown with `JobProgress` and re-attached after a reload), and configures
`weaver.humanName` with `PATCH /config`.

Today `/v2` has neither screen: the index redirect goes to V1's `/onboarding` (VS-343), and a 401
goes to V1's `/login`. The design reference is committed at `docs/design/v2/`; `Screens.dc.html`
carries the login and onboarding markup, `shots/{desktop,phone}-{dark,light}/17-login.png` and
`16-onboarding.png` are the four-mode captures, and `HANDOFF.md` §1–§3 and §15 are the cross-cutting
rules.

## Goals / Non-Goals

**Goals**

- A chromeless V2 sign-in at `/v2/login` that reuses the daemon's existing authentication and shows
  the password step, the TOTP step, the remembered device, the first-run set-password step and the
  existing error/lockout states, restyled to Mono in both themes and at phone width.
- Any unauthenticated `/v2` address lands on V2 login and returns there after sign-in.
- A conversational, five-step V2 onboarding at `/v2/onboarding` that drives V1's workspace creation,
  model selection and project add, including the autonomy question mapped to existing settings, and
  lands in V2.
- `/v2` with no remembered workspace resolves to V2 onboarding, not V1's.
- V1 at `/` is unchanged, and V2's code and styles stay scoped.

**Non-Goals**

- Any change to authentication or workspace-setup behaviour on the daemon: no new route, field,
  migration or config key.
- Any change to V1's login or onboarding screens, addresses or `?next=` handling.
- The content of any other V2 screen, and promoting V2 to `/`.

## Decisions

**The V2 root is split into a token root and a shell layout.** `V2Root` will own only the `.v2-root`
token element, `data-theme` and `<Outlet/>`. A pathless layout route under it renders `V2Shell` and
wraps the existing destinations; all current addresses are unchanged because a pathless route does
not add a URL segment. This is what makes login chromeless: `/v2/login` is a child of the token root,
not of the shell, so it renders the Mono tokens and theme without a rail or header. Onboarding is a
child of the shell, so it keeps the mockup's chrome (rail on desktop, tab bar on phone), matching
`16-onboarding`.

**Login is V1's auth with V2's presentation.** The V2 page calls the same `api.root('/auth/setup' |
'/auth/login')` and reads the same `/health` and `/me`; it does not fork `LoginRoute`. It reuses
`TOTPInput`, `Button` and `WeaveMark`, and the same lockout/expiry typing, so behaviour cannot drift
from V1. Chromeless means no V2 shell, not no V2 styling: the token root still paints it.

**The unauthenticated redirect is made V2-aware at the client edge.** `api/client.ts`'s 401 handler
currently always sends the browser to `/login`. It will instead send a request whose current path is
under `/v2` to `/v2/login?next=<path>` and leave every other path on V1's `/login`. This is one
branch in one function, decided by the path the browser is on, so V1's behaviour is byte-for-byte
unchanged. The V2 login reads the `next` value and honours it only when it is a `/v2` path, so the
parameter cannot be used as an open redirect; with no `next`, sign-in resolves `/v2` the way opening
`/v2` does.

**A client-side guard covers the direct load.** A `beforeLoad` on the V2 subtree checks the same
session state the routes need (the `/me` query, reusing the client's existing token/cookie) and
redirects an anonymous visitor to `/v2/login?next=<current>` before the page fetches. The 401 branch
is the backstop for a session that expires after load. Together they make "an unauthenticated visit
to any `/v2` address shows V2 login" hold without a daemon change.

**"Anonymous" means refused, not "the body has no session".** `packages/server/src/auth.ts` gives a
request a `loopback` principal when `auth.loopbackTrusted` is set and the caller is local, and for
that request `GET /api/me` answers 200 with `session: null` and `operator.id: null`. The guard
therefore treats a visitor as signed in unless the daemon is actually available and the request was
**refused** as unauthenticated (a 401, or `auth_session_expired`); a 200 `/me` with a null session
never triggers the redirect. Otherwise a trusted local browser would loop to `/v2/login` forever. A
test asserts exactly that case.

**Onboarding is a conversation, one question per weaver message.** Each step is a weaver message, the
human's answer renders as their own bubble, and steps with a small answer set offer chips. The
progress indicator is `N / 5`. The five steps and their backing are:

| Step | Ask | Backing (existing) |
|---|---|---|
| 1 | Business / workspace name | `useInitWorkspace` (`weave init`) |
| 2 | Id, ticket prefix, directory | same call |
| 3 | Projects, then the autonomy question | `POST /projects` (job-backed); `PATCH /config` |
| 4 | Default CLI and model | `PUT /models` |
| 5 | Review and create | runs the create |

The design brief's "how you like to be briefed" has no setting behind it, so it is not a step that
persists anything; any of it that survives lives as conversational copy inside step 1.

**The autonomy chips map to settings that already exist and are written only on success.** The three
answers the mockup draws map as decided: "Ask me before any plan" → `defaults.proposalApproval:
human`; "Only merges and actions" → `defaults.proposalApproval: weaver`; "Let the weaver decide" →
`defaults.yolo: true`. No chip is pre-selected, because `yolo` grants plan **and** merge approvals
automatically and that must be an explicit choice; a line under the chips says what each does and
that action approvals always stay with the human. The write happens through the same
`PATCH /config` that Settings already uses, and only after the workspace exists — a failed create
writes nothing. All three answers leave action approvals with the human (`yolo` grants only
`plan_approval` and `merge_approval` in `AUTO_APPROVED_KINDS`).

**Onboarding reuses V1's create machinery, including its job handling.** The flow calls the same
`useInitWorkspace`, `PUT /models`, `POST /projects` and `PATCH /config`, and reuses the job stream,
`JobProgress`, failed-step retry and the `ac.onboarding.resume` re-attach, rather than
re-implementing clone progress. Only the presentation is conversational; the operation and its
results are identical to V1's.

**`/v2` resolution changes in one place.** The VS-343 index route currently throws to `/onboarding`;
it becomes: remembered workspace → `/v2/w/<ws>/needs`; none remembered → `/v2/onboarding` (the guard
sends an anonymous visitor to `/v2/login` first); a remembered workspace the daemon no longer reports
is forgotten. V1's `/` route and redirect are not touched.

**Theme and width reuse the shell's primitives.** Both screens read `useV2Theme`, use the Mono tokens
in `v2.css`, the bordered tag recipe and 4–6px corners, and are built fluid so the phone capture
matches at phone width. No harness switch is built.

## Risks / Trade-offs

- **Splitting `V2Root` re-parents every existing V2 destination.** → The shell becomes a pathless
  layout route, so no address changes; the existing `v2router.test.ts` route-table assertions are the
  regression check.
- **A `beforeLoad` guard could fight the 401 branch and loop.** → The guard never fires on
  `/v2/login`, and it redirects to that address; the client branch treats `/v2/login` as terminal,
  mirroring the existing `/login` check.
- **Returning only `/v2` paths could strand a V1 `next`.** → V1 addresses never reach the V2 login;
  V2 addresses always resolve within V2, which is the requirement.
- **The mockup's login captures show the shell around the screen.** → The design says login has no
  chrome; the rail in the capture is harness scaffolding, exactly as `HANDOFF.md` §2 says the harness
  theme switch is. Login ships chromeless.
- **An autonomy answer written at onboarding is new onboarding copy.** → It writes existing fields
  through an existing endpoint, one time, and is editable in Settings; the decision to include it was
  confirmed on the ticket.

## Migration Plan

No migration and no data change. V2 is additive: a UI release makes `/v2/login`, `/v2/onboarding` and
the V2 resolution live and leaves `/` alone. Rolling back the UI release removes them. No daemon,
HTTP, MCP, CLI or database change is involved.
