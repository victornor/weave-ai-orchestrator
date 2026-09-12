## Why

The conductor's briefing is the one list meant to guarantee nothing waiting for the human is
forgotten, yet its `Needs you` section is the only place where a waiting card can vanish without a
trace. `briefing.service` selects open human-owned decisions `ORDER BY created_at DESC LIMIT 20`, so
the moment more than 20 exist the **oldest** — the cards that have waited longest, and so are the
ones most in need of being seen — are the first to be dropped. A card that has sat for three days
disappears before a card raised a minute ago. It is latent today only because no workspace currently
holds more than a handful of open cards; the correctness bug is in the query, not in the data.

## What Changes

- The briefing's `Needs you` selection becomes **oldest-first**, so the cap sheds the freshest cards
  (which the conductor most likely just saw raised) rather than the stalest. The stale end is
  presented first, matching the section's purpose.
- Truncation stops being silent. The snapshot reports how many open human-owned decisions exist
  beyond the ones carried, and the rendered section states it (`3 more waiting`). No open card can
  be invisible in the briefing without the section saying that some were not shown.
- Each rendered card's line carries its compact age (`3d`) alongside its kind, so a stale card reads
  as stale at a glance — the same signal VS-306 adds to the weaver's open-decisions prompt lines.
- The weaver's own rendering contract carries the overflow too, because it never sees the CLI's
  render: `skills/weave-ai-briefing/SKILL.md`'s `Needs you` block is told to state how many cards the
  cap left out, and `weave_briefing`'s tool description names the total so a weaver cannot read a
  capped list as the whole truth.
- **BREAKING**: none. The `Briefing` snapshot and the rendered `BriefingSection` gain fields with
  safe fallbacks; the web app's Needs-you surfaces are untouched (different queries, different
  audience) and keep their ordering and counts.

## Capabilities

### New Capabilities
- `briefing/needs-you`: the conductor-facing briefing snapshot and its rendered `Needs you` section:
  which open human-owned decisions it carries, in what order, how the cap is reported, and the age
  each line shows.

### Modified Capabilities
(none — no existing spec file covers the briefing snapshot or its render)

## Impact

- `packages/core/src/briefing/service.ts` — the `needsYou` query (order), plus the total count the
  section needs to report what it dropped.
- `packages/shared/src/types.ts` — `Briefing` carries the total; `render`'s `BriefingSection` gains
  a hidden count and its display line.
- `packages/render/src/briefing.ts` — builds the `Needs you` section: oldest-first, age on the meta
  line, and the `N more waiting` overflow line; `packages/render/src/types.ts` for the section shape.
- `packages/cli/src/commands/conversation.ts` — prints the overflow line under the section.
- `skills/weave-ai-briefing/SKILL.md` — the weaver's `Needs you` block states the overflow case, since
  the weaver renders from the raw snapshot and never sees `briefingToSections`.
- `packages/server/src/tools.ts` — `weave_briefing`'s description names the total, so the always-
  visible tool line cannot be read as "this capped list is everything".
- Tests: `packages/core/src/briefing/briefing.test.ts` (service order + total), and
  `packages/render/src/briefing.test.ts` (empty and over-limit rendered section).
- No web-app, route, schema, or migration change. No change to the web Needs-you page.
