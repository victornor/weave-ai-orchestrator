## Context

VS-358 (merged, `openspec/changes/archive/2026-09-14-vs-358-a-project-can-opt-in-to-keeping-its-know/`) added `knowledgeRepo.enabled` (`packages/shared/src/config.ts`, `projects.knowledge_repo_enabled` column) and, for an opted-in project: a worktree-mirror write threaded through `KnowledgeService.write()` (`packages/core/src/knowledge/service.ts:223`), a `repoKnowledgePath` boundary helper (`packages/core/src/knowledge/files.ts:73`), and a merge-time reconciliation (`packages/core/src/knowledge/repoSync.ts`) called from `mergeDone` (`packages/core/src/tickets/service.ts:1228`, the `reconcileProjectKnowledgeFromRepo` call at line 1329) right after `landDelivery` succeeds, inside the existing per-project `serialize(project.id, ...)` critical section, using a `beforeSha`/`afterSha` pair captured just inside that section (lines 1257, 1328).

Ticket artifacts are unrelated storage: `ticket_documents` rows keyed `artifact:<key>` written by `putDocument` (`packages/core/src/tickets/service.ts:499`), with the `artifact:` prefix reserved to `weave_ticket_artifact_put`'s handler (`packages/server/src/tools.ts:657`), which also calls `putArtifactWorkProduct` (`tickets/service.ts:1177`) to record the `ticket_work_products` row the Work surface renders, and serves the body at `GET /:id/artifacts/:key/raw` (`packages/server/src/routes/tickets.ts:120`) behind `ARTIFACT_CSP` (`packages/server/src/artifact-csp.ts`). Unlike a knowledge hub file, an artifact document belongs to exactly one ticket — no other ticket ever writes `ticket_documents` rows for a different ticket's key — so none of VS-358's hardest problems (two tickets both editing one shared file, an out-of-ticket weaver write racing a ticket's write, a three-way entry merge) have an analogue here. `weave_artifact_put` (`tools.ts:684`, scope `weaver`) is a structurally separate handler writing only to `weaverArtifacts.put` (`packages/core/src/artifacts/service.ts`) — it never touches `tickets.putDocument` or any worktree, so "workspace artifacts never enter a repo" is true by construction, not by a check this change adds.

## Goals / Non-Goals

**Goals:**
- A worker's `weave_ticket_artifact_put` call for an opted-in project also lands the HTML (and title/kind) in the worktree, committed with the ticket's other changes.
- A landed change to that file — a human edit, a resolved conflict — becomes a new artifact revision the next time any ticket for that project lands, through the same `mergeDone` hook VS-358 already added.
- One boundary function is the only place a path may cross into `.weave/artifacts/**`.

**Non-Goals:**
- Any new config flag — `knowledgeRepo.enabled` is reused as-is (ticket's explicit instruction: raise a separate toggle with `weave_ask` rather than add one silently; nothing found while designing this argues for one).
- A three-way merge, a serializer, or a daemon-opened pull request for artifacts — there is no shared file and no out-of-ticket writer to race.
- Migrating an existing ticket's already-published artifacts into the repo, or a delete tool for a published artifact (VS-359 and a possible future ticket, respectively — out of scope per the ticket).
- Any change to the viewer, the CSP, or the raw-serving route.

## Decisions

### 1. The mirror write lives inside `putDocument`, not in the tool handler

`tools.ts`'s `weave_ticket_artifact_put` handler builds a small `mirror` input — `{ worktreePath, title, kind } | undefined` — the same way `mirrorTargetFor` (`tools.ts:106`) already does for knowledge, reusing the identical shape: `ctx.claims.agentKind === 'worker'`, `svc(ctx).workers.get(ctx.claims.agentId).worktreePath` set, and `svc(ctx).projects.get(ticket.projectId).knowledgeRepoEnabled` true. It does **not** compute a repo-relative path — that stays inside `putDocument`, which already knows both the ticket (and therefore its `identifier`) and the `artifact:<key>` being written, and is the one place trusted to call the boundary helper (Decision 2). This mirrors VS-358 Decision 3's split ("`write()` only does the mechanical part... it never decides *what* to mirror, only *whether* and *where*"), simplified because an artifact's `body` is always the caller's own complete HTML — never derived from shared ambient state the way `note()`'s hub append was, so there is no "compute against the worktree's own copy" step to add.

`putDocument`'s signature gains one optional field on its existing `opts`: `mirror?: { worktreePath: string; title?: string; kind?: string }`. It is threaded through only for the `artifact:`-prefixed path; the `plan`-digest write (the other `opts.system` caller) never sets it.

**Alternative considered:** compute the mirror body and path in `tools.ts` and pass a ready-made `{ absolutePath, body }` down, as a first pass at knowledge's design did before its own plan review flagged the equivalent shortcut. Rejected for the same reason VS-358 rejected it: it duplicates the boundary check outside `core` and makes it untestable from `core` alone.

### 2. `repoArtifactPath(identifier, key)` is the boundary helper, and it is deliberately trivial

Added to `packages/core/src/tickets/service.ts` (or a small sibling `packages/core/src/tickets/artifactFiles.ts` if the file is getting long) as:

```ts
function repoArtifactPath(identifier: string, key: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(key)) {
    throw new OcError('internal', `artifact key ${key} is not the shape weave_ticket_artifact_put already validated; refusing to write it into a repo`, { key });
  }
  return `${identifier}/${key}`;
}
```

`identifier` is `t.identifier` (`ticket.get(id).identifier`), read by `putDocument` itself — never a value the caller supplies as a path — so there is no way to reach this function with any ticket's identifier other than the one actually being published on. The `key` re-check is defense in depth against internal misuse (the tool's own Zod schema already enforces the same pattern before `putDocument` is ever called); it is not meant to catch a real caller today, only to make a future internal caller fail loudly instead of writing outside the per-ticket directory. This is the single place `repo-write-boundary`'s "internal misuse" scenario is tested against directly.

`repoArtifactPath` is called, and can throw, **before `tx(db, ...)` opens** — the same "refuse the whole write, record nothing" treatment the secret check (Decision 3, below) gets, not the "log and continue" treatment a genuine filesystem failure gets. A boundary violation and an I/O error are different in kind: the former means a caller reached this function with a value real input can never produce, and should fail loudly; the latter is an ordinary environment hiccup after the DB write already has to be considered committed. The actual filesystem write happens inside the transaction, right after the document/revision rows are written — the same placement knowledge's `write()` already uses for its own mirror write — using the already-computed path:

```ts
const mirrorRel = key.startsWith('artifact:') && opts?.mirror ? repoArtifactPath(t.identifier, key.slice('artifact:'.length)) : null;
const written = tx(db, () => {
  // ...document/revision rows...
  if (mirrorRel !== null && opts?.mirror) {
    try {
      const dir = join(opts.mirror.worktreePath, '.weave', 'artifacts', dirname(mirrorRel));
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(opts.mirror.worktreePath, '.weave', 'artifacts', `${mirrorRel}.html`), body);
      writeFileSync(join(opts.mirror.worktreePath, '.weave', 'artifacts', `${mirrorRel}.meta.json`), JSON.stringify({ title: opts.mirror.title ?? null, kind: opts.mirror.kind ?? null }, null, 2) + '\n');
    } catch (e) {
      // disk full, permission — logged, not thrown; see below.
    }
  }
  // ...
});
```

A mirror **I/O** failure (disk full, permission) is logged, not thrown — the DB write already succeeded and is the tool's documented contract, exactly the same trade-off VS-358's design.md Risks section already accepted for knowledge.

**Alternative considered:** namespace by ticket **id** (the ULID) instead of `identifier` (e.g. `ACME-42`), since an id never changes while a ticket's identifier is assigned once and stable but less obviously so than the id. Rejected: the ticket's own proposed layout (`.weave/artifacts/<TICKET-IDENTIFIER>/<key>.html`) names the identifier explicitly, it is what a human reviewing the repo actually recognizes, and identifiers are immutable once assigned (`createTicket` assigns `identifier` once, never reassigned).

### 3. The secret check runs before the transaction, gated on `mirror` being set, not on every project

`putDocument` tests `body` against `SECRET_SHAPED_RE` (the export VS-358 already added to `packages/core/src/knowledge/files.ts:44`) immediately after the existing `key.startsWith('artifact:')` guard, and only when `opts?.mirror` is present — i.e., only on the path that would otherwise commit the HTML into a repo:

```ts
if (key.startsWith('artifact:') && opts?.mirror && SECRET_SHAPED_RE.test(body)) {
  throw new OcError('validation', 'artifact body looks like it contains a secret; refusing to publish it', { key });
}
```

This throws before `tx(db, ...)` opens, so — matching `putDoc`'s existing refusal shape — nothing is recorded: not the ticket document, not the work product, not the mirror.

**Why gated on `mirror`, unlike VS-358's `note()` check (which applies to every project):** the ticket's own wording asks for the refusal "before writing an artifact into a repo," not "in every project," and the two stores differ in what already happens to their content — a knowledge note is written straight to a markdown file no human necessarily reviews before search/budgets/curation index it, while an artifact is already reviewed by a human as untrusted, sandboxed content (CSP, `sandbox` iframe attribute, `default-src 'none'`) before it is ever rendered, for every project, opted in or not. Extending the same regex check to every project's artifact would be a second, independent safety improvement the ticket did not ask for and that changes behavior for every project regardless of this feature; scoping it to the repo-write path keeps this change's behavior change limited to what opting in actually turns on. Flagged for the weaver in case this reading is too narrow, but treated as a judgement call inside the accepted design rather than a `weave_ask`, since the ticket's phrasing already draws the line this way.

### 4. Reconciliation is a new function, called from the same `mergeDone` site as knowledge's, keyed by "does the landed body differ from what's stored"

Added `packages/core/src/tickets/artifactRepoSync.ts`:

```ts
export interface ChangedArtifactPath { ticketIdentifier: string; key: string; status: 'added' | 'modified' | 'deleted' }

export async function changedArtifactPaths(clonePath: string, beforeSha: string, afterSha: string): Promise<ChangedArtifactPath[]>
export async function reconcileProjectArtifactsFromRepo(
  ctx: WorkspaceContext, deps: () => CoreServices, project: Project, beforeSha: string, afterSha: string,
): Promise<void>
```

`changedArtifactPaths` is `changedKnowledgePaths` (`knowledge/repoSync.ts:20`)'s shape, diffing `.weave/artifacts/` instead, and parsing each changed relative path as `<ticketIdentifier>/<key>.html` (a change to only the `.meta.json` sibling is folded into the same entry — both are read together below); a path that does not match that two-segment `*.html` shape is ignored (not every file under the tree need be an artifact — a stray file a human added is simply not this scheme's concern).

`reconcileProjectArtifactsFromRepo`, called from `mergeDone` immediately after the existing knowledge reconciliation call (`tickets/service.ts:1329`), gated on the same `p.knowledgeRepoEnabled && beforeSha` condition and given the same `beforeSha`/`afterSha` pair — no second `git rev-parse` needed, since both reconciliations run inside the same critical section against the same before/after state.

**In-flight collision note (plan review, 2026-09-14):** three other tickets touch the same neighborhood at apply time — VS-389 also edits `mergeDone` in `tickets/service.ts` (an archive-backfill result plus an archive-landing path), VS-383 changes the scratch-worktree helpers this design's siblings (knowledge's `repoSync.ts`) already reuse, and VS-359 adds `repoSwitch.ts`. Rebase onto whichever of these has landed first when apply starts, and keep the new artifact-reconcile call positioned immediately next to the existing knowledge-reconcile call (both inside the same `try`, both reading the same `beforeSha`/`afterSha`) so the two stay easy to find as a pair regardless of what else has moved around them in the interim.

```ts
if (p.knowledgeRepoEnabled && beforeSha) {
  try {
    const afterSha = ...; // already computed for knowledge
    if (afterSha && afterSha !== beforeSha) {
      await reconcileProjectKnowledgeFromRepo(ctx, deps, p, beforeSha, afterSha, t.id);
      await reconcileProjectArtifactsFromRepo(ctx, deps, p, beforeSha, afterSha);
    }
  } catch (e) { /* unchanged: logged, never blocks the landing */ }
}
```

For each changed `{ ticketIdentifier, key, status }`:
- `deps().tickets.find(ticketIdentifier)` (the existing `find()`, `tickets/service.ts:157`, already resolves by identifier scoped to the workspace). If it returns `null`, or the found ticket's `projectId` is not this `project.id`, log and skip (`repo-write-boundary`/`merge-sync`'s "unresolved ticket" case — a landed path naming a ticket from a different project can happen only via a hand-crafted commit, since the mirror write in Decision 1 can never produce one, but reconciliation still must not guess).
- `status === 'deleted'`: log and skip — there is no delete capability for a published artifact today (Non-Goal), so a deletion in the repo is left exactly as the stored artifact already is.
- Otherwise, read the landed body with `git show afterSha:.weave/artifacts/<ticketIdentifier>/<key>.html` (mirroring `showAt`, `knowledge/repoSync.ts:35`) and, if present, the landed metadata the same way. Validate the landed body with the same rules `validateArtifactHtml` (`tools.ts:262`) already applies — non-empty, contains `<html`, under `ARTIFACT_MAX_CHARS` — logging and skipping (not throwing) on failure, per the "never touches an oversized or malformed landed body" requirement.
- Compare against **every already-stored revision of that document**, not only the current one: `SELECT body FROM ticket_document_revisions WHERE document_id = ?` for the `artifact:<key>` document (`tickets/service.ts` already resolves `ticket_documents`→`id` this way for `getDocument`/`documentRevisions`; this is an internal service/SQL call, not the agent-facing "no read-back" tool restriction, which exists to stop an *agent* reading its own artifact back, not to stop the daemon's own reconciliation code). Three outcomes:
  - The landed body matches the **current** revision's body — the overwhelmingly common case, since the file the worker just committed *is* what `putDocument` already stored. No-op: no new revision, no wasted write.
  - The landed body matches an **older, non-current** revision's body, but not the current one — a **stale-commit revert**: a worker published `v2` (updating the DB row and, separately, its own working copy of the mirror file) but the commit that actually reached the landing branch still carries `v1`'s bytes, because the mirror file was never re-added/committed after the second publish (VS-358's identical mirror-write shape has the same "the tool wrote the file; nothing forces `git add` on it" property, but for a shared hub file a later write's entry-append made this self-correcting — an artifact's whole-file replace does not). Applying `v1` here would silently revert the stored artifact from `v2` back to `v1`. Skip and log it as a stale landing; record nothing.
  - The landed body matches **no** stored revision at all — genuinely new content (a human edited the file directly, or a conflict was resolved to a merged result). Call `tickets.putDocument(SYSTEM, ticket.id, \`artifact:${key}\`, landedBody, { system: true })` to record it as a new revision, and `tickets.putArtifactWorkProduct(SYSTEM, ticket.id, key, { url: existingUrl, title: landedMeta?.title, kind: landedMeta?.kind })` to refresh title/kind — reusing exactly the same two methods the tool itself calls, so indexing, activity and the Work surface pick this up with no new code path.

**Why compare against every stored revision instead of anchoring on `ticket_documents`' own revision history the way knowledge's `safeToApply` anchors on `knowledge_revisions.ticket_id`/`revision` (design.md Decision 6 of VS-358):** that anchor exists in knowledge to answer "did some *other*, more recent writer already move past this landing's content" — a real question when many tickets and the weaver all write one shared file over time. An artifact's `ticket_documents` row is written by exactly one ticket, ever, so there is no *other* writer to guard against — but there is a single-writer hazard knowledge's per-ticket anchor doesn't have to consider: the same ticket publishing twice, with the mirror commit lagging the DB write (plan review, 2026-09-14). Comparing against the full revision list, not just the current one, is what turns that lag into a detectable "stale" case instead of a silent revert, while still keeping the check as simple as a byte comparison — no timestamps, no ticket-id anchoring, since every revision here already belongs to the one ticket in question.

**Alternative considered:** skip reconciliation entirely for `ticketIdentifier === <the ticket that is currently landing>`, on the theory that this landing's own artifacts were already recorded by the tool during the ticket's own turn. Rejected: it would also skip the one case worth catching — a human editing the artifact in the same PR, after the worker's last publish but before merge — and the revision-history comparison above already makes both the ordinary case and the stale-lag case correct without needing to special-case which ticket is landing.

### 4a. The worker-side gap this guards against is a delivery-hygiene issue, not a new check

The stale-commit case above can only happen if a worker's worktree has an uncommitted (or committed-but-unpushed) change to `.weave/artifacts/**` at the moment it delivers — already a violation of the existing "leave nothing untracked, `git status --porcelain` must be empty before requesting review" worker discipline every ticket already operates under. This change adds no new mechanism for it: `weave_worktree_status`'s existing `dirty`/`changedFiles` reporting already surfaces an uncommitted mirror file the same way it surfaces any other uncommitted file. Task 1.4/1.2's implementation note (below) calls this out explicitly so it is not missed by habit, since a mirror write happens as a side effect of a tool call rather than a worker's own `Write`/`Edit`, which is easy to forget to `git add`.

### 5. No new URL scheme; `getDocument`'s existing revision number is what changes

Reconciliation never constructs a new artifact URL — `putArtifactWorkProduct`'s existing `url` field already exists on the work product row from the tool's first publish (`/api/w/<wsId>/tickets/<ticketId>/artifacts/<key>/raw`, `tools.ts:672`) and is passed straight through unchanged; only `title`/`kind` and the underlying document's revision change. The raw route (`routes/tickets.ts:120`) already serves whatever the current revision is, so a reconciled artifact renders through the exact same sandboxed path with no route change.

## Risks / Trade-offs

- **A mirror write fails after the DB write already succeeded** (disk full, permission) → logged, not thrown, matching the tool's documented contract and VS-358's identical trade-off for knowledge; a worker's own `git status` before delivering surfaces the discrepancy.
- **A landed artifact file is larger than `ARTIFACT_MAX_CHARS` because it was hand-edited in the repo without going through the tool** → reconciliation validates the landed body with the same rules the tool applies and skips (logged) rather than recording an oversized revision — covered by the "malformed landed body" scenario.
- **A changed path's ticket identifier collides with a real ticket in a different project** (a human copy-pasting a directory name) → the project-membership check in Decision 4 refuses to apply it, logged as skipped — covered by `repo-write-boundary`'s and `merge-sync`'s "unresolved ticket" scenarios.
- **The secret check is scoped to opted-in projects only, not every project like knowledge's** → accepted per Decision 3's reasoning (artifacts are already reviewed, sandboxed, untrusted content on every project); flagged in this design rather than silently narrowed.
- **No delete path for a repo-side artifact removal** → accepted Non-Goal; a human deleting the file leaves the stored artifact and its last revision exactly as they were, which is a safe default (nothing disappears unexpectedly) rather than a data-loss risk.

## Migration Plan

Purely additive: no schema change, no new config field, nothing that touches an opted-out project's behavior. Rollback is a plain revert of the code — the tool's DB write and the existing knowledge reconciliation are both unaffected by removing the artifact mirror/reconcile calls.
