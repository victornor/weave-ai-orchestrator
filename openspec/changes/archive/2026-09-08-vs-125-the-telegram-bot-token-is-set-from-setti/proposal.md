## Why

Enabling the Telegram channel requires editing `workspace.yaml` and exporting an environment variable on the daemon host by hand — Settings already renders a Telegram section, but the one field that actually gates the channel working isn't there. The workspace now has a secret store built for exactly this (a credential collected once, never readable back out, handed to the daemon at use time); the bot token belongs there instead of in a config file.

**Revision (2026-09-08, captain answered `fold_in`):** investigating the token wiring surfaced that Settings' existing "Allowlist" field is worse than cosmetically inert — it writes a key (`allowlist`) the channel never reads (`allowedUserIds`), and the channel's own gate treats an empty allowlist as open to every Telegram user, not nobody. Shipping easy token setup without fixing this would make it trivial to stand up a Telegram bot captain believes is locked down and isn't. Captain folded the fix into this ticket rather than filing it separately. This revision adds that scope; everything below "The token is write-only end to end" onward is unchanged from the approved token plan.

## What Changes

- A new route lets Settings set, replace and clear the Telegram bot token. Setting it calls Telegram's `getMe` before accepting the value; on success the token is registered in the secret store and the bot's username is returned for confirmation; on failure the call is rejected with Telegram's error and any previously-working token is left untouched.
- The token is write-only end to end: no route, response body, log line, activity record, transcript or knowledge entry ever carries it or lets it be reassembled. A status route reports only whether a token is configured, its source, and (when known) the bot's username.
- Effective-token precedence is made explicit and enforced in code: a token in the secret store wins; a workspace already running on an unresolved `${ENV_VAR}` reference in `workspace.yaml` keeps working when no secret is registered. `workspace.yaml` never gains a literal token.
- `ChannelManager` gains the ability to stop, start or restart a single channel kind at runtime, and does so whenever the Telegram token is set or cleared — no daemon restart. `TelegramConfigSchema.botToken` becomes optional, since the token may now live outside `workspace.yaml` entirely.
- Settings' Telegram section gains a token field (masked input, explicit Save, explicit Clear) showing "configured" / "not configured — channel is off" and which source (secret store vs. `${ENV_VAR}`) is in effect, following the existing write-only pattern already used for the account password field.
- **New:** Settings' "Allowlist" field writes `allowedUserIds` — the field the channel actually reads — instead of the dead `allowlist` key. One name, end to end.
- **New, BREAKING for a workspace already relying on the open default:** an empty allowlist now means nobody, not everybody. A one-time, meta-gated migration grandfathers any workspace that was already relying on the open-by-default behavior (`channels.telegram` configured, no `allowAll` key ever set, no ids ever set) onto an explicit `allowAll: true`, so it keeps accepting messages exactly as before. Every workspace configuring Telegram from here on defaults to accepting nobody until an id is added, unless `allowAll` is explicitly set. See design.md's Decisions for the full reasoning and why a value-based check (rather than the meta flag) cannot tell "just configured" apart from "configured for months."
- **New:** Settings states, next to the allowlist field, which rule is currently in force: locked to N users, open to any Telegram user (`allowAll`), or locked to nobody because the list is empty and `allowAll` is not set.
- **Reported, not fixed:** `TelegramConfigSchema` has no `enabled` field and nothing downstream of `PATCH /config` reads one; Settings' "Enabled" toggle has no effect on the running channel today, independent of this change. Captain asked this be reported rather than fixed here, since wiring `enabled` up is a separable follow-up (it doesn't interact with the token or the allowlist fix — see design.md).

## Capabilities

### New Capabilities
- `telegram-channel/bot-token`: how the Telegram bot token is set, replaced, cleared, validated against Telegram, kept write-only, and made to take effect on the running channel without a daemon restart, including precedence against an existing `${ENV_VAR}` deployment.
- `telegram-channel/allowlist`: how the Settings allowlist field reaches the channel, what an empty allowlist means, how an already-open deployment is carried through the change in behavior without going silently deaf, and how the interface states which rule is in force.

### Modified Capabilities
(none — the secret store's own registration/read-back/redaction guarantees are unchanged; this change is a second caller of the existing `workspace-secrets/collected-secrets` capability, not a change to it)

## Impact

- `packages/channels/telegram/src/config.ts` — `botToken` becomes optional; unresolved-`${ENV_VAR}` handling stays for the existing deployment path; `allowAll` added as an optional boolean.
- `packages/channels/telegram/src/index.ts` — the allowlist gate changes from "empty admits everyone" to "empty admits nobody unless `allowAll` is set."
- `packages/core/src/workspace/loader.ts` — one-time, `meta`-table-gated migration that grandfathers an already-open deployment onto explicit `allowAll: true`, modeled on the existing VS-77 model-settings migration in the same file.
- `packages/server/src/channels.ts` (`ChannelManager`) — add single-kind stop/start/restart and a Telegram effective-token resolver (secret store, then resolved config).
- `packages/server/src/routes/` — new routes for setting/clearing/reading the Telegram token status (not `PATCH /config`, which only ever touches `workspace.yaml`).
- `packages/core/src/secrets` — no interface change; a second writer of `secrets.put`/`secrets.value` alongside the existing decision-card `secret` input.
- `packages/ui/src/routes/Settings.tsx` — Telegram section gains the token field, the allowlist field writes the correct key, and a status line states which access rule is in force.
- Tests: `packages/channels/telegram/test`, `packages/core/src/workspace` (migration), `packages/server/test/channels.test.ts` + `fakes.ts`, `packages/ui` route tests. `getMe` is faked everywhere; nothing calls Telegram.
