## 1. VAPID key material

- [x] 1.1 Add `web-push` as a dependency of `packages/server` (and its types); verify `pnpm install` resolves it and `pnpm -F @weave-ai/server build` still compiles.
- [x] 1.2 Add a daemon-scoped key-pair helper (e.g. `packages/server/src/vapid.ts`) that constructs `createSecretStore` (from `@weave-ai/core`) with paths under the daemon's `configDir` (`push-vapid.enc` / `push-vapid.key`), returns the stored pair if both names exist, and otherwise generates one with `web-push`'s `generateVAPIDKeys()` and stores it; verify a unit test that starting twice against the same directory returns the identical pair, and starting against an empty directory produces a pair whose keys round-trip through `web-push`'s own format.
- [x] 1.3 Wire this helper into `startDaemon` (`packages/server/src/daemon.ts`): call it once before any workspace loads, set `daemonCfg.push.vapidPublicKey` in memory from the result, and add the private key to a new `AppDeps.pushKeys: { publicKey; privateKey } | null` (never added to `DaemonConfigSchema`); verify `GET /push/config` on a fresh throwaway daemon (no prior state dir) reports `configured: true` with a public key, and a second start against the same dir reports the same key.
- [x] 1.4 Handle key-generation failure without crashing startup (catch, log, leave `pushKeys: null`, `vapidPublicKey` unset); verify a test where the key directory is unwritable still starts the daemon and `GET /push/config` reports `configured: false`.

## 2. `sendPush` becomes real

- [x] 2.1 Change `sendPush`'s signature to accept the key pair (or `null`) and a payload of `{ title, body, path }`; with no key pair, keep today's `{ sent: 0, skipped: subs.length }` behavior unchanged; verify the existing `push.test.ts` assertions about unconfigured behavior still pass.
- [x] 2.2 Implement the configured path: `webPush.sendNotification(subscription, JSON.stringify(payload), { vapidDetails })` per subscription via `Promise.allSettled`, counting `sent`/`skipped`; verify a unit test with a fake/mocked `web-push` module asserts one call per subscription and correct counts.
- [x] 2.3 On a rejected subscription (`WebPushError` with `statusCode` 404 or 410), delete that subscription row; verify a unit test with a mocked rejection asserts the row is gone afterward and other subscriptions in the same batch still receive their send.
- [x] 2.4 Keep the payload's key spelled `path` (not `url`), matching what `packages/ui/public/sw.js`'s `notificationclick` already reads; verify a unit test constructs the JSON payload and asserts the field name.

## 3. Category storage

- [x] 3.1 Add `PUSH_CATEGORIES = ['decisions', 'landed', 'everything'] as const` (and its type) to `packages/shared/src/enums.ts`; verify `packages/shared/src/tools.test.ts` and typecheck stay green.
- [x] 3.2 Add migration `packages/db/src/migrations/0029_push_subscription_categories.sql` adding `categories_json TEXT NOT NULL DEFAULT '["decisions","landed"]'` to `push_subscriptions`; verify a migration test (or the existing db migration test suite) applies cleanly on a fresh db and on a db seeded before this migration.
- [x] 3.3 Extend `POST /push/subscriptions` to accept an optional `categories: PushCategory[]`, storing it (defaulting to the column default when omitted), and extend `listSubscriptions`'s row shape accordingly; verify a test posts with and without `categories` and reads back what was stored.
- [x] 3.4 In `sendPush`'s caller path (task 4), filter subscriptions to those whose stored categories include the category being sent, before calling `sendPush`; verify a unit test asserts a subscription without `decisions` in its categories receives no call.

## 4. The caller: `PushDispatcher`

- [x] 4.1 Create `packages/server/src/pushDispatcher.ts` exporting a `PushDispatcher` class shaped like `ChannelManager`/`WebhookDispatcher`: constructed with `(ctx, services, getKeys)`, `start()` subscribes to `ctx.events.on`, `stop()` unsubscribes.
- [x] 4.2 On `decision.created`, load the decision, proceed only if `owner === 'human' && status === 'open'` (mirroring `ChannelManager.pushDecisionCard`'s filter); build the payload (`title`/`body` from the decision, `path: /w/{ws}/needs`) and call the category-filtered send from task 3.4; verify a unit test emits a `decision.created` event on a fake `ctx.events` for a human-owned open decision and asserts `sendPush` is invoked, and that a `weaver`-owned decision does not trigger it.
- [x] 4.3 Wire `PushDispatcher` into `loadWorkspaceInto` (`daemon.ts`) alongside `channels`/`webhooks`: construct, `start()`, store on `WorkspaceRuntime.push`, and stop it in both shutdown paths (`shutdown()` and the workspace-unregister path); verify existing daemon startup/shutdown tests stay green and a new assertion that `runtime.push` is present after a workspace loads.
- [x] 4.4 Ensure one subscription's send failure does not throw past the dispatcher and does not block delivery to another subscription in the same batch (covered by `Promise.allSettled` in task 2.2, verified from the dispatcher's own entry point).

## 5. Web app: categories and honest toggles

- [x] 5.1 Update `packages/ui/src/lib/push.ts`'s `enablePush` to accept and send the caller's current category selection; add a small helper (e.g. `updatePushCategories`) that re-POSTs the existing subscription with a new category set; verify existing `push.test.tsx` assertions plus a new one for the update path.
- [x] 5.2 Update `Settings.tsx`'s `DeviceSection`: `enablePush` call passes the current toggle state as categories; each toggle's `save()` also calls `updatePushCategories` when a subscription is already active; verify a UI test toggling a category while subscribed asserts the categories POST fires with the expected set.
- [x] 5.3 Add a `wired` flag to the `NOTIFS` array (`decisions: true`, `landed: false`, `everything: false`) and render a short honest qualifier on the unwired rows' `detail` text; verify a UI test asserts the qualifier text is present for `landed`/`everything` and absent for `decisions`.

## 6. Docs

- [x] 6.1 Update `docs/API.md`'s "Web push" section: `GET /push/config`'s `configured` semantics (daemon-generated, not operator-set), `POST /push/subscriptions`'s `categories` field, and that delivery is real (not a stub) with the category-filtering and dead-subscription-cleanup behavior.

## 7. Verification

- [x] 7.1 `pnpm lint`, `pnpm typecheck`, and both test suites (`vitest run` core/server, then `pnpm --filter @weave-ai/ui exec vitest run`) green; paste both totals verbatim in the delivery report.
- [ ] 7.2 **Not fully done — see the ticket comment.** Booting the real compiled daemon against a throwaway config dir (rather than trusting the mocked test harness) did catch a real bug the whole test suite missed: `generateVAPIDKeys` is not a live named ESM export of the `web-push` CJS package under Node's actual interop (only under vitest/esbuild's more permissive one) — fixed by switching to the default import. That boot also confirmed real key generation, the real `/push/config` response, and a real Chromium profile reaching Google's push service to subscribe. It stopped short of the full "observe a real OS notification, click it" loop: this host's display is the human's own live desktop (confirmed running — their real browser, real tabs, mid-session), and completing that loop means popping visible windows and a real OS notification on it without them at the keyboard granting it in this moment. Left for the human to do in ~30 seconds if they want it, or to say a throwaway VM/display is fine to use instead.
- [x] 7.3 Verify a daemon with no VAPID key pair (fresh throwaway config dir, key generation stubbed/blocked) still starts and serves, and `GET /push/config` reports unconfigured rather than erroring.
- [x] 7.4 Verify the private key is absent from `daemon.yaml`, from daemon log output, and from every route response captured during the manual verification pass.
