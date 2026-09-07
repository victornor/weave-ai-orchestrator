import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { knowledgeRow, newId, nowIso, type Db } from '@agent-conductor/db';
import {
  estimateTokens, OcError,
  type Decision, type KnowledgeRevisionReason, type KnowledgeScope,
} from '@agent-conductor/shared';
import type { Actor, CoreServices, KnowledgeDocDetail, KnowledgeDocSummary, KnowledgeService } from '../api.js';
import type { WorkspaceContext } from '../context.js';
import { recordActivity } from '../events.js';
import { tx } from '../tickets/tx.js';
import {
  CURATION_BUDGET_FRACTION, DOCUMENT_STALE_MS, DUPLICATE_THRESHOLD, EXPIRY_RE, appendEntry, budgetOf, countWords, docPathFor, docSlugOf, docSummary, docTitle, entriesOf, findSection,
  isDocPath, normalize, parseDoc, parseLinks, relPathFor, renderDoc, sectionSizes, seedBody, sha256, similarity, today, withBudgetStated,
} from './files.js';

interface FileRow {
  id: string; workspaceId: string; projectId: string | null; path: string; scope: KnowledgeScope;
  tokenEstimate: number; budgetTokens: number; lastCuratedAt: string | null; curationPending: boolean; hash: string; updatedAt: string;
}
interface ProjectRow { id: string; slug: string; name: string }

const SYSTEM: Actor = { kind: 'system', id: null };

export function createKnowledgeService(ctx: WorkspaceContext, deps: () => CoreServices): KnowledgeService {
  const db: Db = ctx.db;
  const log = ctx.log('knowledge');
  const ws = ctx.workspaceId;

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
      return { rel, abs: join(ctx.paths.knowledge, rel), projectRowId: p.id, projectName: p.name };
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
    // The column mirrors the configured budget so events, the API and the database agree with it.
    const budget = budgetOfRow(row);
    if (row.budgetTokens !== budget) {
      db.update('knowledge_files', row.id, { budgetTokens: budget, updatedAt: nowIso() });
      row = fileRow(rel)!;
    }
    return { row, abs, body };
  }

  function indexFile(row: FileRow, body: string): void {
    db.run("DELETE FROM knowledge_search WHERE kind = 'knowledge' AND ref = ?", [row.path]);
    db.run('INSERT INTO knowledge_search (kind, project_id, ref, title, body) VALUES (?,?,?,?,?)', [
      'knowledge', row.projectId ?? '', row.path, titleOf(body) ?? row.path, body,
    ]);
    indexLinks(row, body);
  }

  // ---------- linked documents ----------

  /** A [[slug]] resolves within the file's own scope first, then to a shared document. */
  function resolveLink(row: FileRow, slug: string): string | null {
    const candidates: Array<string | null> = [];
    if (row.scope === 'project' && row.projectId) {
      const p = db.get<ProjectRow>('SELECT id, slug, name FROM projects WHERE id = ?', [row.projectId]);
      if (p) candidates.push(docPathForSafe('project', slug, p.slug));
    }
    if (row.scope === 'workspace' || row.scope === 'decisions') candidates.push(docPathForSafe('workspace', slug));
    candidates.push(docPathForSafe('shared', slug));
    for (const c of candidates) {
      if (!c) continue;
      if (db.get('SELECT 1 FROM knowledge_files WHERE workspace_id = ? AND path = ?', [ws, c])) return c;
    }
    return null;
  }
  function docPathForSafe(scope: KnowledgeScope, slug: string, projectSlug?: string | null): string | null {
    try { return docPathFor(scope, slug, projectSlug); } catch { return null; }
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
      title: docTitle(body) ?? docSlugOf(row.path) ?? row.path, summary: docSummary(body), tokenEstimate: row.tokenEstimate, budgetTokens: budgetOfRow(row),
      links: db.get<{ n: number }>('SELECT COUNT(*) n FROM knowledge_links WHERE workspace_id = ? AND from_path = ?', [ws, row.path])?.n ?? 0,
      backlinks: db.get<{ n: number }>('SELECT COUNT(*) n FROM knowledge_links WHERE workspace_id = ? AND to_path = ?', [ws, row.path])?.n ?? 0,
      updatedAt: row.updatedAt,
    };
  }

  function locateDoc(scope: KnowledgeScope, slug: string, projectId?: string | null): { rel: string; abs: string; projectRowId: string | null } {
    if (scope === 'project') {
      const p = projectOf(projectId);
      const rel = docPathFor(scope, slug, p.slug);
      return { rel, abs: join(ctx.paths.knowledge, rel), projectRowId: p.id };
    }
    const rel = docPathFor(scope, slug);
    return { rel, abs: join(ctx.paths.knowledge, rel), projectRowId: null };
  }

  function titleOf(body: string): string | null {
    const m = /^#\s+(.+)$/m.exec(body);
    return m ? m[1]!.trim() : null;
  }

  /** Persist a new body: revision row, file row, disk, FTS. Returns the new revision number. */
  function write(
    actor: Actor,
    row: FileRow,
    abs: string,
    next: string,
    reason: KnowledgeRevisionReason,
    removed: string[] = [],
  ): number {
    const budget = budgetOfRow(row);
    const body = isDocPath(row.path) ? next : withBudgetStated(next, budget);
    // Provenance (VS-102): which ticket this write came from, resolved from the run rather than the
    // actor — a ticket is a property of this particular run (`runs.ticket_id`), not of who is calling.
    // A human or system write has no run and records no ticket.
    const ticketId = actor.runId ? db.get<{ ticketId: string | null }>('SELECT ticket_id FROM runs WHERE id = ?', [actor.runId])?.ticketId ?? null : null;
    return tx(db, () => {
      const revision = currentRevision(row.id) + 1;
      const tokens = estimateTokens(body);
      db.insert('knowledge_revisions', {
        id: newId(), fileId: row.id, revision, body, authorKind: actor.kind, authorId: actor.id, runId: actor.runId ?? null,
        ticketId, reason, removedEntriesJson: removed, createdAt: nowIso(),
      });
      const patch: Record<string, unknown> = { tokenEstimate: tokens, hash: sha256(body), budgetTokens: budget, updatedAt: nowIso() };
      if (reason === 'curation') { patch.lastCuratedAt = nowIso(); patch.curationPending = false; }
      else patch.curationPending = tokens > budget * CURATION_BUDGET_FRACTION;
      db.update('knowledge_files', row.id, patch);
      // A curation run is asked for a whole scope, not for one file. The curator rewrites the hub
      // file, so a flag left on a linked document it did not touch would ask for the same run again
      // tomorrow, and every day after that (VS-67).
      if (reason === 'curation') {
        db.run(
          'UPDATE knowledge_files SET curation_pending = 0 WHERE workspace_id = ? AND scope = ? AND project_id IS ? AND id <> ?',
          [ws, row.scope, row.projectId, row.id],
        );
      }
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, body, 'utf8');
      const fresh = fileRow(row.path)!;
      indexFile(fresh, body);
      recordActivity(db, ws, actor, 'knowledge.write', 'knowledge_file', row.id, { path: row.path, reason, revision, tokens });
      ctx.events.emit(reason === 'curation' ? 'knowledge.curated' : 'knowledge.updated', 'knowledge_file', row.id, {
        path: row.path, scope: row.scope, projectId: row.projectId, revision, tokenEstimate: tokens, budgetTokens: budget,
      });
      return revision;
    });
  }

  function archiveEntries(row: FileRow, abs: string, removed: string[], reason: string): void {
    if (!removed.length) return;
    const archive = join(dirname(abs), 'archive', `${today()}.md`);
    mkdirSync(dirname(archive), { recursive: true });
    const block = [`\n<!-- removed from ${row.path} at ${nowIso()} (${reason}) -->`, ...removed.map((l) => l.trimEnd())].join('\n') + '\n';
    appendFileSync(archive, block, 'utf8');
  }

  function fireCuration(scope: KnowledgeScope, projectId?: string | null): void {
    void service.requestCuration(SYSTEM, scope, projectId).catch((e: unknown) => log.warn({ err: e, scope }, 'curation request failed'));
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
    s.lines = ['(truncated, call ac_knowledge_get for the full Learnings section)'];
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

    note(actor, scope, section, text, projectId) {
      const trimmed = text.trim();
      if (!trimmed) throw new OcError('validation', 'an entry needs text');
      const words = countWords(trimmed);
      if (words > 60) {
        throw new OcError('entry_too_long', `entries are at most 60 words; this one has ${words}`, { words, limit: 60 });
      }
      const { row, abs, body } = ensure(scope, projectId);
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
        fireCuration(scope, projectId);
        const { over } = sectionSizes(next, budget);
        throw new OcError('budget_exceeded', `${row.path} would be ${tokens} tokens over a budget of ${budget}; curation scheduled`, {
          tokenEstimate: tokens, budgetTokens: budget, sectionsOverBudget: over,
        });
      }
      const revision = write(actor, row, abs, next, 'note');
      if (tokens > budget * CURATION_BUDGET_FRACTION) fireCuration(scope, projectId);
      return { remainingTokens: budget - tokens, revision };
    },

    replace(actor, scope, body, reason, projectId, removed) {
      const { row, abs, body: before } = ensure(scope, projectId);
      const beforeEntries = entriesOf(before);
      const afterNorm = new Set(entriesOf(body).map((e) => e.normalized));
      const gone = beforeEntries.filter((e) => !afterNorm.has(e.normalized)).map((e) => `${e.section}: ${e.line.trim()}`);
      const all = [...new Set([...gone, ...(removed ?? [])])];
      archiveEntries(row, abs, all, reason);
      const revision = write(actor, row, abs, body.endsWith('\n') ? body : `${body}\n`, reason, all);
      const tokens = estimateTokens(body);
      if (reason !== 'curation' && tokens > budgetOfRow(row)) fireCuration(scope, projectId);
      return { revision };
    },

    revisions(scope, projectId) {
      const { row } = ensure(scope, projectId);
      return db.all<{ revision: number; authorKind: string; reason: string; createdAt: string; ticketId: string | null; ticketIdentifier: string | null }>(
        `SELECT r.revision, r.author_kind, r.reason, r.created_at, r.ticket_id, t.identifier AS ticket_identifier
           FROM knowledge_revisions r LEFT JOIN tickets t ON t.id = r.ticket_id
          WHERE r.file_id = ? ORDER BY r.revision DESC`,
        [row.id],
      );
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

    async requestCuration(actor, scope, projectId) {
      if (scope === 'project') {
        const p = projectOf(projectId);
        const agent = await deps().workers.spawnCurator(actor, p.id);
        log.info({ projectId: p.id, agentId: agent.id }, 'curation worker spawned');
        return { ticketId: agent.ticketId ?? undefined };
      }
      const conductor = deps().workers.conductor();
      const wakeup = deps().wake.enqueue(conductor.id, {
        source: 'system',
        reason: 'curate',
        payload: { scope, projectId: projectId ?? null, path: relPathFor(scope) },
        idempotencyKey: `curate:${scope}`,
      });
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
          // The body is unchanged but the link parser may have: re-derive the links either way.
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

    bootstrapDigest(agentId) {
      const agent = db.get<{ id: string; kind: string; projectId: string | null; name: string }>(
        'SELECT id, kind, project_id, name FROM agents WHERE workspace_id = ? AND id = ?', [ws, agentId]);
      if (!agent) throw new OcError('not_found', `agent ${agentId} not found`);
      const budget = ctx.config.defaults.bootstrapBudgetTokens;
      const parts: string[] = [];

      if (agent.kind === 'conductor') {
        parts.push(service.get('workspace').body.trimEnd());
        parts.push(service.get('shared').body.trimEnd());
        const decisions = service.get('decisions').body.split('\n').filter((l) => /^\s*[-*]\s+/.test(l));
        const tail = decisions.slice(-30);
        if (tail.length) parts.push(['## Recent decisions', ...tail].join('\n'));
        for (const p of db.all<ProjectRow>('SELECT id, slug, name FROM projects WHERE workspace_id = ? ORDER BY slug', [ws])) {
          const body = service.get('project', p.id).body;
          const chunk = [`## Project: ${p.name} (${p.slug})`, sectionText(body, 'Overview'), sectionText(body, 'Current focus')].filter(Boolean).join('\n\n');
          parts.push(chunk);
        }
      } else {
        parts.push(service.get('shared').body.trimEnd());
        if (agent.projectId) parts.push(service.get('project', agent.projectId).body.trimEnd());
      }

      let text = parts.filter(Boolean).join('\n\n---\n\n').trimEnd() + '\n';
      let truncated = false;
      if (estimateTokens(text) > budget) {
        text = truncateLearnings(text);
        truncated = true;
      }
      if (estimateTokens(text) > budget) {
        // Hard cap: keep the head, which is SHARED.md and the rules, and say so.
        const limit = Math.floor(budget * 3.5);
        text = `${text.slice(0, limit)}\n\n(truncated, call ac_knowledge_get)\n`;
      }
      return { text, tokens: estimateTokens(text), truncated };
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

    putDoc(actor, scope, slug, body, projectId, reason = 'note') {
      const text = body.replace(/\r\n/g, '\n').trim() + '\n';
      if (!docTitle(text)) throw new OcError('validation', 'a document starts with a `# Title` line');
      const tokens = estimateTokens(text);
      const budget = ctx.config.defaults.knowledgeBudgetTokens.document;
      if (tokens > budget) throw new OcError('budget_exceeded', `a document is at most ${budget} tokens; this one is ${tokens}. Split it into linked documents.`, { tokenEstimate: tokens, budgetTokens: budget });
      if (/(?:sk|ghp|xox[bp])-[A-Za-z0-9_-]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|https?:\/\/[^\s/]+:[^\s@/]+@/i.test(text)) throw new OcError('validation', 'documents never carry secrets, tokens or credentialed URLs');
      const { rel, abs, projectRowId } = locateDoc(scope, slug, projectId);
      let row = fileRow(rel);
      if (!row) {
        const id = newId();
        db.insert('knowledge_files', {
          id, workspaceId: ws, projectId: projectRowId, path: rel, scope, tokenEstimate: 0, budgetTokens: budget,
          lastCuratedAt: null, curationPending: false, hash: '', updatedAt: nowIso(),
        });
        row = fileRow(rel)!;
      }
      const revision = write(actor, row, abs, text, reason);
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

    graph(projectId) {
      const rows = db.all<Record<string, unknown>>('SELECT * FROM knowledge_files WHERE workspace_id = ? ORDER BY path', [ws]).map((raw) => knowledgeRow(raw) as unknown as FileRow);
      const pid = projectId ? projectOf(projectId).id : null;
      const visible = rows.filter((f) => !pid || f.projectId === pid || f.scope === 'shared');
      const paths = new Set(visible.map((f) => f.path));
      const nodes = visible.map((f) => ({
        id: f.path, kind: (isDocPath(f.path) ? 'doc' : 'hub') as 'doc' | 'hub', scope: f.scope, projectId: f.projectId, projectSlug: projectSlugOf(f.projectId),
        slug: docSlugOf(f.path), title: db.get<{ title: string }>("SELECT title FROM knowledge_search WHERE kind = 'knowledge' AND ref = ?", [f.path])?.title ?? f.path,
        tokens: f.tokenEstimate, updatedAt: f.updatedAt,
      }));
      const edges = db.all<{ fromPath: string; toPath: string | null }>('SELECT from_path, to_path FROM knowledge_links WHERE workspace_id = ? AND to_path IS NOT NULL', [ws])
        .filter((e) => paths.has(e.fromPath) && paths.has(e.toPath!))
        .map((e) => ({ from: e.fromPath, to: e.toPath! }));
      return { nodes, edges };
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
      const orphans = docs.filter((d) => d.backlinks === 0);
      const stale = docs.filter((d) => Date.parse(d.updatedAt) < staleBefore);

      const unresolvedLinks = db
        .all<{ fromPath: string; toSlug: string }>('SELECT from_path, to_slug FROM knowledge_links WHERE workspace_id = ? AND to_path IS NULL', [ws])
        .filter((l) => visiblePaths.has(l.fromPath))
        .map((l) => ({
          fromPath: l.fromPath, toSlug: l.toSlug,
          fromTitle: db.get<{ title: string }>("SELECT title FROM knowledge_search WHERE kind = 'knowledge' AND ref = ?", [l.fromPath])?.title ?? l.fromPath,
        }));

      return { hubs, orphans, stale, unresolvedLinks };
    },

    appendDecision(decision: Decision) {
      const { row, abs, body } = ensure('decisions');
      const ident = decision.ticketId
        ? db.get<{ identifier: string }>('SELECT identifier FROM tickets WHERE id = ?', [decision.ticketId])?.identifier ?? null
        : null;
      const answer = [decision.answerKey, decision.answerText].filter(Boolean).join(' — ');
      const line = `- ${today()} · ${ident ? `[${ident}] ` : ''}${decision.title}${answer ? ` → ${answer}` : ''}`;
      const norm = normalize(line.replace(/^- /, ''));
      if (entriesOf(body).some((e) => similarity(norm, e.normalized) >= 0.95)) return;
      const next = appendEntry(body, 'Decisions', line);
      write(SYSTEM, row, abs, next, 'note');
      if (estimateTokens(next) > budgetOfRow(row) * 0.8) fireCuration('decisions');
    },
  };

  return service;
}
