## 1. Data model

- [x] 1.1 Add migration `packages/db/src/migrations/0019_telegram_pending_users.sql` creating
  `telegram_pending_users` (id, workspace_id, external_user_id, username, display_name,
  first_seen_at, last_seen_at, attempt_count, `UNIQUE (workspace_id, external_user_id)`); verify
  `pnpm vitest run packages/db` (migrations test) passes against the new schema.

## 2. `ChannelContext.rejected` and the Telegram adapter

- [x] 2.1 Add optional `rejected?(contact: RejectedContact): Promise<void>` and a `RejectedContact`
  type (`externalUserId`, `username?`, `displayName?`) to `ChannelContext` in
  `packages/channel-sdk/src/index.ts`; verify `pnpm typecheck` is clean with the new optional field
  unused by other adapters.
- [x] 2.2 In `packages/channels/telegram/src/index.ts`'s `handleUpdate` reject branch, call
  `ctx.rejected?.({ externalUserId, username, displayName })` built from the update's `TgUser`
  (reuse `userLabel`'s username/name derivation from `updates.ts` rather than duplicating it) instead
  of only logging; verify with a new `adapter.test.ts` case asserting `rejected` is called with the
  sender's identity and that `inbound` is not called, for both a first-time and a repeat rejection.

## 3. `ChannelManager`: recording, capping, expiring, and live reload

- [x] 3.1 Implement `ChannelManager.onRejected(contact)` in `packages/server/src/channels.ts`:
  delete expired rows (`last_seen_at` older than 7 days) for the workspace, then upsert the contact
  keyed by `(workspace_id, external_user_id)` — update `last_seen_at`/`attempt_count`/username/
  display name if the row exists, otherwise insert only if fewer than 50 rows exist for the
  workspace; wire it into the `rejected` callback passed to `adapter.start()` in `startOne`; verify
  with unit tests covering: first attempt inserts, repeat attempt updates without a second row, the
  51st distinct id is dropped while the existing 50 are untouched, and a row past 7 days is gone on
  the next write.
- [x] 3.2 Add `pendingTelegramUsers(): PendingUser[]` and `approveTelegramUser(externalUserId):
  { allowedUserIds: number[] }` to `ChannelManager`: the latter adds the numeric id to
  `ctx.config.channels.telegram.allowedUserIds` via `ctx.saveConfig`, deletes the pending row, and
  calls `restartChannel('telegram')`; verify with a unit test that approving makes a subsequent
  message from that id pass the running adapter's allowlist check.
- [x] 3.3 Add `workspace.updated` handling to `ChannelManager.onEvent`: for every kind in
  `configuredKinds()`, compare `effectiveConfig(kind)` against a snapshot captured the last time
  that kind was (re)started, and `restartChannel(kind)` only for kinds whose effective config
  changed, updating the snapshot after; verify with a unit test that editing `allowedUserIds` through
  a config patch (not the token routes) restarts only the telegram channel, and that patching an
  unrelated config key restarts nothing.

## 4. API routes

- [x] 4.1 Add `GET /channels/telegram/pending` returning the pending list (id, username, display
  name, first/last seen, attempt count — never message text) to
  `packages/server/src/routes/channels.ts`; verify with a route test.
- [x] 4.2 Add `POST /channels/telegram/pending/:externalUserId/approve` calling
  `approveTelegramUser` and returning the updated allowlist; verify with a route test that a second
  approve of the same id is a no-op rather than a duplicate allowlist entry.
- [x] 4.3 Add `POST /channels/telegram/allow-all/disable` that patches `channels.telegram.allowAll`
  to `false` (no route to set it `true`); verify with a route test.
- [x] 4.4 Document all three routes in `docs/API.md` next to the existing `/channels/telegram/token`
  entries.

## 5. Settings UI

- [x] 5.1 Remove the "Enabled" `Field`/`select` from `ChannelsSection` in
  `packages/ui/src/routes/Settings.tsx`; verify no remaining reference to `telegram.enabled`
  anywhere in `packages/ui/src`.
- [x] 5.2 Add API types (`TelegramPendingUser`, list/approve response shapes) to
  `packages/ui/src/api/types.ts`, query keys to `packages/ui/src/api/keys.ts`, and hooks
  (`useTelegramPending`, `useApproveTelegramUser`, `useDisableTelegramAllowAll`) to
  `packages/ui/src/api/hooks.ts`, following the existing `useTelegramTokenStatus`/
  `useSetTelegramToken` pattern (invalidate the pending query and the token/allowlist-bearing
  summary query on success).
- [x] 5.3 Render the pending-identities list in `ChannelsSection` — id, username, display name,
  first/last attempt, attempt count, and an Approve button whose label or adjacent copy states the
  approved person will be able to direct work in this workspace; verify with a component test using
  a mocked pending response.
- [x] 5.4 When `allowAll` is true, replace the plain badge with the badge plus a "Turn off open
  access" action that calls the disable endpoint; verify with a component test that the action is
  absent when `allowAll` is false and present (and functional) when true.
- [x] 5.5 Update the Allowlist field's hint text to state plainly that an empty allowlist is the
  safe, intended state (nobody admitted) rather than framing it as optional.

## 6. Docs and specs

- [x] 6.1 Update `docs/PLAN.md` §14.1 (`ChannelContext` shape) and §14.2 ("Unknown senders are
  ignored... never auto-onboard") to describe the `rejected` callback and the approve-from-Settings
  flow.
- [x] 6.2 Run `openspec validate vs-135-telegram-is-on-when-it-has-a-token-and-a --json --strict` and
  fix anything it reports.

## 7. Verification

- [x] 7.1 `pnpm typecheck && pnpm lint && pnpm test` green.
- [x] 7.2 Confirm in the PR description that the Enabled toggle's removal changes no behaviour
  (nothing read it), and state the exact first-time setup flow (paste token → message the bot →
  approve from Settings) with what captain sees at each step, per the ticket's Verification section.
