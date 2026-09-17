## Why

The daemon already records two signals it never acts on. `KnowledgeUsageService.neverRead()` knows, from real read events, which documents nobody has opened; the curation decision ignores it and judges staleness from write-recency and orphan links alone. `note()` already rejects a near-duplicate entry at write time with a bigram Dice similarity check, but nothing ever compares existing entries with each other, so two notes that drifted together over months are never surfaced. And when curation rewrites a contradicted entry through `weave_knowledge_replace`, the old line is archived but the record never says the new claim supersedes it — the fact looks quietly dropped rather than corrected. VS-487's survey named these three as the cheap half of its design: use what is already collected, before adding any new dependency.

## What Changes

- **Never-read documents become a curation input.** A document that no run has read within a configurable window feeds both the curation trigger and the knowledge health view. A document read recently is not flagged. The window is a workspace setting with a stated default, not a hidden constant.
- **A bounded duplicate-entry sweep is added.** The existing `similarity()` function and the existing 0.8 threshold are reused to compare existing entries within a scope, not just a new entry against old ones. The sweep only reports likely-duplicate pairs to the curator; it never edits or deletes anything. Its cost is bounded by a hard entry cap so it cannot grow without limit.
- **A curated replacement can record what it supersedes.** `weave_knowledge_replace` takes an optional list of the claims it replaces; the revision records them, so reading the history shows the fact was corrected rather than removed. The archived copy remains exactly as it is today.
- **Existing triggers are unchanged.** Budget, age and orphan-link behaviour, the curation contract ("never add a fact") and every knowledge file's content are untouched by all of the above.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `knowledge/scheduled-curation`: adds never-read documents as a curation condition (with a configurable window), adds a bounded periodic duplicate-entry sweep whose pairs are surfaced without any file being edited, and adds the evidence each carries into the log and the conductor wake.
- `knowledge/health`: adds the never-read measure to the health view's set of measures and to what a worsened-health wake reports, on the same read-derived basis as the existing measures.
- `knowledge/provenance`: adds the requirement that a curated replacement that supersedes specific claims records them, and that the record is visible wherever a revision's history is read.

## Impact

- `packages/core/src/knowledge/usage.ts` — `neverRead()` accepts an explicit lower bound (a window in days) so callers other than the usage view can ask "unread since".
- `packages/core/src/knowledge/service.ts`, `files.ts` — the health view gains the never-read measure; a bounded `duplicates()` sweep over entries within a scope; `replace()` records supersessions.
- `packages/core/src/supervisor/index.ts` — the curation pass treats a never-read document as a trigger; the knowledge-health pass includes the never-read measure and the duplicate pairs in its signature and wake.
- `packages/core/src/api.ts` — `KnowledgeHealth` gains `neverRead`; the knowledge service gains `duplicates()`; `replace()` and `revisions()` gain the supersession field.
- `packages/shared/src/config.ts` — the never-read window default (`knowledgeNeverReadDays`).
- `packages/server/src/tools.ts` — `weave_knowledge_replace` accepts `supersedes`.
- `packages/db/src/migrations/` — one additive migration for the supersession column on `knowledge_revisions`.
- `packages/ui/src/api/types.ts` — the health and revision types follow.
- `skills/weave-ai-knowledge/` — the curation procedure tells the curator to name what it supersedes.
- No knowledge file content is edited, no budget constant changes, and no new dependency is added.
