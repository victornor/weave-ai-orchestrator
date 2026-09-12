## Context

See `proposal.md` — Why. The briefing is computed in `packages/core/src/briefing/service.ts`. It has
two renderers: `packages/render/src/briefing.ts` (`briefingToSections`), whose only consumer is the
CLI `weave briefing` (`packages/cli/src/commands/conversation.ts`); and the weaver itself, which
receives the **raw snapshot** from `weave_briefing` (`packages/server/src/tools.ts:774-776`) and
renders the four sections into the human's chat under the contract in
`skills/weave-ai-briefing/SKILL.md`. The web app's Needs-you surfaces run their own queries and are
out of scope. The snapshot's type is `Briefing` in `packages/shared/src/types.ts`; the rendered shape
is `BriefingSections`/`BriefingSection` in `packages/render/src/types.ts`.

Constraint: the `Needs you` list is capped so the briefing stays bounded. The fix must keep a cap —
removing it just moves the cliff — while guaranteeing no card is silently dropped.

## Goals / Non-Goals

**Goals**
- The oldest open human-owned cards are the ones kept under the cap.
- A cap that hides cards is reported in the rendered section.
- Each carried card's line shows its age.
- No change to the web app's Needs-you page, ordering or count.

**Non-Goals**
- Making cards dismissible/closable (VS-306).
- Reporting truncation for the `Landed` or `Queued` sections — they truncate too, but this ticket is
  scoped to `Needs you`, and widening it would change those sections' contracts.
- Changing the cap value.

## Decisions

### D1: Oldest-first, both selected and presented

Select `ORDER BY created_at ASC`, and render the items in that order (oldest at the top). The
section's purpose is "what has been waiting for you"; the card that has waited longest belongs at
the top, and truncation then sheds the freshest — which the conductor most likely just saw raised.

Alternative considered: select oldest-first but reverse for presentation (newest at top). Rejected:
it preserves an order that fights the section's purpose and costs a reverse pass for no benefit. The
only thing "newest first" bought was that the freshest cards were visible — which is exactly the end
that should now be dropped, and whose loss the truncation notice covers.

### D2: The snapshot states the total; the render derives and displays what was hidden

A cap can only be reported by whoever knows both the cap and the true count, which is the service.
So `needsYou()` also counts all open human-owned decisions and the snapshot carries that total
(`Briefing.needsYouTotal`). The render computes `hidden = max(0, total - shown)` and turns it into
the section's overflow line (`3 more waiting`).

Alternatives considered:
- **Fetch every decision and cap in the render.** Moves the bound out of `core` into presentation
  and lets the API return an unbounded list. Rejected.
- **Append a synthetic item to the list.** Pollutes the item contract (each item is a real card with
  a glyph and a ref) and would need special-casing in every renderer. Rejected.
- **A `warnings` entry.** Warnings are operational problems (`worker failed`, `ticket blocked`), not
  section metadata; putting it there would separate the count from the section it describes.
  Rejected.

### D3: Truncation rides the section as `hidden` + `hiddenLine`

`BriefingSection` gains `hidden: number` and `hiddenLine: string | null`, mirroring the existing
`count`/`empty`/`emptyLine` pair. Only `needs-you` populates them; `landed` and `queued` carry
`hidden: 0`/`hiddenLine: null`. The CLI prints `hiddenLine` after a section's items when present.

`Briefing.needsYouTotal` is **optional**: the service always sets it, but making it required would
break every existing `Briefing` fixture (test fakes, render tests) for a value the render can fall
back on. The render treats a missing total as "nothing hidden", consistent with its existing
tolerance of malformed snapshots.

### D4: The card line shows compact age via `formatAge`

The `Needs you` item's meta currently joins the kind and `formatRelative`'s `2m ago`. Switch the age
half to `formatAge` (`2m`, `3d`), matching the compact age token VS-306 puts on the weaver's
open-decisions prompt lines and reading lighter next to the kind. VS-306 has not landed, so this
change takes no dependency on it; the two are simply consistent in shape.

### D5: The weaver's renderer is told the overflow too, at both its touchpoints

`hiddenLine` only exists on the `briefingToSections` model, which the weaver never sees. So the
weaver's contract carries the overflow itself, from the raw snapshot's total, in two places:

- `skills/weave-ai-briefing/SKILL.md`'s `Needs you` block states that when the snapshot carries more
  open decisions than items, the section reports how many more are waiting — the same plain form as
  the CLI line — instead of presenting the capped list as complete.
- `weave_briefing`'s description in `packages/server/src/tools.ts` names the total. This was the
  conductor's suggested extra; I chose to add it because the tool description is in front of the
  agent on **every** turn (the MCP tool list), while the skill is loaded only when its trigger fires
  — and the description's existing "use it verbatim" is exactly what could let a weaver paste a
  capped list as the whole truth. One sentence, no behaviour change, is cheap insurance against the
  trigger not firing.

Alternative considered: skill-only. Rejected for the reason above — the gap is per-surface, so the
always-visible surface should name it rather than rely on a skill load.

## Risks / Trade-offs

- **A freshly raised gate is now the first to be dropped once over the cap** → the truncation line
  counts it (`3 more waiting`), and the freshest is the card the conductor is most likely to have
  just seen; nothing becomes invisible without a count.
- **`needsYouTotal` optional means a producer could omit it and silently report no hidden** → there
  is exactly one producer (`briefing.service`), which sets it, and it is asserted in the service
  test; the fallback only protects test fixtures and older snapshots.
- **Reading order changes for the CLI conductor** → intended: the stalest card is the one that most
  needs attention, and the section's whole point is to surface what has waited longest.

## Migration Plan

No schema, migration or route change; the snapshot is computed per request, so there is nothing to
backfill. Deployment is the normal merge + `weave daemon upgrade`. Rollback is a revert of the
commit; the added fields are optional or have defaults, so a snapshot from the new code still parses
in the old render and vice versa.

## Open Questions

None.
