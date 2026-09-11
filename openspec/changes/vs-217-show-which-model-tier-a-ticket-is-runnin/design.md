## Context

Everything needed already exists. `Ticket.workerModelId` (`packages/shared/src/types.ts:28`, null means the workers default) is on every ticket record the board and live view fetch. The effective option catalog (`{id, description, runtime, model, effort?}`) reaches the client through `useModels()` → `GET /models` (`packages/ui/src/api/hooks.ts:533`, `qk.models(ws)`), which applies the daemon overlay — the same catalog `resolveWorkerModelId` validates against, so "configured" means one thing everywhere. Nothing new is stored, fetched per-card, or computed on the server.

The ticket names three decisions explicitly: the default-tier handling, smallness, and one component across surfaces.

## Goal / Non-Goal

Goal: a derived, self-maintaining tier label on every surface that shows a ticket as work, appearing only when tiers differ.

Non-Goal: changing how `workerModelId` is set or resolved (no assign-from-board, no re-resolve); the project overview's Work-under-way section; the TUI (it has no ticket card — `workerToCard` is a worker card; if symmetry is ever wanted, `ticketToSummary` in `packages/render` is the seam).

## The default decision (ticket's "decision to make explicitly")

Chosen: **label it `default`** — the ticket's second option, captain's steer adopted.

Rejected "tag with the default's id": `models.workers` is a bare `ModelSetting` (`{runtime, model}`) with **no id** — an id only exists in the catalog. Matching the default setting to an option by runtime+model would display a pin the ticket does not have and break the moment the default stops equaling any option.

Rejected "show nothing": with tags on every neighbouring card, an untagged card reads as either "default" or "this UI doesn't know" — the ambiguity the ticket says to avoid.

Applied consistently one step further: a ticket whose stored id is **no longer in the effective catalog** also reads `default`. That is not a display shortcut — `modelSettingFor` falls through to `models.workers` when the id dangles (`packages/core/src/models/resolve.ts:53-58`), and `model-selection/worker-options` specifies exactly that fallback — so `default` states what the ticket will actually run on, and usefully surfaces that a named option silently vanished. The catalog lookup costs one `find` over data already in hand.

## Component design

`packages/ui/src/components/WorkerModelTag.tsx` exports:

- `workerModelTagLabel(ticket: Pick<Ticket,'workerModelId'>, options?: WorkerModelOption[]): string | null` — `null` unless `(options?.length ?? 0) > 1` (the derived gate); the ticket's id when the catalog contains it; `default` otherwise. One derivation path for every surface.
- `WorkerModelTag({ ticket, options })` — renders `workerModelTagLabel` as a neutral `Badge` (reuse `StatusGlyph.tsx:62`; its uppercase micro pill is the card's existing annotation shape, and it keeps the raw-hex/px lint gate happy), `null` when the label is `null`.

**Options flow in as a prop, not a hook inside the card.** `useModels()` reads the workspace context (`useWs()`), and `TicketCard` is rendered provider-free in `components.test.tsx` and inside wholesale `../api/hooks` route mocks; a hook in the card breaks both. Props-in keeps the component pure — the `DecisionCard`/`plan` convention from the web-app conventions doc. Callers fetch once per route: `Board.tsx` and `Live.tsx` each call `useModels()`; `GlobalLive.tsx` uses a new `useModelsMany(ids)` (a `useQueries` fan-out mirroring `useWorkersMany`, `hooks.ts:455`, over the same `qk.models(ws)` key so it dedupes with `useModels` — no extra endpoint, no per-cell fetch).

`TicketCardProps` and `LiveCell` each gain one optional field, `workerOptions?: WorkerModelOption[]` (the `WorkspaceModels.workerOptions` array). Undefined (loading or errored) hides the tag everywhere — a tag gate that opens with the data, never before.

## Placement

- `TicketCard` — badge row (`TicketCard.tsx:72-80`), directly after the kind `<Badge>`: same row the eye already skips past, before `OutcomeChip`/worker name. Nothing else in the row changes; the `flex-1` spacer and `ago()` absorb the width.
- `TicketRow` — meta line (`:97-103`), after the identifier, as the same `Badge` (the row's other annotations are plain text, but the tag must be one component everywhere; the pill is nano-sized and fits the line's rhythm).
- Board table — inside the existing Kind cell (`Board.tsx:257`) as `kind badge + tag`; the Kind column width widens from `6rem` to `9rem` only while tags are showing, taken from Title (the one flexible column), so no column shrinks.
- `LiveCell` — the ticket-identity row (`Live.tsx:162-172`) becomes a flex row: the existing `<A>` link (truncates as a flex child, with a `min-w-10` floor found in the visual check so the link never disappears entirely at the smallest cell) plus the tag as `flex-none`. The tag belongs with the ticket identity, not the agent name — it describes the ticket's tier.

## Smallest live cell

The tag is `flex-none` in a truncating flex row, so at the smallest span the link truncates harder and nothing overflows the `overflow-hidden` card. jsdom has no layout, so the automated claim is structural: a `LiveCell` rendered at `{cols: GRANULARITY, rows: GRANULARITY}` still renders tag, agent name, ticket link and status badge. The visual claim is checked with the no-daemon screenshot harness (`[[ui-screenshot-harness]]`), images left as uncommitted files in the worktree with absolute paths on the ticket — the 2026-09-10 convention for eye-judged changes.

## Risks / Trade-offs

- Per-surface placement is hand-chosen; the shared component + one derivation function keeps drift to a placement question, not a text or gate question.
- `useModels` on Board/Live adds one cached request per page (deduped by query key with Settings' usage); invisible on the wire.
- If the human disagrees with the `default` label (e.g. wants it hidden instead), the decision is one line in `workerModelTagLabel` — everything else stands.

## Migration

None. Purely additive UI; no data, API or config change.

## Open Questions

None — the ticket's named decision is made above; the rest is judgement inside the accepted design.
