/**
 * VS-770: the words of the demo. Everything here is invented — fictional company, fictional people
 * and projects, no real repository or customer. Kept apart from the seeding mechanics so a change of
 * wording is a change of this file only.
 */

export const PLAN_DARK_MODE = `# Plan

## Proposal
Add a dark colour scheme to the storefront. The shop reads the shopper's system preference on first visit and remembers an explicit choice afterwards.

## What changes
- A \`ThemeProvider\` that resolves \`light\`, \`dark\` or \`system\` and writes a \`data-theme\` attribute.
- Design tokens for surfaces, text and borders, defined once and swapped per theme.
- A theme switch in the account menu.

## Tasks
- [x] 1.1 Define the colour tokens for both themes
- [x] 1.2 Add the provider and persist the choice
- [x] 1.3 Convert the product grid, cart and checkout to tokens
- [x] 1.4 Add the switch to the account menu
`;

export const PLAN_SAVED_CARTS = `# Plan

## Proposal
Let a signed-in shopper pick up their cart on any device. Today the cart lives in the browser's storage, so a phone and a laptop never agree.

## What changes
- Persist the cart server-side against the shopper's account, merging with any guest cart at sign-in.
- Add \`GET/PUT /api/cart\` with optimistic concurrency so two devices cannot silently overwrite each other.
- Keep guest carts local; only signed-in carts sync.

## Risks
- A merge conflict between a guest cart and a saved one. The plan keeps the larger quantity per line and tells the shopper what it did.

## Tasks
- [ ] 1.1 Cart table and migration
- [ ] 1.2 Cart API with version checks
- [ ] 1.3 Merge-on-sign-in
- [ ] 1.4 Client sync and conflict notice
`;

export const PLAN_PUSH_PREFS = `# Plan

## Proposal
Give shoppers control over which push notifications they receive: order updates, price drops and promotions, each on its own switch.

## What changes
- A notification preferences screen in the app settings.
- A \`preferences\` document per device, synced through the existing profile endpoint.
- The sender skips a category the shopper has turned off.

## Tasks
- [ ] 1.1 Preferences model and storage
- [ ] 1.2 Settings screen
- [ ] 1.3 Sender-side filtering
`;

export const REPORT_POSTGRES = `# Report: Postgres 17 upgrade path

## Answer
The ledger database can move from 15 to 17 with a logical-replication cutover and about four minutes of write downtime. No extension we use blocks it.

## Evidence
- \`pg_upgrade --check\` against a restored snapshot reports no incompatibilities.
- The two extensions in use (\`pg_trgm\`, \`btree_gist\`) both ship 17 builds.
- A rehearsal on the staging copy replayed 40 minutes of production traffic with no replication lag above 2 seconds.

## Recommendation
Schedule the cutover for a low-traffic window, keep the 15 primary read-only for a day, then retire it.

## Open questions
- Who owns the rollback call if lag exceeds the budget during the window?
`;

export const REPORT_LATENCY = `# Report: Friday checkout latency

## Finding so far
p95 checkout latency doubled at 14:10 on Friday, minutes after the tax-rate lookup began calling the pricing service synchronously. The call has no timeout and no cache.

## Evidence
- Trace samples show 380 ms spent waiting on \`pricing.quote\` against a 90 ms baseline.
- The change shipped as part of the cart summary rework; no other deploy landed in that hour.

## Next
Confirm with a flag that restores the cached lookup, then decide between a cache and a timeout.
`;

export const ACTION_CDN_KEY = `# Action: rotate the CDN signing key

## Commands
\`\`\`
cdnctl keys create --service storefront --algorithm ed25519 --label 2026-03
cdnctl keys promote --service storefront --label 2026-03 --grace 24h
\`\`\`

## Host and service
The CDN control plane for the storefront service, using the deploy role.

## Expected outcome
A new signing key becomes active with a 24 hour overlap, so URLs signed with the old key keep working until they expire. The old key is revoked in a follow-up after the grace period.

## Rollback
\`cdnctl keys promote --service storefront --label 2026-02\` restores the previous key at any point during the grace period.
`;

export const ACTION_APP_STORES = `# Action: submit Pocket 4.2 to both app stores

## Commands
\`\`\`
fastlane ios release --version 4.2.0 --submit
fastlane android release --version 4.2.0 --track production --rollout 0.1
\`\`\`

## Host and service
The release runner, using the store credentials held by the release role.

## Expected outcome
Both builds enter store review. The Android release starts at a 10 percent rollout.
`;

export const PROJECT_HUBS: Record<string, string> = {
  storefront: `# Storefront

## Overview
- 2026-01-12 · The shop front end and its edge functions. Server-rendered pages with islands of client code; product data comes from the catalog service.

## Stack & commands
- 2026-01-12 · TypeScript, Vite, Vitest. \`pnpm test\` runs the unit suite; \`pnpm e2e\` runs the browser suite against a local stack.

## Conventions
- 2026-01-20 · Colours and spacing come from design tokens; no raw hex values in components.
- 2026-02-03 · Every user-facing string goes through the i18n helper, even in English.

## Current focus
- 2026-02-27 · Checkout rework: the summary panel, saved carts and gift cards.

## Landmines
- 2026-02-09 · The cart badge reads from two stores during a bundle removal; update both or the count drifts. See [[cart-state]].
- 2026-02-21 · The edge cache keys on the locale cookie, so a missing cookie serves the default locale to everyone behind that cache entry.

## Documents
- [[cart-state]] — how cart state moves between the client and the edge.
- [[release-checklist]] — what to check before a storefront release.

## Learnings
- 2026-02-14 · A visual change is judged by its render; attach screenshots rather than describing them.
`,
  ledger: `# Ledger API

## Overview
- 2026-01-08 · Double-entry ledger and payment capture service. Postgres is the source of truth; every write is an append.

## Stack & commands
- 2026-01-08 · TypeScript on Node 22, Postgres 15. \`pnpm test\` needs a local Postgres; \`pnpm db:reset\` rebuilds it.

## Conventions
- 2026-01-30 · Money is integer minor units plus a currency code. Never a float.

## Current focus
- 2026-03-01 · Idempotent captures and the sliding-window rate limiter.

## Landmines
- 2026-02-11 · Capture retries from the payment provider arrive out of order; a retry can land before the original commits. See [[capture-idempotency]].

## Documents
- [[capture-idempotency]] — the rules for retried captures.
- [[postgres-upgrade]] — upgrade path from 15 to 17.

## Learnings
- 2026-02-19 · Run migrations against a restored snapshot before trusting them.
`,
  pocket: `# Pocket App

## Overview
- 2026-01-15 · The shopper-facing mobile app for iOS and Android. One React Native codebase with a few native modules.

## Stack & commands
- 2026-01-15 · React Native, TypeScript. \`pnpm ios\` and \`pnpm android\` launch simulators.

## Conventions
- 2026-02-02 · Native modules get a JavaScript fallback so the app still runs in the simulator.

## Current focus
- 2026-03-01 · Biometric unlock, offline order history, the 4.2 release.

## Landmines
- 2026-02-16 · A cold start with no network used to crash while reading the remote config; check [[release-checklist]] before shipping.

## Documents
- [[release-checklist]] — what to check before a store submission.

## Learnings
- 2026-02-24 · Store review takes one to three days; plan releases around it.
`,
};

export const PROJECT_DOCS: Array<{ project: string; slug: string; folder?: string; body: string }> = [
  {
    project: 'storefront', slug: 'cart-state',
    body: `# Cart state

The cart lives in three places: the client store, the edge cache's per-session copy and, since saved carts, the account record. The client store is the source of truth until the shopper signs in.

## Rules
- A line item is identified by SKU and bundle id, never by array position.
- Removing a bundle removes its children; the badge count reads from the same selector as the line list.

See [[release-checklist]] for the checks that cover this.
`,
  },
  {
    project: 'storefront', slug: 'release-checklist',
    body: `# Release checklist

1. The unit and browser suites are green on the release branch.
2. The checkout flow has been walked by hand on a phone-sized viewport.
3. The edge cache has been purged for the locale cookie keys.
4. The changelog entry names every user-visible change.
`,
  },
  {
    project: 'ledger', slug: 'capture-idempotency',
    body: `# Capture idempotency

A capture request carries an idempotency key. The service stores the key with the result in the same transaction as the ledger entries, so a retry returns the stored result and never writes twice.

## Out-of-order retries
The payment provider can deliver a retry before the original has committed. The service takes an advisory lock on the key, so the retry waits instead of racing.
`,
  },
  {
    project: 'ledger', slug: 'postgres-upgrade',
    body: `# Postgres upgrade

The upgrade from 15 to 17 uses logical replication and a short write freeze. See the scout report on LUM-13 for the evidence and the rehearsal numbers.

Related: [[capture-idempotency]], because captures are the writes the freeze interrupts.
`,
  },
  {
    project: 'pocket', slug: 'release-checklist',
    body: `# Release checklist (mobile)

1. Bump the version in both native projects.
2. Run the release build on a real device, with and without a network.
3. Submit iOS first; Android can roll out at ten percent while iOS is in review.
`,
  },
];

export const WORKSPACE_HUB = `# Lumen Labs

## Overview
- 2026-01-05 · Lumen Labs sells home goods online and through a mobile app. Three products: the storefront, the ledger API and the Pocket app.

## Goals
- 2026-02-01 · Ship a faster, calmer checkout this quarter.

## People & working style
- 2026-01-05 · Captain reviews every plan and every merge. Short messages, answers first.

## Portfolio
- 2026-01-05 · storefront, ledger, pocket.

## Conventions
- 2026-01-05 · Squash merges; every change is linked to a ticket.

## Standing instructions
- 2026-01-05 · File one ticket per ask; bundle asks that arrive together.
`;

export const SHARED_HUB = `# Shared conventions

## Conventions
- 2026-01-05 · Commit messages are imperative and scoped.
- 2026-01-05 · Tests and lint run before anything is delivered.
- 2026-02-10 · A claim about a test result carries the command output, not a paraphrase.

## Glossary
- 2026-01-05 · **Landing branch**: where a ticket's work merges before it is promoted.

## Tone
- 2026-01-05 · Direct. Lead with the answer.
`;

export const DECISIONS_HUB = `# Decisions

## Decisions
- 2026-02-05 · Squash merges everywhere. Rebase-and-merge was dropped because it lost the ticket link.
- 2026-02-18 · The ledger keeps integer minor units; a currency column is required on every amount.
`;

export const HUMAN = { id: 'captain', name: 'captain' } as const;
