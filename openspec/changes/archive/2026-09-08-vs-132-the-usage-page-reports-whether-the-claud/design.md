## Context

See `proposal.md` - Why. The design question the ticket poses in its acceptance criterion 3 is
whether there is a longer-lived, genuinely actionable expiry to show instead of the countdown. That
has to be settled by reading what each runtime's credential actually carries, not guessed.

**What each runtime's credential facts hold today** (`RuntimeAdapter.readCredential`,
`packages/runtime-sdk/src/index.ts`):

- **Claude** (`packages/runtimes/claude/src/credential.ts`): the only implementation. It reads
  `.credentials.json`'s `claudeAiOauth` object — `accessToken`, `refreshToken`, `expiresAt`, `scopes`,
  `subscriptionType` — and returns `expiresAt` from the one `expiresAt` field the file has. That field
  is the OAuth access token's expiry; the file carries no separate expiry for the refresh token or for
  a session. There is nothing else in the file to read a longer-lived deadline from.
- **Gemini, OpenCode**: neither adapter implements the optional `readCredential`. The daemon's
  fallback (`packages/core/src/usage/accounts.ts:229-237`) reports `present` from a file-existence
  check and `expiresAt: null`, unconditionally. Their row already never renders a countdown.

So for every runtime the system can say anything about today, `expiresAt`, when it exists, is the
self-refreshing access token's expiry — never a human-actionable deadline. That is what makes the fix
general rather than Claude-specific: there is no runtime to special-case differently.

## Goals / Non-Goals

**Goals:**
- Stop the usage page's healthy-credential row from showing a countdown to a value that is not a
  deadline, for any runtime.
- Keep the row honest about the one state that does need the human: `needsLogin`.

**Non-Goals:**
- Modelling a "genuine deadline" concept in `CredentialFacts` or the database. None exists to model:
  see Context. If a runtime is ever added whose credential does carry a real deadline, that is new
  scope for whoever adds it, not something to speculatively build now.
- Touching `doctor`'s credential check (`packages/cli/src/commands/doctor.ts`): it prints an absolute
  timestamp ("expires 2026-09-08 22:00 UTC"), not a countdown, to an audience reading a diagnostic
  report rather than a status badge. It is not the surface the ticket names or the one captain
  misread, and changing it is not implied by the acceptance criteria.

## Decisions

**Drop the countdown entirely for the healthy row, rather than relabelling it.** The `until()`
helper in `RuntimeCredentials.tsx` (the "in 4h" / "in 12m" formatter) is deleted along with its call
site in the healthy branch; the row's status text ("valid" already exists, kept) is what answers "is
this healthy", and `lastVerifiedAt` — already recorded independently of `expiresAt`, on every
successful turn or probe — is what answers "how do we know", as evidence rather than a deadline.
Considered relabelling the countdown (e.g. "refreshes in 4h") instead of removing it: rejected,
because a refresh-timing detail is not something a human needs or can act on, and showing it
un-asked-for reintroduces exactly the "styled like a deadline" problem this ticket exists to remove.

**`now` becomes unused and is dropped from `RuntimeCredentials`' props.** It existed only to make
`until()`'s countdown deterministic in tests. With `until()` gone, nothing in the component depends on
the current time — `at()` formats an absolute ISO timestamp regardless of `now`. Keeping an unused
prop for a hypothetical future countdown would be exactly the kind of speculative surface this
codebase's conventions ask not to add. Call sites: the one production call
(`packages/ui/src/routes/Usage.tsx:83`) never passed `now`; tests pass credentials with the ISO
timestamps already fixed, so removing it costs them nothing but the now-meaningless argument.

**The spec delta touches only the "usage view" half of the combined requirement.** The existing
`credential-visibility` spec bundles the usage view and the diagnostic command under one requirement.
The diagnostic command's scenarios and the credential-state-recording requirement are copied forward
unchanged, per the Non-Goals above.

## Risks / Trade-offs

- [A human who *did* want to know "when does the access token itself refresh" loses that number] →
  Nobody needs it: the token refreshes itself and the row's job is "does this need me", which
  `lastVerifiedAt` and `needsLogin` already answer completely. It was never useful for that question,
  only misleading.
- [If a future runtime's credential does carry a genuine expiry, this design has no field for it] →
  Acceptable: `CredentialFacts.expiresAt` and the row can be extended when that runtime exists: no
  runtime today has one, so building for it now is speculative.
