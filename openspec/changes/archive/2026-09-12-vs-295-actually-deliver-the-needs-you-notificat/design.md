## Context

See `proposal.md` for motivation. Current state, precisely:

- `push_subscriptions` (per-workspace db, `0001_init.sql`) holds `id, session_id, endpoint,
  keys_json, created_at` — no category, no workspace filtering needed since the table itself lives
  inside each workspace's own db.
- `packages/shared/src/config.ts`'s `DaemonConfigSchema.push` is `{ vapidPublicKey?: string }` —
  daemon-level (one value for the whole process, every workspace), not workspace-level. `AppDeps.daemon`
  is exactly this Zod-parsed type, and nothing today serializes the whole thing back to a client, but
  routes do read individual fields off it (`routes/daemon.ts`) and two of them round-trip fields
  through `workspaceLoader.writeDaemonConfig(DaemonConfigSchema.parse({...}))`.
- The daemon already has one precedent for "a key the daemon owns, not a human's, generated on first
  use, living outside any YAML": `auth_enc_key`, generated into daemon.sqlite's `meta` table
  (`packages/core/src/auth/index.ts`). A closer-fidelity precedent for *this* key, though, is
  `packages/core/src/secrets/store.ts`'s `createSecretStore` — an AES-256-GCM encrypted file plus a
  `0600` key file, built for exactly "a value that must never sit in plaintext beside `db.sqlite`."
  It is currently only ever constructed with workspace-scoped paths (`ctx.paths`); nothing stops
  constructing it with daemon-scoped paths instead.
- `ChannelManager` and `WebhookDispatcher` (`packages/server/src/`) are the two existing per-workspace
  classes that subscribe to `ctx.events.on(...)` and react to `decision.created` (`ChannelManager`
  already does — `pushDecisionCard`, filtered to `decision.owner === 'human' && status === 'open'`,
  which is exactly the filter this change needs). Both are constructed in `daemon.ts`'s
  `loadWorkspaceInto` and stopped in the two shutdown paths.
- `core` may not import `server` (`scripts/guard-boundaries.mjs`), so the caller cannot live inside
  `decisions/service.ts` itself — it has to be a server-side listener on the event the service
  already emits, the same shape as `ChannelManager`.
- `packages/ui/public/sw.js`'s `push` handler already reads `data.title`/`data.body` and shows them;
  `notificationclick` already reads `e.notification.data.path` to focus-or-open. Neither needs to
  change. The only currently-dead field is that `sendPush`'s stub signature calls it `url`, not
  `path` — that name never shipped a working payload, so there is nothing to migrate.
- No `web-push`-equivalent package is installed anywhere in the repo today.

## Goals / Non-Goals

**Goals:**
- One VAPID key pair per daemon installation, generated without operator input, unreadable outside
  the daemon process, surviving upgrades.
- A real `sendPush` and a real caller wired to human-owned decision creation.
- Category preference that actually filters, decided server-side.

**Non-Goals:**
- Multiple VAPID key pairs (e.g. per-workspace signing identity) — one daemon, one push identity,
  matching the existing single `push.vapidPublicKey` config shape.
- Implementing `landed` or `everything` event sources — out of scope per the ticket; this change only
  has to make their toggle honestly say so.
- Any change to what decision kinds resolve to `owner: 'human'` — that logic in
  `decisions/service.ts`'s `defaultOwner` is untouched.
- A UI for managing multiple named devices' categories from one screen — each device manages only
  its own subscription, as today.

## Decisions

### Where the VAPID key pair lives: a second `createSecretStore`, daemon-scoped

Reuse `createSecretStore` (`packages/core/src/secrets/store.ts`) exactly as written, but construct it
with daemon-level paths — `join(configDir, 'push-vapid.enc')` / `join(configDir, 'push-vapid.key')`
— instead of a workspace's `ctx.paths`. Store `vapidPublicKey` and `vapidPrivateKey` as two names in
it. Generate both with `web-push`'s `generateVAPIDKeys()` the first time the store has neither, at
daemon startup (`startDaemon` in `daemon.ts`), before any workspace loads.

Alternatives considered:
- **`daemon.sqlite`'s `meta` table, like `auth_enc_key`.** Rejected: `auth_enc_key` is plaintext in
  the same file config already treats as non-secret-adjacent, and PLAN's own secrets doctrine (the
  comment atop `secrets/store.ts`) is explicit that a value like this does not belong in the database
  a stray backup or rsync would copy whole. The VAPID private key signs every push the daemon will
  ever send under this identity; it deserves the same encryption at rest as a role's secret does, not
  less.
- **A new bespoke encrypted-file format.** Rejected: `createSecretStore` already does exactly this
  (AES-256-GCM, explicit `chmod 0600`, corrupt-file-self-heals-on-next-write) and is exported and
  tested; inventing a second implementation is not a task, so this ticket did not need it.

The public key never goes back into `daemon.yaml` — `AppDeps.daemon.push.vapidPublicKey` is set
in-memory from the generated value at startup, so every existing reader of that field (the
`/push/config` route) needs no change. `DaemonConfigSchema.push.vapidPublicKey` stays as an unused-
by-default optional field for now; nothing currently needs an operator-supplied override, and adding
one is not part of this change.

The private key is deliberately kept **out of `DaemonConfigSchema`/`AppDeps.daemon` entirely** — it
lives on a new, separate `AppDeps.pushKeys: { publicKey: string; privateKey: string } | null` field
instead. This is the one property that actually matters for the "never in workspace.yaml, never
logged" requirement: anything that is part of `DaemonConfigSchema` is, by construction, a shape a
human could write into `daemon.yaml` and a shape some future route could `c.json(deps.daemon)` by
accident. Keeping the private key on a sibling field with no Zod schema and no serializer makes that
class of accident structurally impossible rather than a rule to remember.

### Where the caller lives: a `PushDispatcher`, one per workspace, same shape as `ChannelManager`

A new `packages/server/src/pushDispatcher.ts` exporting `PushDispatcher`, constructed as
`new PushDispatcher(ctx, services, () => currentPushKeys)` in `loadWorkspaceInto`, started/stopped
alongside `channels` and `webhooks`, added to `WorkspaceRuntime` as `push: PushDispatcher | null`.

`start()` subscribes via `ctx.events.on`; on `decision.created`, loads the decision, checks
`owner === 'human' && status === 'open'` (identical filter to `ChannelManager.pushDecisionCard`),
lists that workspace's subscriptions with `decisions` in their stored categories, and calls
`sendPush` for each with `Promise.allSettled` so one bad subscription cannot block another.

A getter (not a captured value) for the keys, because key generation happens once at daemon startup,
before any workspace is loaded, so by the time a `PushDispatcher` is constructed the keys already
exist for the lifetime of the process — a plain captured value would have worked too, but the getter
keeps the door open if key rotation is ever added later without touching this class.

Alternative considered: hooking `decisions/service.ts` directly. Rejected outright — `core` cannot
import `server`, and `sendPush`/`web-push` are server-layer concerns (network I/O, an HTTP-adjacent
dependency); this would have meant either violating the boundary or relocating the web-push
dependency into `core`, which owns no other outbound network call today.

### Payload shape and click-through target

`sendPush`'s payload becomes `{ title: string; body: string; path: string }`, sent as-is to
`showNotification`'s `data`. `title`/`body` come from the decision's `title`/`context`. `path` is
always `/w/{workspaceSlugOrId}/needs` — the existing Needs you route, which already lists every open
human-owned decision. This needs no per-decision routing logic (no ticket-identifier lookup, no
per-kind path table) and is never wrong: whatever the decision is, Needs you is where it can be acted
on.

Alternative considered: deep-linking to the specific ticket. Rejected for this change: it requires
resolving a ticket id to its human-readable identifier for the route param, adds a lookup and a
failure mode (ticket deleted, no ticket at all for a workspace-level question), and buys little over
Needs you, which already shows the exact card. Out of scope per the ticket ("the `weave://`
deep-link handler... captain deliberately held that back").

### Category storage and filtering: server-side, on the subscription row

New migration `0029_push_subscription_categories.sql` adds `categories_json TEXT NOT NULL DEFAULT
'["decisions","landed"]'` to `push_subscriptions`. `POST /push/subscriptions` accepts an optional
`categories: PushCategory[]`; omitted, it keeps the column default (matching the Settings toggle
defaults: `decisions` and `landed` on). The Settings toggle handler, on any change, re-POSTs the
existing browser subscription with the full current category set — the route is already an idempotent
upsert (`INSERT OR REPLACE` keyed on the endpoint's `UNIQUE` constraint), so this needs no second
route.

`PushCategory` (`'decisions' | 'landed' | 'everything'`) moves from the inline `NOTIFS` array literal
in `Settings.tsx` into `packages/shared/src/enums.ts`, so the client and the stored-row validation
read the same three spellings.

Chosen over sending every event to every subscription and letting the service worker drop unwanted
categories, because: (a) a push the client silently discards still cost a round trip to the push
service and still told that service (and, transitively, whoever operates it) that something
happened, which is the opposite of what an "everything else, off by default" category is for; (b)
the subscription row is already the natural place a device's identity and preference both live —
`endpoint`/`keys` are already there; (c) it directly satisfies the ticket's requirement that a
category the human turned off costs nothing, not just displays nothing.

The `landed` and `everything` rows in `Settings.tsx`'s `NOTIFS` gain a `wired: boolean` (or
equivalent) flag; their `detail` text gets a short suffix (e.g. "— not sent yet") when `false`. This
is a small, honest UI change, not a redesign: the toggle still saves its state (so turning it on
costs nothing and is forward-compatible the day a `landed` event source exists), it just stops
implying delivery that does not happen.

### The `web-push` dependency

Added to `packages/server/package.json` only (it is the one package that ever calls
`setVapidDetails`/`sendNotification`). `packages/core` gains no new external dependency — key
*generation* (`generateVAPIDKeys()`) is also part of the `web-push` package, so it is called from
`daemon.ts` (server), not from `core`.

## Risks / Trade-offs

- **[Risk]** A regenerated key pair (operator deletes the encrypted file, or it becomes unreadable)
  silently strands every existing subscription until each one's next send fails.
  → **Mitigation**: `sendPush` treats a push-service rejection that means "this key is not valid for
  this subscription" (`web-push` surfaces this as a `WebPushError` with `statusCode` 404 or 410) as a
  signal to delete that subscription row, not just log and move on — required by
  `push-notifications/vapid-keys`'s last requirement.
- **[Risk]** `web-push`'s `sendNotification` is a real network call inside a code path
  (`decisions/service.ts`'s `create()` → the emitted event → the dispatcher) that must stay fast and
  must never fail decision creation.
  → **Mitigation**: the dispatcher reacts to the emitted event asynchronously (the existing
  `ctx.events.on` callback is not awaited by `create()` — see `EventBus.emit`'s `queueMicrotask`), so
  a slow or failing push send cannot block or fail the decision write. Every send is wrapped and
  logged, never thrown past the dispatcher.
- **[Risk]** Adding a network dependency (`web-push`) to `packages/server` for what is, per-decision,
  a best-effort notification.
  → **Mitigation**: `web-push` is the standard, narrowly-scoped library for exactly this (VAPID
  signing + the push-service HTTP contract); no viable alternative avoids needing *some* such
  library, and its use is confined to `push.ts`/`pushDispatcher.ts`.
- **[Trade-off]** Storing categories server-side means the subscribe/toggle flow does one more round
  trip than a client-side-only preference would.
  → Accepted: the existing subscribe flow is already a round trip; a toggle change is a rare,
  human-initiated action, not a hot path.

## Migration Plan

1. Ship the migration (additive column, safe default) — no existing row loses data or behavior.
2. Ship key generation behind the existing `configured: false` fallback — a daemon mid-upgrade or a
   fresh install with no key pair yet behaves exactly as it does today until it generates one, which
   happens automatically on its next start.
3. No feature flag: an unconfigured daemon is already indistinguishable from "the feature does not
   exist yet" from every existing test's point of view (`push.test.ts`'s harness never triggers real
   startup key generation, so it is unaffected).
4. Rollback: reverting the change reverts to the stub `sendPush` and no caller; the migration column
   is additive and harmless to leave in place if only the code is rolled back.

## Open Questions

(none — the two questions the ticket asked to have argued, key storage location and category
filtering strategy, are both resolved above.)
