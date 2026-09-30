import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, appendFileSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { knowledgeRow, newId, nowIso, type Db } from '@weave-ai/db';
import {
  estimateTokens, OcError, projectLabel, sliceToTokens,
  type Decision, type KnowledgeRevisionReason, type KnowledgeScope,
} from '@weave-ai/shared';
import type { Actor, CoreServices, KnowledgeBootstrapPart, KnowledgeDocDetail, KnowledgeDocSummary, KnowledgeDuplicateEntry, KnowledgeDuplicatePair, KnowledgeMirror, KnowledgeService, KnowledgeUsageService } from '../api.js';
import type { WorkspaceContext } from '../context.js';
import { recordActivity } from '../events.js';
import { requestKnowledgeRepoPr } from './repoDelivery.js';
import { createEmbeddingIndex, type EmbeddingIndexOptions } from './embeddings.js';
import { tx } from '../tickets/tx.js';
import {
  CURATION_BUDGET_FRACTION, CURATION_MIN_INTERVAL_MS, DOCUMENT_STALE_MS, DUPLICATE_THRESHOLD, EXPIRY_RE, MAX_DUPLICATE_ENTRIES, MAX_DUPLICATE_PAIRS, SECRET_SHAPED_RE, appendEntry, budgetOf, countWords, docFolderOf, docPathFor, docSlugOf, docSummary, docTitle, entriesOf, findSection, isDuplicateCandidate, isHubSectionPointer, isRedirectStub,
  isDocPath, isHubStub, normalize, parseDoc, parseLinks, readMirrorFile, relPathFor, renderDoc, repoKnowledgePath, sectionSizes, seedBody, sha256, similarity, today, withBudgetStated, type Entry,
} from './files.js';

/** VS-358: `write()`'s own mirror parameter — the target plus the fully-computed content to write there. */
type MirrorWrite = KnowledgeMirror & { body: string };

interface FileRow {
  id: string; workspaceId: string; projectId: string | null; path: string; scope: KnowledgeScope;
  tokenEstimate: number; budgetTokens: number; lastCuratedAt: string | null; curationPending: boolean; hash: string; updatedAt: string;
}
interface ProjectRow { id: string; slug: string; name: string }

const SYSTEM: Actor = { kind: 'system', id: null };

export function createKnowledgeService(ctx: WorkspaceContext, deps: () => CoreServices, embeddingOptions: EmbeddingIndexOptions = {}): KnowledgeService {
  const db: Db = ctx.db;
  const log = ctx.log('knowledge');
  const ws = ctx.workspaceId;
  // VS-493: constructed but inert — neither the sqlite-vec extension nor the model is loaded until
  // the first semanticSearch/backfillEmbeddings call, and nothing on the turn path calls them.
  const embeddings = createEmbeddingIndex(ctx, embeddingOptions);

  // ---------- file plumbing ----------

  function projectOf(projectId?: string | null): ProjectRow {
    if (!projectId) throw new OcError('validation', 'the project knowledge scope needs a project id');
    const p = db.get<ProjectRow>('SELECT id, slug, name FROM projects WHERE workspace_id = ? AND (id = ? OR slug = ?)', [ws, projectId, projectId]);
    if (!p) throw new OcError('not_found', `project ${projectId} not found`);
    return p;
  }

  function locate(scope: KnowledgeScope, projectId?: string | null): { rel: string; abs: string; projectRowId: string | null; projectName: string | null } {
    if (scope === 'project') {
      const p = projectOf(projectId);
      const rel = relPathFor(scope, p.slug);
      return { rel, abs: join(ctx.paths.knowledge, rel), projectRowId: p.id, projectName: projectLabel(p) };
    }
    const rel = relPathFor(scope);
    return { rel, abs: join(ctx.paths.knowledge, rel), projectRowId: null, projectName: null };
  }

  function fileRow(rel: string): FileRow | null {
    const r = db.get<Record<string, unknown>>('SELECT * FROM knowledge_files WHERE workspace_id = ? AND path = ?', [ws, rel]);
    return r ? (knowledgeRow(r) as unknown as FileRow) : null;
  }

  /**
   * The budget this file is held to. The workspace config is the source of truth, not the value
   * `knowledge_files.budget_tokens` was created with: a budget the human changes has to bite on the
   * next write, in every workspace, without a restart.
   */
  function budgetFor(scope: KnowledgeScope, path?: string): number {
    return budgetOf(ctx.config.defaults.knowledgeBudgetTokens, scope, path ? isDocPath(path) : false);
  }
  function budgetOfRow(row: FileRow): number {
    return budgetFor(row.scope, row.path);
  }

  function currentRevision(fileId: string): number {
    return db.get<{ r: number }>('SELECT COALESCE(MAX(revision),0) r FROM knowledge_revisions WHERE file_id = ?', [fileId])?.r ?? 0;
  }

  function readBody(abs: string): string {
    return existsSync(abs) ? readFileSync(abs, 'utf8') : '';
  }

  /** Ensure the file exists on disk and in the db, and pick up out-of-band human edits. */
  function ensure(scope: KnowledgeScope, projectId?: string | null): { row: FileRow; abs: string; body: string } {
    const { rel, abs, projectRowId, projectName } = locate(scope, projectId);
    let row = fileRow(rel);
    let body = readBody(abs);
    if (!existsSync(abs)) {
      body = seedBody(scope, { workspaceName: ctx.config.name, projectName: projectName ?? undefined, budgetTokens: budgetFor(scope, rel) });
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, body, 'utf8');
    }
    if (!row) {
      const id = newId();
      db.insert('knowledge_files', {
        id, workspaceId: ws, projectId: projectRowId, path: rel, scope, tokenEstimate: estimateTokens(body),
        budgetTokens: budgetFor(scope, rel), lastCuratedAt: null, curationPending: false, hash: sha256(body), updatedAt: nowIso(),
      });
      db.insert('knowledge_revisions', {
        id: newId(), fileId: id, revision: 1, body, authorKind: 'system', authorId: null, runId: null, reason: 'seed',
        removedEntriesJson: [], createdAt: nowIso(),
      });
      row = fileRow(rel)!;
      indexFile(row, body);
    } else if (row.hash !== sha256(body)) {
      // Edited outside the daemon: record a revision so nothing is lost and re-check the budget.
      const revision = currentRevision(row.id) + 1;
      db.insert('knowledge_revisions', {
        id: newId(), fileId: row.id, revision, body, authorKind: 'human', authorId: null, runId: null, reason: 'human',
        removedEntriesJson: [], createdAt: nowIso(),
      });
      const tokens = estimateTokens(body);
      db.update('knowledge_files', row.id, {
        tokenEstimate: tokens, hash: sha256(body), curationPending: tokens > budgetOfRow(row) * CURATION_BUDGET_FRACTION, updatedAt: nowIso(),
      });
      row = fileRow(rel)!;
      indexFile(row, body);
    }
    // The count column carries a byte-ratio leftover until this recomputes it, and the budget column
    // mirrors the configured budget: both are refreshed when they disagree, so events, the API,
    // health and the supervisor read numbers the tokenizer produced. `updatedAt` is left alone on a
    // pure recount — it is the staleness reference for a file that was never curated.
    const tokens = estimateTokens(body);
    const budget = budgetOfRow(row);
    const patch: Record<string, unknown> = {};
    if (row.tokenEstimate !== tokens) patch.tokenEstimate = tokens;
    if (row.budgetTokens !== budget) { patch.budgetTokens = budget; patch.updatedAt = nowIso(); }
    if (Object.keys(patch).length) {
      db.update('knowledge_files', row.id, patch);
      row = fileRow(rel)!;
    }
    return { row, abs, body };
  }

  function indexSearch(row: FileRow, body: string): void {
    db.run("DELETE FROM knowledge_search WHERE kind = 'knowledge' AND ref = ?", [row.path]);
    db.run('INSERT INTO knowledge_search (kind, project_id, ref, title, body) VALUES (?,?,?,?,?)', [
      'knowledge', row.projectId ?? '', row.path, titleOf(body) ?? row.path, body,
    ]);
  }

  function indexFile(row: FileRow, body: string): void {
    indexSearch(row, body);
    indexLinks(row, body);
  }

  // ---------- linked documents ----------

  /**
   * The one place a document's slug is resolved to its actual path within a single scope (+
   * project), searching every folder it could be filed in rather than computing the one path it
   * used to be forced to sit at (VS-265). Returns `null` when no document of that slug exists there.
   */
  function findDocPath(scope: KnowledgeScope, slug: string, projectRowId?: string | null): string | null {
    const rows = projectRowId
      ? db.all<{ path: string }>('SELECT path FROM knowledge_files WHERE workspace_id = ? AND scope = ? AND project_id = ?', [ws, scope, projectRowId])
      : db.all<{ path: string }>('SELECT path FROM knowledge_files WHERE workspace_id = ? AND scope = ? AND project_id IS NULL', [ws, scope]);
    for (const r of rows) if (docSlugOf(r.path) === slug) return r.path;
    return null;
  }

  /**
   * A [[slug]] resolves within the file's own scope first, then to a shared document — the scope
   * fallback is `resolveLink`'s own loop, not pushed down into `findDocPath` (single-scope by
   * design), or a project-to-shared link silently stops resolving (VS-265 plan review).
   */
  function resolveLink(row: FileRow, slug: string): string | null {
    const candidates: Array<{ scope: KnowledgeScope; projectRowId?: string | null }> = [];
    if (row.scope === 'project' && row.projectId) candidates.push({ scope: 'project', projectRowId: row.projectId });
    if (row.scope === 'workspace' || row.scope === 'decisions') candidates.push({ scope: 'workspace' });
    candidates.push({ scope: 'shared' });
    for (const c of candidates) {
      const hit = findDocPath(c.scope, slug, c.projectRowId);
      if (hit) return hit;
    }
    return null;
  }

  function indexLinks(row: FileRow, body: string): void {
    db.run('DELETE FROM knowledge_links WHERE workspace_id = ? AND from_path = ?', [ws, row.path]);
    for (const slug of parseLinks(body)) {
      db.run('INSERT OR REPLACE INTO knowledge_links (workspace_id, from_path, to_slug, to_path) VALUES (?,?,?,?)', [ws, row.path, slug, resolveLink(row, slug)]);
    }
    // Links from other files that pointed at this slug by name now resolve.
    const slug = docSlugOf(row.path);
    if (slug) db.run('UPDATE knowledge_links SET to_path = ? WHERE workspace_id = ? AND to_slug = ? AND to_path IS NULL', [row.path, ws, slug]);
  }

  function backlinksOf(path: string): Array<{ path: string; slug: string | null; title: string | null }> {
    return db.all<{ fromPath: string }>('SELECT from_path FROM knowledge_links WHERE workspace_id = ? AND to_path = ?', [ws, path]).map((l) => ({
      path: l.fromPath, slug: docSlugOf(l.fromPath),
      title: db.get<{ title: string }>("SELECT title FROM knowledge_search WHERE kind = 'knowledge' AND ref = ?", [l.fromPath])?.title ?? null,
    }));
  }

  function projectSlugOf(projectId: string | null): string | null {
    return projectId ? db.get<{ slug: string }>('SELECT slug FROM projects WHERE id = ?', [projectId])?.slug ?? null : null;
  }

  function docSummaryOf(row: FileRow, body: string): KnowledgeDocSummary {
    return {
      path: row.path, scope: row.scope, projectId: row.projectId, projectSlug: projectSlugOf(row.projectId), slug: docSlugOf(row.path) ?? row.path,
      folder: docFolderOf(row.path),
      title: docTitle(body) ?? docSlugOf(row.path) ?? row.path, summary: docSummary(body), tokenEstimate: row.tokenEstimate, budgetTokens: budgetOfRow(row),
      links: db.get<{ n: number }>('SELECT COUNT(*) n FROM knowledge_links WHERE workspace_id = ? AND from_path = ?', [ws, row.path])?.n ?? 0,
      backlinks: db.get<{ n: number }>('SELECT COUNT(*) n FROM knowledge_links WHERE workspace_id = ? AND to_path = ?', [ws, row.path])?.n ?? 0,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * Resolve a document by slug first (wherever its folder placed it); only when none exists yet
   * does a `folder` argument (the create case) or the flat path (no folder involved) decide where
   * it goes (VS-265).
   */
  function locateDoc(scope: KnowledgeScope, slug: string, projectId?: string | null, folder?: string | null): { rel: string; abs: string; projectRowId: string | null } {
    const p = scope === 'project' ? projectOf(projectId) : null;
    const projectRowId = p?.id ?? null;
    const rel = findDocPath(scope, slug, projectRowId) ?? docPathFor(scope, slug, p?.slug, folder);
    return { rel, abs: join(ctx.paths.knowledge, rel), projectRowId };
  }

  /** A document `note()` can append to: it must already exist — a bare append cannot invent a `# Title`. */
  function ensureDoc(scope: KnowledgeScope, slug: string, projectId?: string | null): { row: FileRow; abs: string; body: string } {
    const { rel, abs } = locateDoc(scope, slug, projectId);
    const row = fileRow(rel);
    if (!row || !existsSync(abs)) {
      throw new OcError('not_found', `document ${slug} does not exist in the ${scope} scope; create it first with weave_knowledge_doc_put`);
    }
    return { row, abs, body: readBody(abs) };
  }

  function titleOf(body: string): string | null {
    const m = /^#\s+(.+)$/m.exec(body);
    return m ? m[1]!.trim() : null;
  }

  /** VS-358: `mirror` (just a target) plus a lazily-computed body → `write()`'s own `MirrorWrite`, or `undefined` when there is no mirror target. `computeBody` is not called at all when `mirror` is absent. */
  function mirrorFor(mirror: KnowledgeMirror | undefined, computeBody: () => string): MirrorWrite | undefined {
    return mirror ? { worktreePath: mirror.worktreePath, projectSlug: mirror.projectSlug, body: computeBody() } : undefined;
  }

  /** Persist a new body: revision row, file row, disk, FTS. Returns the new revision number. */
  function write(
    actor: Actor,
    row: FileRow,
    abs: string,
    next: string,
    reason: KnowledgeRevisionReason,
    removed: string[] = [],
    mirror?: MirrorWrite,
    /**
     * VS-358 (plan review round 2): what an out-of-ticket write commits to the repo, applied against
     * that branch's *own* current copy of the file — never the shared workspace `body` computed
     * below, which (for `note()`) may already carry another ticket's still-unmerged entry on the same
     * hub or document. Defaults to the workspace body verbatim, correct for `putDoc`/`replace`, whose
     * content was never derived from ambient workspace state in the first place.
     */
    repoBody?: (current: string) => string,
    /** VS-492: the entries of the pre-replacement file this revision supersedes, matched originals. */
    superseded: string[] = [],
  ): number {
    const budget = budgetOfRow(row);
    const body = isDocPath(row.path) ? next : withBudgetStated(next, budget);
    // Provenance (VS-102): which ticket this write came from, resolved from the run rather than the
    // actor — a ticket is a property of this particular run (`runs.ticket_id`), not of who is calling.
    // A human or system write has no run and records no ticket.
    const ticketId = actor.runId ? db.get<{ ticketId: string | null }>('SELECT ticket_id FROM runs WHERE id = ?', [actor.runId])?.ticketId ?? null : null;
    const newRevision = tx(db, () => {
      const revision = currentRevision(row.id) + 1;
      const tokens = estimateTokens(body);
      db.insert('knowledge_revisions', {
        id: newId(), fileId: row.id, revision, body, authorKind: actor.kind, authorId: actor.id, runId: actor.runId ?? null,
        ticketId, reason, removedEntriesJson: removed, supersededEntriesJson: superseded, createdAt: nowIso(),
      });
      const patch: Record<string, unknown> = { tokenEstimate: tokens, hash: sha256(body), budgetTokens: budget, updatedAt: nowIso() };
      if (reason === 'curation') { patch.lastCuratedAt = nowIso(); patch.curationPending = false; }
      else patch.curationPending = tokens > budget * CURATION_BUDGET_FRACTION;
      db.update('knowledge_files', row.id, patch);
      // A curation run is asked for a whole scope, not for one file. The curator rewrites the hub
      // file, so a flag left on a linked document it did not touch would ask for the same run again
      // tomorrow, and every day after that (VS-67).
      if (reason === 'curation') {
        // VS-732: a curation covers the scope, so it also resets the scope's staleness reference —
        // the file the curator rewrote and every other file in the scope. Without this, every
        // document the curator did not rewrite re-qualified as stale on the next sweep. The interval
        // is measured from the last request *or* this completion, so a run that stayed open past the
        // interval still holds the scope for a full interval after it finished.
        db.run(
          'UPDATE knowledge_files SET curation_pending = 0, last_curated_at = ? WHERE workspace_id = ? AND scope = ? AND project_id IS ? AND id <> ?',
          [nowIso(), ws, row.scope, row.projectId, row.id],
        );
        stampCuration(row.scope, row.projectId);
      }
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, body, 'utf8');
      if (mirror) {
        // VS-358: the mechanical half only — `mirror.body` is already this call's own, fully
        // computed content; `repoKnowledgePath` is the single enforcement point that refuses
        // anything outside this project's own `projects/<projectSlug>/**`.
        const mirrorRel = repoKnowledgePath(row.path, mirror.projectSlug);
        const mirrorAbs = join(mirror.worktreePath, '.weave', 'knowledge', mirrorRel);
        mkdirSync(dirname(mirrorAbs), { recursive: true });
        writeFileSync(mirrorAbs, mirror.body, 'utf8');
      }
      const fresh = fileRow(row.path)!;
      indexFile(fresh, body);
      recordActivity(db, ws, actor, 'knowledge.write', 'knowledge_file', row.id, { path: row.path, reason, revision, tokens });
      ctx.events.emit(reason === 'curation' ? 'knowledge.curated' : 'knowledge.updated', 'knowledge_file', row.id, {
        path: row.path, scope: row.scope, projectId: row.projectId, revision, tokenEstimate: tokens, budgetTokens: budget,
      });
      return revision;
    });
    fireKnowledgeRepoPr(actor, row, ticketId, repoBody ?? (() => body));
    return newRevision;
  }

  /**
   * VS-358: an out-of-ticket write (no `ticketId` — a weaver edit, or a human editing directly
   * through the HTTP route) to an opted-in project's own scope gets a daemon-managed pull request,
   * fired and forgotten so a forge outage or a slow push never delays the write itself. Routine
   * daemon-internal writes (`system` actor: seeding, expiry pruning, merge-sync reconciliation) are
   * excluded — they are not a deliberate edit and already have their own path to the repo, or none.
   */
  function fireKnowledgeRepoPr(actor: Actor, row: FileRow, ticketId: string | null, computeBody: (current: string) => string): void {
    if (actor.kind === 'system' || ticketId || row.scope !== 'project' || !row.projectId) return;
    let project: ReturnType<CoreServices['projects']['get']>;
    try { project = deps().projects.get(row.projectId); } catch (e) { log.warn({ err: e, projectId: row.projectId }, 'out-of-ticket knowledge write: project lookup failed'); return; }
    if (!project.knowledgeRepoEnabled) return;
    const repoRel = repoKnowledgePath(row.path, project.slug);
    void requestKnowledgeRepoPr(ctx, deps, project, repoRel, computeBody)
      .catch((e: unknown) => log.warn({ err: e, project: project.slug, path: row.path }, 'out-of-ticket knowledge pull request failed'));
  }

  function archiveEntries(row: FileRow, abs: string, removed: string[], reason: string): void {
    if (!removed.length) return;
    const archive = join(dirname(abs), 'archive', `${today()}.md`);
    mkdirSync(dirname(archive), { recursive: true });
    const block = [`\n<!-- removed from ${row.path} at ${nowIso()} (${reason}) -->`, ...removed.map((l) => l.trimEnd())].join('\n') + '\n';
    appendFileSync(archive, block, 'utf8');
  }

  /**
   * `archiveEntries` writes next to whatever file it archived from — a project's hub or, for a
   * deleted document, that document's own (possibly foldered) directory — so there is no single
   * archive directory per scope. `workspace`/`shared`/`decisions` hubs all sit in `workspace/`
   * anyway, so their archives are already one tree; project scope roots at that project (VS-265).
   */
  function archiveRootFor(scope: KnowledgeScope, projectId?: string | null): { rootRel: string; rootAbs: string } {
    const rootRel = scope === 'project' ? `projects/${projectOf(projectId).slug}` : 'workspace';
    return { rootRel, rootAbs: join(ctx.paths.knowledge, rootRel) };
  }

  /** Every dated archive file under a scope's root, most recent first (VS-265). Read-only; never indexed or linkable. */
  function listArchive(scope: KnowledgeScope, projectId?: string | null): Array<{ path: string; date: string }> {
    const { rootRel, rootAbs } = archiveRootFor(scope, projectId);
    const out: Array<{ path: string; date: string }> = [];
    const walk = (dirAbs: string, dirRel: string): void => {
      if (!existsSync(dirAbs)) return;
      for (const entry of readdirSync(dirAbs, { withFileTypes: true })) {
        const rel = dirRel ? `${dirRel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) { walk(join(dirAbs, entry.name), rel); continue; }
        if (dirRel.split('/').pop() === 'archive' && entry.name.endsWith('.md')) {
          out.push({ path: `${rootRel}/${rel}`, date: entry.name.slice(0, -'.md'.length) });
        }
      }
    };
    walk(rootAbs, '');
    return out.sort((a, b) => b.date.localeCompare(a.date));
  }

  /** One archive file's raw content, addressed by the `path` `listArchive` reported (VS-265). */
  function getArchive(scope: KnowledgeScope, projectId: string | null | undefined, path: string): { path: string; body: string } {
    const { rootRel } = archiveRootFor(scope, projectId);
    if (!path.startsWith(`${rootRel}/`) || !/\/archive\/[^/]+\.md$/.test(path) || path.includes('..')) {
      throw new OcError('not_found', `no archive file at ${path}`);
    }
    const abs = join(ctx.paths.knowledge, path);
    if (!existsSync(abs)) throw new OcError('not_found', `no archive file at ${path}`);
    return { path, body: readFileSync(abs, 'utf8') };
  }

  /** VS-732: where a scope's curation interval is stamped, keyed by scope + project. */
  function curationIntervalKey(scope: KnowledgeScope, projectId: string | null | undefined): string {
    return `knowledge:curation_at:${scope}:${projectId ?? ''}`;
  }

  function withinCurationInterval(scope: KnowledgeScope, projectId: string | null | undefined): boolean {
    const raw = db.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', [curationIntervalKey(scope, projectId)])?.value;
    const last = Date.parse(raw ?? '');
    return Number.isFinite(last) && Date.now() - last < CURATION_MIN_INTERVAL_MS;
  }

  function stampCuration(scope: KnowledgeScope, projectId: string | null | undefined): void {
    db.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [curationIntervalKey(scope, projectId), nowIso()]);
  }

  /**
   * VS-757: a curation ticket that ended `done` without a write still curated the scope. Resets the
   * staleness reference and the needs-curation record on every file of the scope and project, and
   * restarts the interval, exactly as a curation write does; `updated_at` is left alone.
   */
  function markScopeCurated(scope: KnowledgeScope, projectId: string | null | undefined): void {
    db.run(
      'UPDATE knowledge_files SET curation_pending = 0, last_curated_at = ? WHERE workspace_id = ? AND scope = ? AND project_id IS ?',
      [nowIso(), ws, scope, projectId ?? null],
    );
    stampCuration(scope, projectId);
  }

  function fireCuration(scope: KnowledgeScope, projectId?: string | null, opts: { force?: boolean } = {}): void {
    void service.requestCuration(SYSTEM, scope, projectId, opts).catch((e: unknown) => log.warn({ err: e, scope }, 'curation request failed'));
  }

  // ---------- expiry ----------

  function pruneExpired(row: FileRow, abs: string, body: string): string {
    const doc = parseDoc(body);
    const cutoff = today();
    const removed: string[] = [];
    for (const s of doc.sections) {
      s.lines = s.lines.filter((line) => {
        const m = EXPIRY_RE.exec(line);
        if (m && m[1]! < cutoff) { removed.push(`${s.name}: ${line.trim()}`); return false; }
        return true;
      });
    }
    if (!removed.length) return body;
    const next = renderDoc(doc);
    archiveEntries(row, abs, removed, 'expired');
    write(SYSTEM, row, abs, next, 'expiry', removed);
    log.info({ path: row.path, removed: removed.length }, 'expired knowledge entries archived');
    return next;
  }

  // ---------- digest ----------

  function sectionText(body: string, name: string): string {
    const s = findSection(parseDoc(body), name);
    return s ? `## ${s.name}\n${s.lines.join('\n')}`.trimEnd() : '';
  }

  function truncateLearnings(text: string): string {
    const doc = parseDoc(text);
    const s = findSection(doc, 'Learnings');
    if (!s || !s.lines.length) return text;
    s.lines = ['(truncated, call weave_knowledge_get for the full Learnings section)'];
    return renderDoc(doc);
  }

  // ---------- service ----------

  const service: KnowledgeService = {
    get(scope, projectId) {
      const { row, abs, body } = ensure(scope, projectId);
      const fresh = fileRow(row.path)!;
      return {
        path: abs, body, tokenEstimate: fresh.tokenEstimate, budgetTokens: budgetOfRow(fresh),
        lastCuratedAt: fresh.lastCuratedAt, curationPending: fresh.curationPending, revision: currentRevision(fresh.id),
      };
    },

    note(actor, scope, section, text, projectId, doc, mirror) {
      const trimmed = text.trim();
      if (!trimmed) throw new OcError('validation', 'an entry needs text');
      const words = countWords(trimmed);
      if (words > 60) {
        throw new OcError('entry_too_long', `entries are at most 60 words; this one has ${words}`, { words, limit: 60 });
      }
      if (SECRET_SHAPED_RE.test(trimmed)) throw new OcError('validation', 'knowledge entries never carry secrets, tokens or credentialed URLs');
      const { row, abs, body } = doc ? ensureDoc(scope, doc, projectId) : ensure(scope, projectId);
      const norm = normalize(trimmed);
      for (const e of entriesOf(body)) {
        if (similarity(norm, e.normalized) >= DUPLICATE_THRESHOLD) {
          throw new OcError('duplicate_entry', 'a near-identical entry already exists', { section: e.section, existing: e.text });
        }
      }
      const bare = trimmed.replace(/^(?:\d{4}-\d{2}-\d{2})\s*(?:[·\-–:]\s*)?/, '').trim() || trimmed;
      const entry = `- ${today()} · ${bare}`;
      const next = appendEntry(body, section, entry);
      const tokens = estimateTokens(next);
      const budget = budgetOfRow(row);
      if (tokens > budget) {
        db.update('knowledge_files', row.id, { curationPending: true, updatedAt: nowIso() });
        fireCuration(scope, projectId, { force: true });
        const { over } = sectionSizes(next, budget);
        throw new OcError('budget_exceeded', `${row.path} would be ${tokens} tokens over a budget of ${budget}; curation scheduled`, {
          tokenEstimate: tokens, budgetTokens: budget, sectionsOverBudget: over,
        });
      }
      // VS-358 (plan review round 2): a repo commit's own delta — this entry applied to *that
      // branch's* current copy of the file, seeded fresh if it has none yet — never the workspace
      // `body` above, which by the time this call runs may already carry another ticket's or the
      // weaver's unmerged note on the same hub or document. Shared by the worker's own worktree
      // mirror and the weaver's out-of-ticket pull request: each reads a different "current copy",
      // but applies the identical entry the identical way.
      const seedForRepo = doc ? '' : seedBody(scope, { projectName: projectId ? projectLabel(projectOf(projectId)) : undefined, budgetTokens: budgetFor(scope, row.path) });
      const applyEntry = (current: string): string => appendEntry(current || seedForRepo, section, entry);
      const revision = write(
        actor, row, abs, next, 'note', [],
        mirrorFor(mirror, () => applyEntry(readMirrorFile(mirror!.worktreePath, repoKnowledgePath(row.path, mirror!.projectSlug), seedForRepo))),
        applyEntry,
      );
      if (tokens > budget * CURATION_BUDGET_FRACTION) fireCuration(scope, projectId);
      return { remainingTokens: budget - tokens, revision };
    },

    replace(actor, scope, body, reason, projectId, removed, mirror, supersedes) {
      const { row, abs, body: before } = ensure(scope, projectId);
      const beforeEntries = entriesOf(before);
      // VS-492: match each named claim to an entry of the file being replaced before anything is
      // written or archived, so a supersession that names nothing is refused with no side effect.
      const superseded: string[] = [];
      for (const claim of supersedes ?? []) {
        const wanted = normalize(claim);
        const hit = wanted ? beforeEntries.find((e) => e.normalized.includes(wanted)) : undefined;
        if (!hit) throw new OcError('validation', `superseded claim not found in ${row.path}: ${claim}`, { claim, path: row.path });
        if (!superseded.includes(hit.line.trim())) superseded.push(hit.line.trim());
      }
      const afterNorm = new Set(entriesOf(body).map((e) => e.normalized));
      const gone = beforeEntries.filter((e) => !afterNorm.has(e.normalized)).map((e) => `${e.section}: ${e.line.trim()}`);
      const all = [...new Set([...gone, ...(removed ?? [])])];
      archiveEntries(row, abs, all, reason);
      const normalized = body.endsWith('\n') ? body : `${body}\n`;
      const revision = write(actor, row, abs, normalized, reason, all, mirrorFor(mirror, () => normalized), undefined, superseded);
      const tokens = estimateTokens(body);
      if (reason !== 'curation' && tokens > budgetOfRow(row)) fireCuration(scope, projectId, { force: true });
      return { revision, superseded };
    },

    revisions(scope, projectId) {
      const { row } = ensure(scope, projectId);
      return db.all<{ revision: number; authorKind: string; reason: string; createdAt: string; ticketId: string | null; ticketIdentifier: string | null; supersededEntries: string[] }>(
        `SELECT r.revision, r.author_kind, r.reason, r.created_at, r.ticket_id, t.identifier AS ticket_identifier, r.superseded_entries_json
           FROM knowledge_revisions r LEFT JOIN tickets t ON t.id = r.ticket_id
          WHERE r.file_id = ? ORDER BY r.revision DESC`,
        [row.id],
      ).map(({ supersededEntries, ...r }) => ({ ...r, superseded: supersededEntries ?? [] }));
    },

    revert(actor, scope, revision, projectId) {
      const { row, abs } = ensure(scope, projectId);
      const r = db.get<{ body: string }>('SELECT body FROM knowledge_revisions WHERE file_id = ? AND revision = ?', [row.id, revision]);
      if (!r) throw new OcError('not_found', `revision ${revision} of ${row.path} not found`);
      const next = write(actor, row, abs, r.body, 'human');
      recordActivity(db, ws, actor, 'knowledge.revert', 'knowledge_file', row.id, { path: row.path, to: revision, revision: next });
      return { revision: next };
    },

    lint() {
      service.reindex();
      return db
        .all<Record<string, unknown>>('SELECT * FROM knowledge_files WHERE workspace_id = ? ORDER BY path', [ws])
        .map((raw) => knowledgeRow(raw) as unknown as FileRow)
        .map((f) => ({
          path: f.path, scope: f.scope, projectId: f.projectId, projectSlug: projectSlugOf(f.projectId), kind: isDocPath(f.path) ? 'doc' : 'hub',
          title: db.get<{ title: string }>("SELECT title FROM knowledge_search WHERE kind = 'knowledge' AND ref = ?", [f.path])?.title ?? null,
          tokenEstimate: f.tokenEstimate, budgetTokens: budgetOfRow(f),
          pct: budgetOfRow(f) ? Math.round((f.tokenEstimate / budgetOfRow(f)) * 100) : 0,
          lastCuratedAt: f.lastCuratedAt, curationPending: f.curationPending,
        }));
    },

    markCurated(scope, projectId) { markScopeCurated(scope, projectId); },

    async requestCuration(actor, scope, projectId, opts = {}) {
      // VS-732: a manual request (a human actor) or an explicit hard trigger — a write rejected for
      // being over budget — bypasses the interval; everything else respects it. A soft over-share
      // does not, because it means the file is approaching its budget, not that it is broken.
      const force = opts.force ?? actor.kind === 'human';
      if (scope === 'project') {
        const p = projectOf(projectId);
        if (!force && withinCurationInterval(scope, p.id)) {
          log.info({ projectId: p.id }, 'curation request suppressed: within the interval');
          return {};
        }
        // At most one open curation ticket, forced or not: the origin-fingerprint index would refuse
        // a second anyway, so checking first makes the skip a clean no-op instead of a thrown conflict.
        const open = db.get<{ n: number }>(
          "SELECT COUNT(*) AS n FROM tickets WHERE workspace_id = ? AND origin_kind = 'curation' AND origin_fingerprint = ? AND status NOT IN ('done','cancelled')",
          [ws, `curation:${p.id}`],
        )?.n ?? 0;
        if (open > 0) {
          log.info({ projectId: p.id }, 'curation request suppressed: a curation ticket is already open');
          return {};
        }
        let agent;
        try {
          agent = await deps().workers.spawnCurator(actor, p.id);
        } catch (e) {
          // VS-757: a project with no active role cannot be curated however often it is asked, so a
          // scheduled request counts as made for the interval and the sweep reports it once, not
          // every pass. A manual request still surfaces the error every time.
          if (!force && e instanceof OcError && e.code === 'wrong_status') stampCuration(scope, p.id);
          throw e;
        }
        stampCuration(scope, p.id);
        log.info({ projectId: p.id, agentId: agent.id }, 'curation worker spawned');
        return { ticketId: agent.ticketId ?? undefined };
      }
      if (!force && withinCurationInterval(scope, null)) {
        log.info({ scope }, 'curation request suppressed: within the interval');
        return {};
      }
      const conductor = deps().workers.conductor();
      const wakeup = deps().wake.enqueue(conductor.id, {
        source: 'system',
        reason: 'curate',
        payload: { scope, projectId: projectId ?? null, path: relPathFor(scope) },
        idempotencyKey: `curate:${scope}`,
      });
      stampCuration(scope, null);
      return { wakeId: wakeup.id };
    },

    search(query, projectId, limit = 20) {
      const terms = query.split(/[^\p{L}\p{N}_]+/u).filter(Boolean).map((t) => `"${t}"`);
      if (!terms.length) return [];
      const match = terms.join(' ');
      const params: Array<string | number> = ['knowledge', match];
      let sql = "SELECT kind, project_id AS projectId, ref, title, snippet(knowledge_search, 4, '', '', '…', 16) AS snippet FROM knowledge_search WHERE kind = ? AND knowledge_search MATCH ?";
      if (projectId) { sql += ' AND (project_id = ? OR project_id = ?)'; params.push(projectId, ''); }
      sql += ' LIMIT ?';
      params.push(Math.min(limit, 100));
      try {
        return db.all<{ kind: string; projectId: string; ref: string; title: string; snippet: string }>(sql, params)
          .map((r) => ({ kind: r.kind, projectId: r.projectId || null, ref: r.ref, title: r.title, snippet: r.snippet }));
      } catch (e) {
        log.warn({ err: e, query }, 'knowledge search failed');
        return [];
      }
    },

    semanticSearch(query, projectId, limit = 20) {
      return embeddings.search(query, { projectId: projectId ?? null, limit });
    },

    backfillEmbeddings(projectId) {
      return embeddings.backfill(projectId ?? null);
    },

    reindex() {
      // Documents edited or added on disk: pick them up, and drop rows whose file is gone.
      for (const raw of db.all<Record<string, unknown>>('SELECT * FROM knowledge_files WHERE workspace_id = ?', [ws])) {
        const row = knowledgeRow(raw) as unknown as FileRow;
        if (!isDocPath(row.path)) continue;
        const abs = join(ctx.paths.knowledge, row.path);
        if (!existsSync(abs)) {
          db.run('DELETE FROM knowledge_links WHERE workspace_id = ? AND from_path = ?', [ws, row.path]);
          db.run("DELETE FROM knowledge_search WHERE kind = 'knowledge' AND ref = ?", [row.path]);
          db.run('DELETE FROM knowledge_revisions WHERE file_id = ?', [row.id]);
          db.run('DELETE FROM knowledge_files WHERE id = ?', [row.id]);
          continue;
        }
        const body = readBody(abs);
        if (row.hash !== sha256(body)) {
          const revision = currentRevision(row.id) + 1;
          db.insert('knowledge_revisions', { id: newId(), fileId: row.id, revision, body, authorKind: 'human', authorId: null, runId: null, reason: 'human', removedEntriesJson: [], createdAt: nowIso() });
          db.update('knowledge_files', row.id, { tokenEstimate: estimateTokens(body), hash: sha256(body), updatedAt: nowIso() });
          indexFile(fileRow(row.path)!, body);
        } else {
          // The body is unchanged but the link parser may have, and the count may be a byte-ratio
          // leftover: re-derive the links and refresh the count either way.
          const tokens = estimateTokens(body);
          if (row.tokenEstimate !== tokens) db.update('knowledge_files', row.id, { tokenEstimate: tokens });
          indexLinks(row, body);
        }
      }
      const scopes: Array<{ scope: KnowledgeScope; projectId?: string }> = [{ scope: 'workspace' }, { scope: 'shared' }, { scope: 'decisions' }];
      for (const p of db.all<{ id: string }>('SELECT id FROM projects WHERE workspace_id = ?', [ws])) scopes.push({ scope: 'project', projectId: p.id });
      for (const s of scopes) {
        try {
          const { row, abs, body } = ensure(s.scope, s.projectId ?? null);
          const pruned = pruneExpired(row, abs, body);
          indexFile(fileRow(row.path)!, pruned);
        } catch (e) {
          log.warn({ err: e, scope: s.scope, projectId: s.projectId }, 'knowledge reindex skipped a file');
        }
      }
    },

    /**
     * Recompute every row's stored size with the tokenizer, from the file on disk, without the
     * revisions and link work `reindex()` does. The supervisor's curation sweep reads
     * `knowledge_files` directly and would otherwise derive its over-budget verdict from a
     * byte-ratio number recorded before token counting existed.
     */
    recountSizes() {
      for (const raw of db.all<Record<string, unknown>>('SELECT * FROM knowledge_files WHERE workspace_id = ?', [ws])) {
        const row = knowledgeRow(raw) as unknown as FileRow;
        const abs = join(ctx.paths.knowledge, row.path);
        if (!existsSync(abs)) continue;
        const tokens = estimateTokens(readBody(abs));
        if (row.tokenEstimate !== tokens) db.update('knowledge_files', row.id, { tokenEstimate: tokens });
      }
    },

    bootstrapDigest(agentId) {
      const agent = db.get<{ id: string; kind: string; projectId: string | null; name: string }>(
        'SELECT id, kind, project_id, name FROM agents WHERE workspace_id = ? AND id = ?', [ws, agentId]);
      if (!agent) throw new OcError('not_found', `agent ${agentId} not found`);
      const budget = ctx.config.defaults.bootstrapBudgetTokens;
      const parts: string[] = [];
      // Measured on each chunk as it is built, before the join/truncate below — never the source
      // file's stored `tokenEstimate`, which for the conductor's per-project chunk would be the
      // whole project hub's size, not just the Overview/Current-focus slice actually rendered here.
      const usage: KnowledgeBootstrapPart[] = [];
      const record = (scope: KnowledgeScope, projectId: string | null, chunk: string): void => {
        if (!chunk) return;
        usage.push({ scope, projectId, tokens: estimateTokens(chunk) });
      };

      if (agent.kind === 'weaver') {
        const workspaceChunk = service.get('workspace').body.trimEnd();
        parts.push(workspaceChunk);
        record('workspace', null, workspaceChunk);
        const sharedChunk = service.get('shared').body.trimEnd();
        parts.push(sharedChunk);
        record('shared', null, sharedChunk);
        const decisions = service.get('decisions').body.split('\n').filter((l) => /^\s*[-*]\s+/.test(l));
        const tail = decisions.slice(-30);
        if (tail.length) {
          const decisionsChunk = ['## Recent decisions', ...tail].join('\n');
          parts.push(decisionsChunk);
          record('decisions', null, decisionsChunk);
        }
        for (const p of db.all<ProjectRow>('SELECT id, slug, name FROM projects WHERE workspace_id = ? ORDER BY slug', [ws])) {
          const body = service.get('project', p.id).body;
          const chunk = [`## Project: ${projectLabel(p)} (${p.slug})`, sectionText(body, 'Overview'), sectionText(body, 'Current focus')].filter(Boolean).join('\n\n');
          parts.push(chunk);
          record('project', p.id, chunk);
        }
      } else {
        const sharedChunk = service.get('shared').body.trimEnd();
        parts.push(sharedChunk);
        record('shared', null, sharedChunk);
        if (agent.projectId) {
          const projectChunk = service.get('project', agent.projectId).body.trimEnd();
          parts.push(projectChunk);
          record('project', agent.projectId, projectChunk);
        }
      }

      let text = parts.filter(Boolean).join('\n\n---\n\n').trimEnd() + '\n';
      let truncated = false;
      if (estimateTokens(text) > budget) {
        text = truncateLearnings(text);
        truncated = true;
      }
      if (estimateTokens(text) > budget) {
        // Hard cap: keep the head, which is SHARED.md and the rules, and say so. The cut is made at
        // the tokenizer, and the pointer's tokens are reserved out of the budget so it really fits.
        const pointer = '\n\n(truncated, call weave_knowledge_get)\n';
        text = `${sliceToTokens(text, Math.max(0, budget - estimateTokens(pointer)))}${pointer}`;
      }
      return { text, tokens: estimateTokens(text), truncated, parts: usage };
    },

    listDocs(filter = {}) {
      const params: Array<string> = [ws];
      let sql = 'SELECT * FROM knowledge_files WHERE workspace_id = ?';
      if (filter.scope) { sql += ' AND scope = ?'; params.push(filter.scope); }
      if (filter.projectId !== undefined) {
        if (filter.projectId) { const p = projectOf(filter.projectId); sql += " AND (project_id = ? OR scope = 'shared')"; params.push(p.id); }
        else sql += ' AND project_id IS NULL';
      }
      sql += ' ORDER BY path';
      return db.all<Record<string, unknown>>(sql, params)
        .map((raw) => knowledgeRow(raw) as unknown as FileRow)
        .filter((f) => isDocPath(f.path))
        .map((f) => docSummaryOf(f, readBody(join(ctx.paths.knowledge, f.path))));
    },

    getDoc(scope, slug, projectId) {
      const { rel, abs } = locateDoc(scope, slug, projectId);
      const row = fileRow(rel);
      if (!row || !existsSync(abs)) throw new OcError('not_found', `document ${slug} does not exist in the ${scope} scope; list documents first`);
      const body = readBody(abs);
      const links = db.all<{ toSlug: string; toPath: string | null }>('SELECT to_slug, to_path FROM knowledge_links WHERE workspace_id = ? AND from_path = ? ORDER BY to_slug', [ws, rel]);
      const detail: KnowledgeDocDetail = {
        ...docSummaryOf(row, body), body, revision: currentRevision(row.id),
        linksTo: links.map((l) => ({ slug: l.toSlug, path: l.toPath, title: l.toPath ? db.get<{ title: string }>("SELECT title FROM knowledge_search WHERE kind = 'knowledge' AND ref = ?", [l.toPath])?.title ?? null : null })),
        linkedFrom: backlinksOf(rel),
      };
      return detail;
    },

    putDoc(actor, scope, slug, body, projectId, reason = 'note', folder, mirror) {
      const text = body.replace(/\r\n/g, '\n').trim() + '\n';
      if (!docTitle(text)) throw new OcError('validation', 'a document starts with a `# Title` line');
      const tokens = estimateTokens(text);
      const budget = ctx.config.defaults.knowledgeBudgetTokens.document;
      if (tokens > budget) throw new OcError('budget_exceeded', `a document is at most ${budget} tokens; this one is ${tokens}. Split it into linked documents.`, { tokenEstimate: tokens, budgetTokens: budget });
      if (SECRET_SHAPED_RE.test(text)) throw new OcError('validation', 'documents never carry secrets, tokens or credentialed URLs');
      // `folder` only decides where a *new* document is created; locateDoc finds an existing one by
      // slug first, so a folder disagreeing with where it already lives is ignored, not a move (VS-265).
      const { rel, abs, projectRowId } = locateDoc(scope, slug, projectId, folder);
      let row = fileRow(rel);
      if (!row) {
        const id = newId();
        db.insert('knowledge_files', {
          id, workspaceId: ws, projectId: projectRowId, path: rel, scope, tokenEstimate: 0, budgetTokens: budget,
          lastCuratedAt: null, curationPending: false, hash: '', updatedAt: nowIso(),
        });
        row = fileRow(rel)!;
      }
      const revision = write(actor, row, abs, text, reason, [], mirrorFor(mirror, () => text));
      const fresh = fileRow(rel)!;
      const unresolved = db.all<{ toSlug: string }>('SELECT to_slug FROM knowledge_links WHERE workspace_id = ? AND from_path = ? AND to_path IS NULL', [ws, rel]).map((l) => l.toSlug);
      const backlinks = backlinksOf(rel).length;
      return { path: rel, revision, tokenEstimate: fresh.tokenEstimate, budgetTokens: budgetOfRow(fresh), unresolvedLinks: unresolved, backlinks, orphan: backlinks === 0 };
    },

    deleteDoc(actor, scope, slug, projectId) {
      const { rel, abs } = locateDoc(scope, slug, projectId);
      const row = fileRow(rel);
      if (!row) throw new OcError('not_found', `document ${slug} does not exist`);
      tx(db, () => {
        const body = readBody(abs);
        archiveEntries(row, abs, [`document ${rel} (${estimateTokens(body)} tokens)`, ...body.split('\n')], 'deleted');
        db.run('DELETE FROM knowledge_links WHERE workspace_id = ? AND from_path = ?', [ws, rel]);
        db.run('UPDATE knowledge_links SET to_path = NULL WHERE workspace_id = ? AND to_path = ?', [ws, rel]);
        db.run("DELETE FROM knowledge_search WHERE kind = 'knowledge' AND ref = ?", [rel]);
        db.run('DELETE FROM knowledge_revisions WHERE file_id = ?', [row.id]);
        db.run('DELETE FROM knowledge_files WHERE id = ?', [row.id]);
        try { if (existsSync(abs)) unlinkSync(abs); } catch (e) { log.warn({ err: e, path: rel }, 'document file could not be removed'); }
        recordActivity(db, ws, actor, 'knowledge.delete', 'knowledge_file', row.id, { path: rel });
        ctx.events.emit('knowledge.updated', 'knowledge_file', row.id, { path: rel, scope, projectId: row.projectId, deleted: true });
      });
    },

    moveDoc(actor, scope, slug, projectId, folder) {
      const p = scope === 'project' ? projectOf(projectId) : null;
      const projectRowId = p?.id ?? null;
      const oldRel = findDocPath(scope, slug, projectRowId);
      if (!oldRel) throw new OcError('not_found', `document ${slug} does not exist in the ${scope} scope`);
      const newRel = docPathFor(scope, slug, p?.slug, folder);
      if (newRel === oldRel) return { path: newRel };
      const row = fileRow(oldRel)!;
      const oldAbs = join(ctx.paths.knowledge, oldRel);
      const newAbs = join(ctx.paths.knowledge, newRel);
      tx(db, () => {
        mkdirSync(dirname(newAbs), { recursive: true });
        renameSync(oldAbs, newAbs);
        db.update('knowledge_files', row.id, { path: newRel, updatedAt: nowIso() });
        // Only the path moves. `to_slug` is untouched, so nothing addressing this document by
        // `[[slug]]` needs to know — only the cached path resolutions have to follow (VS-265).
        db.run('UPDATE knowledge_links SET from_path = ? WHERE workspace_id = ? AND from_path = ?', [newRel, ws, oldRel]);
        db.run('UPDATE knowledge_links SET to_path = ? WHERE workspace_id = ? AND to_path = ?', [newRel, ws, oldRel]);
        db.run("DELETE FROM knowledge_search WHERE kind = 'knowledge' AND ref = ?", [oldRel]);
        const freshRow = fileRow(newRel)!;
        indexSearch(freshRow, readBody(newAbs));
        recordActivity(db, ws, actor, 'knowledge.move', 'knowledge_file', row.id, { from: oldRel, to: newRel });
        ctx.events.emit('knowledge.updated', 'knowledge_file', row.id, { path: newRel, scope, projectId: row.projectId, movedFrom: oldRel });
      });
      return { path: newRel };
    },

    graph(projectId) {
      const rows = db.all<Record<string, unknown>>('SELECT * FROM knowledge_files WHERE workspace_id = ? ORDER BY path', [ws]).map((raw) => knowledgeRow(raw) as unknown as FileRow);
      const pid = projectId ? projectOf(projectId).id : null;
      const visible = rows.filter((f) => !pid || f.projectId === pid);
      const linkedFrom = new Set(
        db.all<{ fromPath: string }>('SELECT DISTINCT from_path FROM knowledge_links WHERE workspace_id = ? AND to_path IS NOT NULL', [ws]).map((r) => r.fromPath),
      );
      const keep = (f: FileRow): boolean => {
        if (isDocPath(f.path) || f.scope === 'project') return true;
        if (linkedFrom.has(f.path)) return true;
        return !isHubStub(readBody(join(ctx.paths.knowledge, f.path)));
      };
      let kept = visible.filter(keep);
      if (!pid) {
        const workspaceHub = relPathFor('workspace');
        const paths = new Set(kept.map((f) => f.path));
        if (!paths.has(workspaceHub) && (paths.has(relPathFor('shared')) || paths.has(relPathFor('decisions')))) {
          const parent = visible.find((f) => f.path === workspaceHub);
          if (parent) kept = [...kept, parent];
        }
      }
      const paths = new Set(kept.map((f) => f.path));
      const nodes = kept.map((f) => ({
        id: f.path, kind: (isDocPath(f.path) ? 'doc' : 'hub') as 'doc' | 'hub', scope: f.scope, projectId: f.projectId, projectSlug: projectSlugOf(f.projectId),
        slug: docSlugOf(f.path), title: db.get<{ title: string }>("SELECT title FROM knowledge_search WHERE kind = 'knowledge' AND ref = ?", [f.path])?.title ?? f.path,
        tokens: f.tokenEstimate, updatedAt: f.updatedAt,
      }));
      const edges = db.all<{ fromPath: string; toPath: string | null }>('SELECT from_path, to_path FROM knowledge_links WHERE workspace_id = ? AND to_path IS NOT NULL', [ws])
        .filter((e) => paths.has(e.fromPath) && paths.has(e.toPath!))
        .map((e) => ({ from: e.fromPath, to: e.toPath! }));
      if (!pid) {
        const workspaceHub = relPathFor('workspace');
        const sharedHub = relPathFor('shared');
        const decisionsHub = relPathFor('decisions');
        if (paths.has(workspaceHub) && paths.has(sharedHub)) edges.push({ from: workspaceHub, to: sharedHub });
        if (paths.has(workspaceHub) && paths.has(decisionsHub)) edges.push({ from: workspaceHub, to: decisionsHub });
      }
      return { nodes, edges };
    },

    duplicates(filter = {}) {
      // VS-492: the same entries the write-time check compares a new note against, compared with each
      // other. Read-only by construction — every operation below is a read; there is no write path.
      const params: string[] = [ws];
      let sql = 'SELECT * FROM knowledge_files WHERE workspace_id = ?';
      if (filter.scope) { sql += ' AND scope = ?'; params.push(filter.scope); }
      if (filter.projectId) {
        const p = projectOf(filter.projectId);
        sql += " AND (project_id = ? OR scope = 'shared')";
        params.push(p.id);
      } else if (filter.projectId === null) {
        sql += ' AND project_id IS NULL';
      }
      const entries: Array<{ entry: Entry; file: FileRow }> = [];
      for (const raw of db.all<Record<string, unknown>>(sql, params)) {
        const f = knowledgeRow(raw) as unknown as FileRow;
        const abs = join(ctx.paths.knowledge, f.path);
        if (!existsSync(abs)) continue;
        for (const e of entriesOf(readBody(abs))) {
          if (!isDuplicateCandidate(e.text) || isHubSectionPointer(f.path, e.text)) continue;
          entries.push({ entry: e, file: f });
        }
      }
      const entryCapped = entries.length > MAX_DUPLICATE_ENTRIES;
      const considered = entries.slice(0, MAX_DUPLICATE_ENTRIES);
      const view = (file: FileRow, entry: Entry): KnowledgeDuplicateEntry => ({
        path: file.path, scope: file.scope, projectId: file.projectId, slug: docSlugOf(file.path),
        section: entry.section, text: entry.text, line: entry.line,
      });
      const pairs: KnowledgeDuplicatePair[] = [];
      let pairCapped = false;
      for (let i = 0; i < considered.length && !pairCapped; i++) {
        for (let j = i + 1; j < considered.length; j++) {
          const score = similarity(considered[i]!.entry.normalized, considered[j]!.entry.normalized, { containment: false });
          if (score < DUPLICATE_THRESHOLD) continue;
          pairs.push({ score, a: view(considered[i]!.file, considered[i]!.entry), b: view(considered[j]!.file, considered[j]!.entry) });
          if (pairs.length >= MAX_DUPLICATE_PAIRS) { pairCapped = true; break; }
        }
      }
      pairs.sort((a, b) => b.score - a.score);
      return { pairs, scanned: considered.length, capped: entryCapped || pairCapped };
    },

    health(projectId) {
      // A hub scope this call cares about has to exist to be reported on — a project nobody has
      // read or written to yet still gets a health view, not an omission.
      if (projectId) { ensure('project', projectId); ensure('shared'); }
      else {
        ensure('workspace'); ensure('shared'); ensure('decisions');
        for (const p of db.all<{ id: string }>('SELECT id FROM projects WHERE workspace_id = ?', [ws])) ensure('project', p.id);
      }

      // Same visibility rule every knowledge read uses: no project is the workspace's own view
      // (every hub, every project); a project is that project's hub plus `shared`.
      const rows = db.all<Record<string, unknown>>('SELECT * FROM knowledge_files WHERE workspace_id = ? ORDER BY path', [ws]).map((raw) => knowledgeRow(raw) as unknown as FileRow);
      const pid = projectId ? projectOf(projectId).id : null;
      const visible = rows.filter((f) => !pid || f.projectId === pid || f.scope === 'shared');
      const visiblePaths = new Set(visible.map((f) => f.path));

      const hubs = visible
        .filter((f) => !isDocPath(f.path))
        .map((f) => {
          const budget = budgetOfRow(f);
          const pct = budget ? Math.round((f.tokenEstimate / budget) * 100) : 0;
          return {
            path: f.path, scope: f.scope, projectId: f.projectId, projectSlug: projectSlugOf(f.projectId),
            tokenEstimate: f.tokenEstimate, budgetTokens: budget, pct, nearBudget: f.tokenEstimate > budget * CURATION_BUDGET_FRACTION,
            curationPending: f.curationPending, lastCuratedAt: f.lastCuratedAt,
          };
        });

      const docs = service.listDocs(projectId !== undefined && projectId !== null ? { projectId } : {});
      const staleBefore = Date.now() - DOCUMENT_STALE_MS;
      const orphans = docs.filter((d) => d.backlinks === 0 && !isRedirectStub(readBody(join(ctx.paths.knowledge, d.path))));
      const stale = docs.filter((d) => Date.parse(d.updatedAt) < staleBefore);

      // VS-492: a fifth measure, derived from the read events the context-accounting service already
      // records — a document no run has read within the configured window, and old enough that
      // "nothing has read it yet" is a signal rather than a document newer than the window. The
      // usage service is optional here so a knowledge-only harness still gets a view.
      const neverReadBefore = Date.now() - ctx.config.defaults.knowledgeNeverReadDays * 24 * 60 * 60 * 1000;
      let neverRead = [] as KnowledgeDocSummary[];
      try {
        const usage = deps().knowledgeUsage as KnowledgeUsageService | undefined;
        if (usage) {
          const refs = usage.neverRead({
            ...(projectId !== undefined && projectId !== null ? { projectId } : {}),
            since: new Date(neverReadBefore).toISOString(),
          });
          const keys = new Set(refs.map((r) => `${r.scope}:${r.projectId ?? ''}:${r.slug}`));
          neverRead = docs.filter((d) => keys.has(`${d.scope}:${d.projectId ?? ''}:${d.slug}`) && Date.parse(d.updatedAt) < neverReadBefore);
        }
      } catch (e) {
        log.debug({ err: String(e) }, 'never-read measure unavailable');
      }

      const unresolvedLinks = db
        .all<{ fromPath: string; toSlug: string }>('SELECT from_path, to_slug FROM knowledge_links WHERE workspace_id = ? AND to_path IS NULL', [ws])
        .filter((l) => visiblePaths.has(l.fromPath))
        .map((l) => ({
          fromPath: l.fromPath, toSlug: l.toSlug,
          fromTitle: db.get<{ title: string }>("SELECT title FROM knowledge_search WHERE kind = 'knowledge' AND ref = ?", [l.fromPath])?.title ?? l.fromPath,
        }));

      return { hubs, orphans, stale, neverRead, unresolvedLinks };
    },

    appendDecision(decision: Decision) {
      const { row, abs, body } = ensure('decisions');
      const ident = decision.ticketId
        ? db.get<{ identifier: string }>('SELECT identifier FROM tickets WHERE id = ?', [decision.ticketId])?.identifier ?? null
        : null;
      const answer = [decision.answerKey, decision.answerText].filter(Boolean).join(' — ');
      // VS-310: a relayed answer is distinguishable from one the human gave directly, here too.
      const relay = decision.relayedFromMessageId ? " (relayed from the human's message)" : '';
      const line = `- ${today()} · ${ident ? `[${ident}] ` : ''}${decision.title}${answer ? ` → ${answer}` : ''}${relay}`;
      const norm = normalize(line.replace(/^- /, ''));
      if (entriesOf(body).some((e) => similarity(norm, e.normalized) >= 0.95)) return;
      const next = appendEntry(body, 'Decisions', line);
      write(SYSTEM, row, abs, next, 'note');
      if (estimateTokens(next) > budgetOfRow(row) * 0.8) fireCuration('decisions');
    },

    listArchive(scope, projectId) {
      return listArchive(scope, projectId);
    },
    getArchive(scope, projectId, path) {
      return getArchive(scope, projectId, path);
    },
  };

  return service;
}
