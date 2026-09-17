## Context

Three existing mechanisms that already hold the right data, and the surfaces that have to reach:

| Signal | Already built | Where it lives today | Who needs it |
|---|---|---|---|
| A document no run read | `KnowledgeUsageService.neverRead()` over `knowledge_usage_events` | `packages/core/src/knowledge/usage.ts:154` | the curation trigger and the health view |
| Near-duplicate text | `similarity()` (Dice bigrams) + `DUPLICATE_THRESHOLD` (0.8) | `packages/core/src/knowledge/files.ts:239,264` | the curator, from a periodic sweep |
| What a replacement replaced | `replace()` computes the diff and archives removed lines | `packages/core/src/knowledge/service.ts:467` | a reader of the revision history |

Today's curation triggers are derived in two places. The supervisor's `curationPass()`
(`packages/core/src/supervisor/index.ts:764`) reads `knowledge_files` directly and asks for a run on
budget or age; the health view (`service.ts:806`) derives orphans, stale documents, unresolved links
and near-budget hubs on read, and `knowledgeHealthPass()` (`supervisor/index.ts:833`) wakes the
conductor when that set grows. The never-read measure belongs in both: it is a curation condition and
a health measure.

## Decisions

### D1 — The never-read window is a workspace setting, default 90 days

`defaults.knowledgeNeverReadDays` (integer, minimum 1, default **90**) joins the other workspace
defaults in `packages/shared/src/config.ts`. 90 days is chosen to match `DOCUMENT_STALE_MS`
(`files.ts:29`), so "nobody has read it in a season" is judged on the same horizon as "nobody has
written it in a season" and the two health signals stay comparable. A shorter window would flag
documents between ordinary curation cycles; a much longer one would let an unread, obsolete document
sit for most of a year. The default and that reasoning are stated in the config doc comment, not
implied.

A document is only reported once it is at least as old as the window, so a document created inside
the window is never flagged for being new; the age is the row's `updated_at`, which is already the
staleness reference for a file that has never been curated.

### D2 — `neverRead()` accepts an explicit lower bound

The usage view computes its windows from `USAGE_WINDOWS` (`all`, `7d`, …), none of which is a
configurable day count. `KnowledgeUsageQuery` gains an optional `since: string`, and `neverRead()`
uses it as the window start when present (`usage.ts` `parseWindow` path unchanged). Everything else —
the catalogue it diffs against, the "distinct document" rule, the inclusion of `shared` documents in
a project query — stays as it is. The read-event source remains the single definition of "read"; no
parallel notion is introduced.

### D3 — The measure is wired into both curation and health

**Curation trigger.** `curationPass()` computes one workspace-wide never-read set per pass —
`deps().knowledgeUsage.neverRead({ since: now - window })`, guarded so a failure leaves the pass as
it was — and treats a document row whose `path` is a document and whose `scope:project:slug` is in
that set, and whose `updated_at` is older than the window, as needing curation. The existing
budget/age verdict, the `curation_pending` repair, the per-path cooldown and the per-scope
`requestCuration` are all untouched; the new condition only adds a third reason (`never_read`) to the
same request path. This is why budget, age and orphan behaviour is provably not displaced: the new
branch is additive to the `if (!stale && !overBudget) continue`.

**Health view.** `health()` gains a `neverRead` list built from the same `neverRead()` call, filtered
to the scope's visible documents and to those at least as old as the window. `KnowledgeHealth` gains
`neverRead: KnowledgeDocSummary[]`; `knowledgeHealthPass()` adds `never-read:<path>` to its
signature and `neverReadDocs` to its wake payload, exactly as it already does for orphans and stale
documents. The measure is derived on read, writes nothing, and depends on no new table — the same
rule the other four measures follow.

The `health()` dependency on `knowledgeUsage` is guarded (a missing usage service yields an empty
never-read list) so the many existing knowledge-unit tests that build only a knowledge service keep
passing without wiring a second service.

### D4 — The duplicate sweep is a bounded, report-only pair comparison

`KnowledgeService.duplicates(filter)` gathers the entries (`entriesOf`) of the scopes' visible files
— the scope's hub and its linked documents — and compares every pair with the existing `similarity()`
at the existing `DUPLICATE_THRESHOLD`, returning `{ pairs, scanned, capped }`. Each pair names both
entries (path, scope, project, slug, section, text, line) and the score. It reads files and writes
nothing.

**Bound.** The number of entries compared is capped at `MAX_DUPLICATE_ENTRIES = 1500`, and the number
of pairs returned at `MAX_DUPLICATE_PAIRS = 100`; when the corpus exceeds the entry cap, `capped:
true` says so. Cost is therefore `O(min(N, 1500)²)` similarity calls per scope per sweep — at most
~1.12 M calls in the pathological case, each a few microseconds, so a worst case on the order of a
few hundred milliseconds once per scope per 30-minute health sweep. At the corpus this workspace
actually holds (measured in task 2.4 and reported on the ticket) it is a small fraction of that. The
cap is what makes the sweep unable to run away as the corpus grows: the bound is a constant, not a
function of N.

**Surfacing.** The pairs ride the existing `knowledgeHealthPass()` channel, which is the daemon's one
surface for "knowledge got worse and the curator should look": each pair contributes a
`duplicate:<aPath>#<n>~<bPath>#<m>` key to the compared signature, and the wake payload carries
`duplicatePairs` (both texts and both paths). A pair that persists does not re-wake; a new pair does.
No new tool and no new route is added — the curator (the conductor for workspace files, and whatever
it dispatches for a project) is reached exactly the way orphans and stale documents already reach it.
The sweep never edits anything, so a curator that ignores it changes nothing.

### D5 — A supersession is recorded on the revision, not injected into the file

`weave_knowledge_replace` gains an optional `supersedes: string[]` — the claims the replacement
corrects. `replace()` matches each against the entries of the file it is replacing (normalized
containment, so a distinctive fragment identifies the entry) and rejects the whole write naming any
claim that matches nothing; a supersession that cannot be resolved to a real entry would be a claim
about the record that the record cannot support. The matched original lines are stored on the new
revision in a new `superseded_entries_json` column (additive migration, `[]` default), and
`revisions()` returns them as `superseded: string[]`.

The replacement body is written exactly as supplied and the archive copy is unchanged, so this adds
provenance without touching content. "Visible to whoever reads the knowledge afterwards" is the
revision history: the existing `GET /:scope/revisions` route and the revision type in the UI carry
the superseded claims, so the record shows a corrected fact rather than a line disappearing. The
archive keeps the old line as it does today; the revision now says what the new content supersedes.

### D6 — The curator is told to use it

`weave_knowledge_replace`'s description and `skills/weave-ai-knowledge/references/curation.md` step
10 tell the curator to name the contradicted entries it replaced. Without that the field exists but
is never populated, which would satisfy the test and not the requirement.

## Risks

- **Never-read false positives.** A document that is intentionally reference-only (a rarely-read
  design note) will qualify after the window and ask for curation. Accepted: curation is a review,
  not a deletion, and the curator can leave it. The window is the dial.
- **Per-scope pairwise cost on a large workspace.** Bounded by the cap; the cap is reported, not
  silent, so a genuinely capped sweep is visible rather than mistaken for a clean one.
- **Supersession matching is textual.** A caller who paraphrases the old claim instead of quoting a
  distinctive fragment gets a `validation` rejection naming the claim; that is the intended failure —
  it is better than recording a supersession that does not correspond to anything.
- **No UI control for the new default.** It is settable through the workspace configuration
  (CLI/API) like every other default; the ticket asks for configurability, not a new settings
  control, and adding one would expand the change's surface.
