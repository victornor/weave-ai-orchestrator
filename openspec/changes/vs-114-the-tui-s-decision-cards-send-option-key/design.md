## Context

See proposal.md - Why. `decisionToCard` (`packages/render/src/decision.ts`) builds a `CardModel` from
a hard-coded `DEFAULTS` table merged with a decision's real, server-provided `options`
(`mergeOptions()`, lines 132-157). For a `DEFAULTS` key the real decision does not provide, the
current code keeps the default anyway; for a real option the `DEFAULTS` table does not name, it is
appended as an unlabeled "extra". `packages/tui`'s `Chat.tsx` answers with `card.options[index -
1].key` verbatim, so every key `decisionToCard` produces is genuinely sent to `decisions.answer`.

Two consumers use `DEFAULTS`, with different real-world guarantees:

- `merge_approval`, `hire_approval`, `discard_approval` (and already-correct `plan_approval`): the
  daemon **always** creates these with an explicit, non-empty `options` array
  (`packages/core/src/tickets/service.ts:373-375`, `packages/core/src/roles/index.ts:122-124,263`).
  `NAMED_CARD_OPTION_KEYS` names exactly those keys.
- `approval`, `gate_finding`: the daemon sometimes creates these with **no** `options` at all
  (`packages/core/src/runs/authgate.ts:103`, `packages/core/src/runs/engine.ts:479`). The decision
  service's own validation only rejects an answer key when `d.options.length > 0`
  (`packages/core/src/decisions/service.ts:333`), so an empty-options decision accepts any key —
  `mergeOptions()`'s fallback-to-default behavior is what gives these cards any buttons at all.

## Goals / Non-Goals

- Goal: every option a TUI decision card offers is a key its decision actually accepts, for all four
  named variants.
- Goal: no regression to `approval` / `gate_finding` cards, which depend on `mergeOptions()`'s
  fallback-to-default behavior when the real decision has no options.
- Non-goal: redesigning `mergeOptions()`'s general merge semantics. The bug is wrong keys in one
  table, not a flaw in the merge algorithm itself — see Decisions below.
- Non-goal: adding a hide/dismiss affordance to the TUI (VS-72's web equivalent). Out of scope; see
  Risks.

## Decisions

**Fix the keys in `DEFAULTS`, not `mergeOptions()`'s merge logic.** Because the three affected named
variants always arrive with real, explicit options whose keys will now equal the corrected `DEFAULTS`
keys, every default is matched by a real option on every production call — the "unmatched, keep
default anyway" branch (line 134-137) simply never fires for these variants once the keys agree, and
the "unlabeled extra" branch (145-155) never fires either, since there is nothing left over. Changing
`mergeOptions()` itself to drop unmatched defaults was considered (the proposal's originating ticket
raised it as an open question) and rejected: `approval` and `gate_finding` decisions can have zero
real options and rely entirely on the fallback to show any buttons at all; dropping unmatched defaults
globally would silently empty those cards. Scoping the drop-fallback to only the four named variants
would work too, but adds a conditional the corrected-keys fix makes unnecessary — the golden test
(below) is the actual guardrail against this class of bug recurring, not a merge-algorithm change.

**`merge_approval`: drop the `hold` default, replace with `changes`, no substitute for Hold.**
`hold` never matched a real option; it was fabricated in `DEFAULTS` and always failed. There is no
real decision-lifecycle meaning for "hold" a merge approval — a human who wants to defer just does not
act on the pinned decision, which is exactly what pressing the now-nonexistent Hold button amounted to
in practice anyway (it never succeeded). `changes` is a real, working option (`Request changes`) that
today only ever surfaced as an unlabeled "extra" past the two fake defaults; giving it a proper
`DEFAULTS` entry gives it a real label and primary-band position instead.

**`hire_approval` and `discard_approval`: keep both buttons, fix only the keys.** Unlike Hold, both
options on these two variants are real, working, meaningfully different answers (`hire`/`reject` →
`approve`/`reject`; `discard`/`keep` → `approve`/`reject`) — the bug here is purely the wrong string,
not a phantom third option. Removing either button, the way `hold` is removed, would remove real
capability the corrected key now makes to actually work; only the label text was ever right about what
these buttons intended to do.

**Alternative considered — mirror the web exactly and drop discard-approval's "Keep" too**, relying
on "leave the decision open, unanswered" as the TUI's not-yet-final answer, the same as the web relies
on hiding the card. Rejected: the web's justification for dropping Keep is that hiding the card (VS-72)
already covers "not discarding yet" without an explicit answer — the TUI has no such hide affordance,
so leaving a destructive decision permanently unanswerable from the surface a human is actively working
in is a worse outcome than a working Keep button, not an equivalent one. `reject` is a genuine,
non-destructive answer that closes the decision; there is no reason to make it unreachable from the TUI
just because the web made a different call for a UI that has a feature the TUI doesn't.

**Add a `packages/render` regression test asserting `DEFAULTS[variant]` keys equal
`Object.values(NAMED_CARD_OPTION_KEYS[variant])`** for `plan_approval`, `merge_approval`,
`hire_approval`, `discard_approval`, mirroring the pattern VS-111 added in
`packages/core/src/tickets/tickets.test.ts` and `packages/core/src/roles/roles.test.ts`. This is the
guardrail the proposal's spec delta scenario ("A hard-coded card action is checked against its
decision's real options") requires, extended to this package.

## Risks / Trade-offs

- [The TUI still has no way to defer a merge approval without leaving it pinned open indefinitely] →
  Accepted: this is the status quo today (Hold has never worked), not a regression this change
  introduces. A human can always answer from the web app or `conductor decision answer`. Adding a
  TUI hide/dismiss surface is real, separable work — out of scope here, matching VS-111's own scoping
  of VS-72 as "stays as it is."
- [`mergeOptions()`'s fallback-to-default behavior is left in place, so a future decision kind added to
  `DEFAULTS` could reintroduce this exact bug if its real options are always non-empty but its keys
  drift from `DEFAULTS`] → Mitigated by the new regression test: any future edit that lets a named
  variant's `DEFAULTS` disagree with `NAMED_CARD_OPTION_KEYS` fails that test immediately, the same
  guarantee VS-111 built for `packages/core` and `packages/ui`.

## Migration Plan

No data migration. This is a pure code and test change to `packages/render`; nothing persisted
changes shape. Ship behind the normal PR/merge path — the fix is live as soon as the release the PR
lands in is deployed, with no separate rollout step.

## Open Questions

(none — the design decisions above resolve every question the originating ticket raised)
