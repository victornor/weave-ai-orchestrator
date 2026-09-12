## Why

The product's whole premise is "does this need me" — but today, closing the browser tab closes the
only channel that signal reaches. `push.ts` already stores subscriptions and the client is fully
built (subscribe toggle, service worker, `PushManager`), but `sendPush` is a stub with no caller:
even a working sender would never fire, because nothing ever decides "a human needs to see this."
VS-286's scout picked this over a desktop shell specifically to close that gap.

## What Changes

- The daemon generates and owns a VAPID key pair (public + private) the first time it needs one,
  stores it encrypted at rest, and never asks a human for it. It survives a `daemon upgrade`. If it
  is ever lost or regenerated, every existing subscription is invalidated rather than silently
  failing forever — the daemon detects a rejected subscription and drops it.
- `sendPush` (`packages/server/src/push.ts`) stops being a stub: given the daemon has a key pair, it
  actually delivers a web-push notification to every stored subscription that wants it, using the
  `web-push` package. With no key pair configured it still returns `{ sent: 0, skipped }` exactly as
  today — an unconfigured daemon must not error or crash.
- A new caller: the moment a decision is created with `owner: 'human'` — plan approval, merge
  approval, action approval, hire approval, a `question`/`concern` raised via `weave_ask`, or any
  other kind that resolves to the human — a per-workspace dispatcher fires a push. This is exactly
  the same open-set the Needs you page and the unread badge already use; nothing about what counts
  as "needs you" changes.
- Clicking the notification opens (or focuses) the app at the Needs you page, through the existing
  `notificationclick` handler in `packages/ui/public/sw.js` — no new client-side handling needed,
  only the `path` field of the payload it already expects.
- The three category toggles in Settings become real: a subscription now carries its own category
  selection server-side, and delivery is filtered against it before a push is ever sent. `decisions`
  is the only category with an event source today; `landed` and `everything` are stored and would
  filter correctly the day something calls `sendPush` for them, but nothing does yet, and the UI says
  so rather than implying they already work.

**BREAKING**: none — `POST /push/subscriptions`, `GET /push/config` and the stored-row shape all
gain fields with safe defaults; no existing caller's contract narrows.

## Capabilities

### New Capabilities
- `push-notifications/vapid-keys`: the daemon generates, stores, and rotates-on-loss its own VAPID
  key pair, without ever putting the private half in a YAML file, a log, or a run transcript.
- `push-notifications/decision-delivery`: the event that makes `sendPush` fire — a human-owned
  decision being created — the payload it sends, and the click-through target.
- `push-notifications/category-preferences`: subscriptions carry a server-side category selection
  that filters delivery, and the Settings toggles honestly reflect which categories are wired.

### Modified Capabilities
(none — no existing spec file covers push; the subscription storage and routes were built without one)

## Impact

- `packages/server/src/push.ts` — real `sendPush`, VAPID key material, category filtering.
- `packages/server/src/daemon.ts` — key-pair bootstrap at startup; a new per-workspace dispatcher
  started/stopped alongside `ChannelManager` and `WebhookDispatcher`.
- `packages/core/src/secrets/store.ts` — reused (not modified) for a daemon-level encrypted key file.
- `packages/db` — new migration adding `categories_json` to `push_subscriptions`.
- `packages/shared/src/push.ts`, `packages/shared/src/enums.ts` — the category enum, request/response
  shape additions.
- `packages/ui/src/lib/push.ts`, `packages/ui/src/routes/Settings.tsx` — send categories on
  subscribe/toggle; mark unwired categories honestly.
- `packages/server/package.json` — new dependency on `web-push`.
- `docs/API.md` — the push section's request/response shapes and delivery status.
