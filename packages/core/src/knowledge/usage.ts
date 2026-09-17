/**
 * Knowledge context accounting (VS-110, PLAN knowledge/context-accounting): what a run's turn
 * actually consumed from the knowledge base — hub tokens rendered into its bootstrap digest, plus
 * the tokens of every document an explicit knowledge read returned, each distinct document counted
 * once per run. Separate from `UsageService`, which tracks billed model tokens; this measures only —
 * nothing here throttles, caps or refuses a run, and a write failure here must never fail one.
 */
import { newId, nowIso, type Db } from '@weave-ai/db';
import { OcError, resolveUsageWindow, type KnowledgeScope } from '@weave-ai/shared';
import type {
  CoreServices, KnowledgeContextUsage, KnowledgeDocumentRef, KnowledgeDocumentUsage,
  KnowledgeReadEvent, KnowledgeUsageQuery, KnowledgeUsageService,
} from '../api.js';
import type { WorkspaceContext } from '../context.js';

type Param = string | number | null;

interface EventRow {
  kind: 'hub' | 'document'; scope: KnowledgeScope; docProjectId: string | null; slug: string | null; tokens: number; runId: string;
}

const SUBTREE_SQL =
  'WITH RECURSIVE sub(id) AS (SELECT id FROM tickets WHERE id = ? UNION SELECT t.id FROM tickets t JOIN sub ON t.parent_id = sub.id) SELECT id FROM sub';

function emptyUsage(): KnowledgeContextUsage {
  return { hubTokens: 0, documentTokens: 0, totalTokens: 0, documents: [] };
}

function summarize(rows: EventRow[]): KnowledgeContextUsage {
  const usage = emptyUsage();
  // Only actual linked-document reads (a slug) populate `documents` — a hub chunk or an explicit
  // whole-hub-scope read (weave_knowledge_get, slug null) is knowledge context but is not "a document".
  const docs = new Map<string, { scope: KnowledgeScope; projectId: string | null; slug: string | null; tokens: number }>();
  for (const r of rows) {
    if (r.kind === 'hub') usage.hubTokens += r.tokens;
    else usage.documentTokens += r.tokens;
    if (r.slug === null) continue;
    const key = `${r.scope}:${r.docProjectId ?? ''}:${r.slug}`;
    const existing = docs.get(key);
    if (existing) existing.tokens += r.tokens;
    else docs.set(key, { scope: r.scope, projectId: r.docProjectId, slug: r.slug, tokens: r.tokens });
  }
  usage.totalTokens = usage.hubTokens + usage.documentTokens;
  usage.documents = [...docs.values()];
  return usage;
}

export function createKnowledgeUsageService(ctx: WorkspaceContext, deps: () => CoreServices): KnowledgeUsageService {
  const db: Db = ctx.db;
  const ws = ctx.workspaceId;

  const resolveTicketId = (idOrIdentifier: string): string => {
    const row = db.get<{ id: string }>('SELECT id FROM tickets WHERE workspace_id = ? AND (id = ? OR identifier = ?)', [ws, idOrIdentifier, idOrIdentifier]);
    if (!row) throw new OcError('not_found', `ticket ${idOrIdentifier} not found`, { ticket: idOrIdentifier });
    return row.id;
  };

  const runProjectId = (agentId: string): string | null =>
    db.get<{ projectId: string | null }>('SELECT project_id FROM agents WHERE id = ? AND workspace_id = ?', [agentId, ws])?.projectId ?? null;

  const insertEvent = (row: {
    runId: string; agentId: string; ticketId: string | null; projectId: string | null;
    kind: 'hub' | 'document'; scope: KnowledgeScope; docProjectId: string | null; slug: string | null; tokens: number; occurredAt: string;
  }): void => {
    db.run(
      `INSERT OR IGNORE INTO knowledge_usage_events
         (id, workspace_id, run_id, agent_id, ticket_id, project_id, kind, scope, doc_project_id, slug, tokens, occurred_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [newId(), ws, row.runId, row.agentId, row.ticketId, row.projectId, row.kind, row.scope, row.docProjectId, row.slug, row.tokens, row.occurredAt],
    );
  };

  const emitRecorded = (runId: string, ticketId: string | null): void => {
    ctx.events.emit('knowledge_usage.recorded', 'run', runId, { runId, ticketId });
  };

  const rowsFor = (where: string, params: Param[]): EventRow[] =>
    db.all<EventRow>(
      `SELECT kind, scope, doc_project_id AS docProjectId, slug, tokens, run_id AS runId FROM knowledge_usage_events WHERE ${where}`,
      params,
    );

  const parseWindow = (q: KnowledgeUsageQuery): { start: string; end: string } => {
    const r = resolveUsageWindow(q.window ?? 'all', 'day', new Date());
    return { start: r.start, end: r.end };
  };

  return {
    recordBootstrap(runId, agentId, ticketId, parts) {
      const occurredAt = nowIso();
      const projectId = runProjectId(agentId);
      let any = false;
      for (const part of parts) {
        if (part.tokens <= 0) continue;
        insertEvent({
          runId, agentId, ticketId, projectId, kind: 'hub', scope: part.scope,
          docProjectId: part.projectId, slug: null, tokens: part.tokens, occurredAt,
        });
        any = true;
      }
      if (any) emitRecorded(runId, ticketId);
    },

    recordRead(evt: KnowledgeReadEvent) {
      if (evt.tokens <= 0) return;
      const projectId = runProjectId(evt.agentId);
      insertEvent({
        runId: evt.runId, agentId: evt.agentId, ticketId: evt.ticketId, projectId, kind: 'document',
        scope: evt.scope, docProjectId: evt.projectId, slug: evt.slug, tokens: evt.tokens, occurredAt: nowIso(),
      });
      emitRecorded(evt.runId, evt.ticketId);
    },

    forRun(runId) {
      return summarize(rowsFor('run_id = ?', [runId]));
    },

    forTicket(ticketId) {
      const id = resolveTicketId(ticketId);
      return summarize(rowsFor(`ticket_id IN (${SUBTREE_SQL})`, [id]));
    },

    summary(query) {
      const { start, end } = parseWindow(query);
      const params: Param[] = [ws, start, end];
      let sql = 'SELECT COUNT(DISTINCT run_id) AS runs, COALESCE(SUM(tokens),0) AS tokens FROM knowledge_usage_events WHERE workspace_id = ? AND occurred_at >= ? AND occurred_at < ?';
      if (query.projectId) { sql += ' AND project_id = ?'; params.push(query.projectId); }
      const row = db.get<{ runs: number; tokens: number }>(sql, params) ?? { runs: 0, tokens: 0 };
      const runs = Number(row.runs);
      const tokens = Number(row.tokens);
      return { averageTokensPerRun: runs ? tokens / runs : 0, runs };
    },

    topDocuments(query, limit = 20) {
      const { start, end } = parseWindow(query);
      const params: Param[] = [ws, start, end];
      // Grouped by the document's own project (doc_project_id), not the reading run's — "this
      // project's most-read documents" means documents that belong to the project, whoever read
      // them, matching how `neverRead`'s catalogue is scoped.
      let sql = `
        SELECT scope, doc_project_id AS projectId, slug, COUNT(DISTINCT run_id) AS reads, COALESCE(SUM(tokens),0) AS tokens
        FROM knowledge_usage_events
        WHERE workspace_id = ? AND occurred_at >= ? AND occurred_at < ? AND kind = 'document' AND slug IS NOT NULL`;
      if (query.projectId) { sql += ' AND doc_project_id = ?'; params.push(query.projectId); }
      sql += ' GROUP BY scope, doc_project_id, slug ORDER BY reads DESC, tokens DESC LIMIT ?';
      params.push(Math.min(limit, 100));
      const rows = db.all<{ scope: KnowledgeScope; projectId: string | null; slug: string; reads: number; tokens: number }>(sql, params);
      return rows.map((r): KnowledgeDocumentUsage => ({
        scope: r.scope, projectId: r.projectId, slug: r.slug, reads: Number(r.reads), tokens: Number(r.tokens),
        title: deps().knowledge.listDocs({ scope: r.scope, projectId: r.projectId }).find((d) => d.slug === r.slug)?.title ?? null,
      }));
    },

    neverRead(query) {
      const { start, end } = parseWindow(query);
      // VS-492: an explicit lower bound overrides the window's start, so the never-read curation
      // trigger and health measure can use the configured day count rather than a fixed vocabulary.
      const since = query.since ?? start;
      const catalogue = deps().knowledge.listDocs(query.projectId !== undefined ? { projectId: query.projectId } : {});
      const params: Param[] = [ws, since, end];
      const readRows = db.all<{ scope: KnowledgeScope; projectId: string | null; slug: string }>(
        `SELECT DISTINCT scope, doc_project_id AS projectId, slug FROM knowledge_usage_events
         WHERE workspace_id = ? AND occurred_at >= ? AND occurred_at < ? AND kind = 'document' AND slug IS NOT NULL`,
        params,
      );
      const read = new Set(readRows.map((r) => `${r.scope}:${r.projectId ?? ''}:${r.slug}`));
      return catalogue
        .filter((d) => !read.has(`${d.scope}:${d.projectId ?? ''}:${d.slug}`))
        .map((d): KnowledgeDocumentRef => ({ scope: d.scope, projectId: d.projectId, slug: d.slug, title: d.title, tokenEstimate: d.tokenEstimate }));
    },
  };
}
