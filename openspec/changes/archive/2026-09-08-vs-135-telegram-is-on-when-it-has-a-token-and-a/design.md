## Context

`packages/channels/telegram/src/index.ts`'s `handleUpdate` already computes the allow/reject
decision per message (`allowed`/`openToAll`, PLAN §14.2) and already stops a rejected message before
it reaches `ctx.inbound(...)` — it currently only logs the rejection once per user id, in an
in-memory `Set` that resets on restart. `ChannelContext` (`packages/channel-sdk`) is the only thing
the adapter can call back into; it does not currently offer a way to persist anything.

`packages/server/src/channels.ts`'s `ChannelManager` owns the workspace database and is what builds
the `ChannelContext` passed to `adapter.start()` (`startOne`), and already has a live-reload
primitive, `restartChannel(kind)`, used today only by the token save/clear routes
(`packages/server/src/routes/channels.ts`). It subscribes to workspace events (`onEvent`) but does
not currently react to `workspace.updated` — an allowlist edit through the generic
`PATCH /config` route changes `ctx.config` (which the running adapter's closure over `cfg` does not
see) but never calls `restartChannel`, so the running channel keeps enforcing the allowlist it
started with until something else restarts it.

## Goals / Non-Goals

**Goals:**
- Turn a rejected Telegram message into a durable, boundable, identity-only record captain can act
  on from Settings.
- Make an allowlist change — however it was made — take effect on the running channel immediately.
- Remove the dead Enabled control and make the grandfathered `allowAll` state actionable.

**Non-Goals:**
- Any channel other than Telegram (out of scope per the ticket).
- Notifying captain that someone is pending (out of scope per the ticket; the Settings list is the
  interface for now).
- A general plugin-facing "pending access" abstraction. `rejected` is added to `ChannelContext` for
  every adapter to use if it wants to, but only Telegram implements it in this change.

## Decisions

### `ChannelContext.rejected` is a new optional callback, not a return value

`handleUpdate`'s reject branch already has everything needed (user id, username, display name) and
already never touches `ctx.inbound`. Adding `rejected?(contact: RejectedContact): Promise<void>` to
`ChannelContext` alongside `inbound` lets the adapter report the identity through the same
call-into-the-manager shape `inbound` already uses, instead of plumbing a new return type through
`start()`'s event loop. It is optional (mirrors the optional-adapter-method pattern already used
elsewhere in the codebase) because a channel that has no allowlist concept has nothing to report.

Alternative considered: have `ChannelManager` itself own the allow/reject decision instead of the
adapter, so it always knows about a rejection without a new callback. Rejected — VS-125's allowlist
check is Telegram-specific (`allowedUserIds` is a Telegram config field, not a `ChannelAdapter`
concept), and moving it into the manager would mean every future channel with different identity
semantics (e.g. a channel with no per-message sender at all) has to fit the same shape. Keeping the
decision in the adapter and only reporting the *outcome* upward is the smaller change.

### Pending identities are stored in one new table, keyed by `(workspace_id, channel_kind, external_user_id)`

```sql
CREATE TABLE telegram_pending_users (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  external_user_id TEXT NOT NULL,
  username TEXT,
  display_name TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 1,
  UNIQUE (workspace_id, external_user_id)
);
```

Telegram-specific (not a generic `channel_pending_users` keyed also by `channel_kind`) because only
Telegram has this concept in this change, matching how `TELEGRAM_BOT_TOKEN_SECRET_NAME` and
`bot_username` are already Telegram-specific rather than generalised ahead of a second channel
needing the same shape. `ChannelManager.onRejected` is the only writer.

### Cap and expiry: 50 entries, 7 days, enforced at write time

- **Cap — 50 per workspace.** Chosen as comfortably above any plausible number of real people
  waiting for review, and small enough that a flood of distinct fake senders costs at most 50 rows.
  Once at the cap, a message from a *new* external user id is dropped without a write (existing
  entries still update normally) — never evicting an existing entry to make room, so a flood cannot
  push a genuine pending person out to admit noise.
- **Expiry — 7 days since `last_seen_at`.** Long enough that captain checking Settings weekly still
  sees who is waiting; short enough that a leaked bot handle does not accumulate pending rows
  forever. Enforced by deleting expired rows opportunistically on every write (`onRejected`) rather
  than a separate scheduled sweep — the table is only ever written to when a message arrives, so
  there is no scenario where expired rows would otherwise never get cleaned up on an active channel,
  and a channel with no traffic has no expiry pressure to relieve.

### `workspace.updated` reactivity: restart a channel only when its own effective config changed

`ChannelManager.onEvent` gains a `workspace.updated` branch. It compares the *effective* config
(`effectiveConfig(kind)`, already used by `startOne`) for every currently configured channel kind
against a snapshot taken the last time that channel was (re)started, and calls `restartChannel(kind)`
only for kinds whose effective config actually differs — not on every `workspace.updated` event
(which fires for unrelated settings too, e.g. model selection) and not for channel kinds untouched
by the patch. This makes the approve action, a manual allowlist edit, and turning off `allowAll` all
converge on the same mechanism the token routes already use, rather than three different call sites
each remembering to call `restartChannel` themselves.

Alternative considered: have the approve/allow-all-off routes call `restartChannel('telegram')`
directly, the way the token routes do, and leave the general `workspace.updated` gap alone. Rejected
because the plain Allowlist text field in Settings — unchanged by this ticket — goes through the
generic `PATCH /config` route with no dedicated server-side handler, and the spec now promises "an
allowlist change takes effect... without a daemon restart" regardless of which of the three paths
made it. Fixing it once in `ChannelManager` covers all three; fixing it three times invites a fourth
site missing it later.

### Approve is one endpoint, not a client-orchestrated read-modify-write

`POST /channels/telegram/pending/:externalUserId/approve` reads the current `allowedUserIds`,
appends the id if absent, writes it through the same `saveConfig` path `PATCH /config` uses, deletes
the pending row, and returns the updated allowlist — all server-side, single request. Mirrors
`POST /channels/telegram/token`'s shape (validate → persist → restart → respond) rather than asking
the UI to `PATCH /config` and then separately delete the pending row, which would leave a window
where a second approve of the same id (double-click) or a concurrent edit could race.

### `allowAll` gets a turn-off action, not a turn-on control or removal

The field and its enforcement in the adapter (`openToAll = cfg.allowAll && allowed.size === 0`) are
unchanged — a grandfathered workspace must keep working. What changes is Settings: the existing
"Open to any Telegram user" badge (`allowlistRuleLabel`) gets an adjacent action that `PATCH`es
`allowAll: false`. There is deliberately no UI path that sets `allowAll: true` — the config field
still accepts it (workspace.yaml is hand-editable), but the interface only ever offers to turn it
off, since VS-125 already established that a *new* workspace should never start open.

## Risks / Trade-offs

- **A single-workspace-instance assumption in the config-diff snapshot.** `ChannelManager` is
  per-workspace already (one instance per `WorkspaceContext`), so the snapshot is naturally scoped;
  no cross-workspace risk.
- **Restarting Telegram's long poll on every relevant config edit** briefly drops in-flight
  `getUpdates` calls. Already true today for the token routes; extending it to allowlist edits is
  the same accepted trade-off, not a new one, and Telegram's `offset`-based polling means no update
  is lost, only delayed by one restart.
- **A pending row surviving until its 7-day expiry after being approved out from under it never
  happens** — approval deletes the row explicitly, so expiry only ever cleans up genuinely
  unapproved, stale identities.

## Migration Plan

One additive migration (`telegram_pending_users`, new table) and one additive `ChannelContext`
field (optional, so existing adapters and their tests are unaffected). No existing data changes
shape. Rollback is deleting the table and the routes; nothing downstream depends on either yet.
