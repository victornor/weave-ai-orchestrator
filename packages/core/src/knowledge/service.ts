import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { knowledgeRow, newId, nowIso, type Db } from '@agent-conductor/db';
import {
  estimateTokens, OcError,
  type Decision, type KnowledgeRevisionReason, type KnowledgeScope,
} from '@agent-conductor/shared';
import type { Actor, CoreServices, KnowledgeService } from '../api.js';
import type { WorkspaceContext } from '../context.js';
import { recordActivity } from '../events.js';
import { tx } from '../tickets/tx.js';
import {
  BUDGETS, DUPLICATE_THRESHOLD, EXPIRY_RE, appendEntry, countWords, entriesOf, findSection, normalize,
  parseDoc, relPathFor, renderDoc, sectionSizes, seedBody, sha256, similarity, today,
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
      body = seedBody(scope, { workspaceName: ctx.config.name, projectName: projectName ?? undefined });
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, body, 'utf8');
    }
    if (!row) {
      const id = newId();
      db.insert('knowledge_files', {
        id, workspaceId: ws, projectId: projectRowId, path: rel, scope, tokenEstimate: estimateTokens(body),
        budgetTokens: BUDGETS[scope], lastCuratedAt: null, curationPending: false, hash: sha256(body), updatedAt: nowIso(),
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
        tokenEstimate: tokens, hash: sha256(body), curationPending: tokens > row.budgetTokens * 0.8, updatedAt: nowIso(),
      });
      row = fileRow(rel)!;
      indexFile(row, body);
    }
    return { row, abs, body };
  }

  function indexFile(row: FileRow, body: string): void {
    db.run("DELETE FROM knowledge_search WHERE kind = 'knowledge' AND ref = ?", [row.path]);
    db.run('INSERT INTO knowledge_search (kind, project_id, ref, title, body) VALUES (?,?,?,?,?)', [
      'knowledge', row.projectId ?? '', row.path, titleOf(body) ?? row.path, body,
    ]);
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
    body: string,
    reason: KnowledgeRevisionReason,
    removed: string[] = [],
  ): number {
    return tx(db, () => {
      const revision = currentRevision(row.id) + 1;
      const tokens = estimateTokens(body);
      db.insert('knowledge_revisions', {
        id: newId(), fileId: row.id, revision, body, authorKind: actor.kind, authorId: actor.id, runId: actor.runId ?? null,
        reason, removedEntriesJson: removed, createdAt: nowIso(),
      });
      const patch: Record<string, unknown> = { tokenEstimate: tokens, hash: sha256(body), updatedAt: nowIso() };
      if (reason === 'curation') { patch.lastCuratedAt = nowIso(); patch.curationPending = false; }
      else patch.curationPending = tokens > row.budgetTokens * 0.8;
      db.update('knowledge_files', row.id, patch);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, body, 'utf8');
      const fresh = fileRow(row.path)!;
      indexFile(fresh, body);
      recordActivity(db, ws, actor, 'knowledge.write', 'knowledge_file', row.id, { path: row.path, reason, revision, tokens });
      ctx.events.emit(reason === 'curation' ? 'knowledge.curated' : 'knowledge.updated', 'knowledge_file', row.id, {
        path: row.path, scope: row.scope, projectId: row.projectId, revision, tokenEstimate: tokens, budgetTokens: row.budgetTokens,
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
        path: abs, body, tokenEstimate: fresh.tokenEstimate, budgetTokens: fresh.budgetTokens,
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
      if (tokens > row.budgetTokens) {
        db.update('knowledge_files', row.id, { curationPending: true, updatedAt: nowIso() });
        fireCuration(scope, projectId);
        const { over } = sectionSizes(next, row.budgetTokens);
        throw new OcError('budget_exceeded', `${row.path} would be ${tokens} tokens over a budget of ${row.budgetTokens}; curation scheduled`, {
          tokenEstimate: tokens, budgetTokens: row.budgetTokens, sectionsOverBudget: over,
        });
      }
      const revision = write(actor, row, abs, next, 'note');
      if (tokens > row.budgetTokens * 0.8) fireCuration(scope, projectId);
      return { remainingTokens: row.budgetTokens - tokens, revision };
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
      if (reason !== 'curation' && tokens > row.budgetTokens) fireCuration(scope, projectId);
      return { revision };
    },

    revisions(scope, projectId) {
      const { row } = ensure(scope, projectId);
      return db.all<{ revision: number; authorKind: string; reason: string; createdAt: string }>(
        'SELECT revision, author_kind, reason, created_at FROM knowledge_revisions WHERE file_id = ? ORDER BY revision DESC',
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
          path: f.path, scope: f.scope, projectId: f.projectId, tokenEstimate: f.tokenEstimate, budgetTokens: f.budgetTokens,
          pct: f.budgetTokens ? Math.round((f.tokenEstimate / f.budgetTokens) * 100) : 0,
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
      if (estimateTokens(next) > row.budgetTokens * 0.8) fireCuration('decisions');
    },
  };

  return service;
}
