## Why

The Telegram "Enabled" toggle in Settings does nothing — the channel is already on exactly when a
token resolves — so it should go rather than be wired to a field that does not exist. And VS-125
made the allowlist actually enforced, but populating it requires knowing your own numeric Telegram
user id, which nobody does; that friction is exactly what leaves bots either unreachable or
grandfathered wide open. Captain asked for a flow with no numbers: paste a token, message the bot,
see yourself waiting in Settings, press allow.

## What Changes

- Remove the dead "Enabled" select from the Telegram Settings section. Nothing reads it today
  (`TelegramConfigSchema` has no `enabled` field); removing it changes no behaviour.
- Telegram records every message from a sender not on the allowlist as a **pending identity**
  (Telegram user id, username, display name, first/last attempt time, attempt count) — never the
  message text, which is attacker-controlled until someone is approved. The list is capped (50
  entries per workspace) and expires (7 days since last attempt) so a leaked bot handle cannot be
  used to flood the workspace database.
- Settings lists pending identities and lets captain approve one with a single action: it is added
  to the allowlist and the Telegram channel is restarted so their next message goes through — no
  user id typed anywhere by a human. The consequence is stated at the point of the action: an
  approved person can direct work in this workspace through the conductor.
- A workspace grandfathered onto `allowAll` by VS-125 keeps working, but Settings now shows it as an
  explicit, actionable legacy state — not just a badge — with a one-click way to turn it off in
  favour of the new approve-by-identity flow. `allowAll` cannot be turned on from the interface;
  only a pre-existing grandfathered workspace can have it set.
- Editing the allowlist (removing an id, or via the approve action) now actually restarts the
  running Telegram channel, so revoking access takes effect without a daemon restart — closing a
  gap where `ChannelManager` never reacted to `workspace.updated` and a stale in-memory allowlist
  kept a removed id working until the process restarted.
- Nothing from an unapproved sender is stored as a thread message, reaches the conductor, or
  triggers a run; recording a pending attempt is explicitly not delivering a message.

## Capabilities

### New Capabilities

- `telegram-channel/pending-access`: recording an unrecognised sender's identity (never their
  message text), capping and expiring that list, approving one from Settings into the allowlist,
  and the guarantee that nothing from them reaches the conductor until approved.

### Modified Capabilities

- `telegram-channel/allowlist`: an `allowAll`-grandfathered workspace gets an explicit way to turn
  that off from the interface, not just a status badge; and an allowlist edit (including an
  approval) takes effect on the running channel without a daemon restart.
- `telegram-channel/bot-token`: states plainly that the channel is on exactly when a token resolves
  and that the interface exposes no separate enabled/disabled control.

## Impact

- `packages/channel-sdk`: `ChannelContext` gains an optional `rejected(contact)` callback so an
  adapter can report an unrecognised sender's identity without ever handing back message text.
- `packages/channels/telegram`: calls `ctx.rejected(...)` from the existing allowlist-rejection
  branch in `handleUpdate` instead of only logging.
- `packages/db`: new migration adding a `telegram_pending_users` table (capped, expiring) scoped to
  `workspace_id`.
- `packages/server`: `ChannelManager` implements `rejected`, prunes/caps the pending table, reacts to
  `workspace.updated` by restarting a channel whose effective config changed, and gains
  `GET/DELETE /channels/telegram/pending` + `POST /channels/telegram/pending/:externalUserId/approve`
  routes.
- `packages/ui`: `Settings.tsx`'s Telegram section drops the Enabled field, adds a pending-identities
  list with an Approve action, and makes the `allowAll` legacy state actionable.
- `docs/PLAN.md` §14.1/§14.2 and `docs/API.md`: updated for the new `ChannelContext.rejected` hook
  and the new routes.
