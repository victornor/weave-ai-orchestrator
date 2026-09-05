# Capability page highlights requirements that an active change is about to modify

Tracker change for [VS-41](conductor://tickets/VS-41). A `task` ticket, so this change carries
tasks only — `skip_specs: true`.

## Why

PLAN §12.5 and `docs/design/DESIGN-CONTRACT.md` line 125 both say a capability's pending deltas are
inline in the requirement list — a tinted border and one word (ADDED / MODIFIED / REMOVED) on the
requirement itself — "so you read the spec as it will be, with the uncertainty marked in place".
The web app already renders that: `Requirement.delta` is in `packages/ui/src/api/types.ts` and
`CapabilityPage` tints the card and prints `<ticket> · <state>` from it. Nothing ever set the field.
Core's `getCapability` returned each requirement as `{ name, text, scenarios }`, so the highlight
has been inert since it was written, and the capability page showed no sign of the change that is
about to rewrite it.

## What changes

- `parseDeltaRequirements(body)` in `packages/core/src/specs/index.ts`: every `### Requirement:`
  under a `## ADDED|MODIFIED|REMOVED|RENAMED Requirements` section of a delta spec, with the text
  and scenarios it carries. RENAMED sections name their requirements in `- FROM:` / `- TO:` list
  items, and both sides are reported.
- `getCapability` matches those names (case- and whitespace-insensitively) against the capability's
  own requirements and sets `delta: { kind, changeName, ticketIdentifier, state: 'pending' }` on
  each match, for every **active** change touching the capability. Archived changes stay history.
- A requirement an active change only ADDs (or renames into) is not on the default branch yet, so it
  is appended to the list with the wording from the delta spec and an ADDED / RENAMED marker.
- Requirements now carry their `id` on the wire, which is what the page keys the list by.

## Out of scope

Diff rendering of the requirement text itself, and the pre-existing gaps in the capability payload
that VS-40 is fixing (the nested-capability route param, `history` entries missing `state`/`prUrl`).
