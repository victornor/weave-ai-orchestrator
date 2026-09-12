/**
 * Portable workspace package (PLAN §20 `weave workspace export|import`, §22 M4).
 *
 * What travels: `workspace.yaml` verbatim from disk (so `${ENV}` secret references stay
 * references), `roles/<id>/{role.yaml,CHARTER.md}`, `knowledge/**` minus archive directories, and
 * one markdown file per ticket rendered from the db.
 *
 * What never travels: the sqlite db, run logs, worker homes and archives, worktrees, project
 * clones, sessions, auth material and any resolved secret value.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import YAML from 'yaml';
import { OcError, TICKET_KINDS, TICKET_PRIORITIES, toLegacySpelling, type TicketKind, type TicketPriority } from '@weave-ai/shared';
import type { Actor, CoreServices } from '../api.js';
import type { WorkspaceContext } from '../context.js';
import { WORKSPACE_FILE } from './loader.js';

const SYSTEM: Actor = { kind: 'system', id: null };
const EXPORT_DIRS = ['roles', 'knowledge', 'tickets'] as const;
const ROLE_FILES = ['role.yaml', 'CHARTER.md'] as const;

export interface ExportResult { path: string; workspace: string; roles: number; knowledgeFiles: number; tickets: number }
export interface StageResult { target: string; created: boolean; roles: number; knowledgeFiles: number; workspaceId: string }
export interface TicketImportResult { imported: number; skipped: number }

/** `exports/<ISO timestamp, filesystem-safe>` under the workspace root unless `out` says otherwise. */
export function exportDirName(now = new Date()): string {
  return now.toISOString().replace(/[:.]/g, '-').replace(/Z$/, 'Z');
}

export function exportWorkspace(ctx: WorkspaceContext, opts: { out?: string; now?: Date } = {}): ExportResult {
  const out = opts.out ? opts.out : join(ctx.paths.root, 'exports', exportDirName(opts.now));
  mkdirSync(out, { recursive: true });
  for (const d of EXPORT_DIRS) mkdirSync(join(out, d), { recursive: true });

  const source = join(ctx.paths.root, WORKSPACE_FILE);
  if (existsSync(source)) copyFileSync(source, join(out, WORKSPACE_FILE));
  // VS-263 Decision 6: the common path above copies the real file byte-for-byte (whatever spelling
  // it already has); this fallback serializes `ctx.config` fresh and must keep the same legacy
  // spelling on disk — an export is exactly the artifact most likely to travel to an older daemon.
  else writeFileSync(join(out, WORKSPACE_FILE), YAML.stringify(toLegacySpelling(ctx.config), { lineWidth: 0 }), 'utf8');

  const roles = copyRoles(ctx.paths.roles, join(out, 'roles'));
  const knowledgeFiles = copyKnowledge(ctx.paths.knowledge, join(out, 'knowledge'));
  const tickets = writeTickets(ctx, join(out, 'tickets'));
  return { path: out, workspace: ctx.config.id, roles, knowledgeFiles, tickets };
}

/** Copy the portable files of an export into a new or existing workspace directory. Never overwrites an existing workspace.yaml. */
export function stageWorkspaceImport(from: string, target: string): StageResult {
  const manifest = join(from, WORKSPACE_FILE);
  if (!existsSync(manifest)) throw new OcError('validation', `${from} is not an Weave AI export: no ${WORKSPACE_FILE}`);
  const config = YAML.parse(readFileSync(manifest, 'utf8')) as { id?: string } | null;
  const workspaceId = typeof config?.id === 'string' ? config.id : basename(target);

  const existing = existsSync(join(target, WORKSPACE_FILE));
  mkdirSync(target, { recursive: true });
  if (!existing) copyFileSync(manifest, join(target, WORKSPACE_FILE));

  const roles = copyRoles(join(from, 'roles'), join(target, 'roles'));
  const knowledgeFiles = copyKnowledge(join(from, 'knowledge'), join(target, 'knowledge'));
  return { target, created: !existing, roles, knowledgeFiles, workspaceId };
}

/** Every `tickets/*.md` in an export becomes a fresh `backlog` ticket carrying an `[imported]` provenance comment. */
export function importTickets(services: CoreServices, from: string, actor: Actor = SYSTEM): TicketImportResult {
  const dir = join(from, 'tickets');
  if (!existsSync(dir)) return { imported: 0, skipped: 0 };
  let imported = 0;
  let skipped = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const parsed = parseTicketFile(readFileSync(join(dir, entry.name), 'utf8'));
    if (!parsed) { skipped += 1; continue; }
    try {
      const ticket = services.tickets.create(actor, {
        kind: parsed.kind, title: parsed.title, description: parsed.description, priority: parsed.priority,
      });
      services.tickets.comment(actor, ticket.id, parsed.provenance, 'status', 'trusted');
      imported += 1;
    } catch {
      skipped += 1;
    }
  }
  return { imported, skipped };
}

// ---------- rendering ----------

interface TicketRow {
  id: string; identifier: string; kind: string; title: string; description: string; status: string; priority: string;
  autoMerge: number; projectId: string | null; assigneeRoleId: string | null; parentId: string | null;
  openspecChangeName: string | null; createdAt: string; updatedAt: string; completedAt: string | null;
}

function writeTickets(ctx: WorkspaceContext, out: string): number {
  const rows = ctx.db.all<TicketRow>(
    `SELECT id, identifier, kind, title, description, status, priority, auto_merge, project_id, assignee_role_id,
            parent_id, openspec_change_name, created_at, updated_at, completed_at
       FROM tickets WHERE workspace_id = ? ORDER BY number`,
    [ctx.workspaceId],
  );
  const projects = new Map(ctx.db.all<{ id: string; slug: string }>('SELECT id, slug FROM projects WHERE workspace_id = ?', [ctx.workspaceId]).map((p) => [p.id, p.slug]));
  const roles = new Map(ctx.db.all<{ id: string; slug: string }>('SELECT id, slug FROM roles WHERE workspace_id = ?', [ctx.workspaceId]).map((r) => [r.id, r.slug]));
  const identifiers = new Map(rows.map((t) => [t.id, t.identifier]));

  for (const t of rows) writeFileSync(join(out, `${t.identifier}.md`), renderTicket(ctx, t, { projects, roles, identifiers }), 'utf8');
  return rows.length;
}

function renderTicket(
  ctx: WorkspaceContext, t: TicketRow,
  maps: { projects: Map<string, string>; roles: Map<string, string>; identifiers: Map<string, string> },
): string {
  const blockedBy = ctx.db.all<{ relatedTicketId: string }>("SELECT related_ticket_id FROM ticket_relations WHERE ticket_id = ? AND kind = 'blocks'", [t.id])
    .map((r) => maps.identifiers.get(r.relatedTicketId) ?? r.relatedTicketId);
  const front: Record<string, unknown> = {
    identifier: t.identifier, title: t.title, kind: t.kind, status: t.status, priority: t.priority,
    project: t.projectId ? maps.projects.get(t.projectId) ?? null : null,
    role: t.assigneeRoleId ? maps.roles.get(t.assigneeRoleId) ?? null : null,
    parent: t.parentId ? maps.identifiers.get(t.parentId) ?? null : null,
    blockedBy, autoMerge: t.autoMerge === 1, openspecChange: t.openspecChangeName,
    createdAt: t.createdAt, updatedAt: t.updatedAt, completedAt: t.completedAt,
  };

  const parts = [`---\n${YAML.stringify(front, { lineWidth: 0 }).trimEnd()}\n---`, `\n# ${t.title}\n`, '## Description\n', `${(t.description || '_(none)_').trim()}\n`];

  const comments = ctx.db.all<{ authorKind: string; authorId: string | null; kind: string; body: string; createdAt: string }>(
    'SELECT author_kind, author_id, kind, body, created_at FROM ticket_comments WHERE ticket_id = ? ORDER BY created_at', [t.id],
  );
  parts.push('\n## Comments\n');
  if (!comments.length) parts.push('_(none)_\n');
  for (const c of comments) parts.push(`### ${c.createdAt} — ${c.authorKind}${c.authorId ? ` (${c.authorId})` : ''} · ${c.kind}\n\n${c.body.trim()}\n`);

  const documents = ctx.db.all<{ key: string; body: string; revision: number }>(
    `SELECT d.key AS key, r.body AS body, r.revision AS revision
       FROM ticket_documents d JOIN ticket_document_revisions r ON r.document_id = d.id AND r.revision = d.current_revision
      WHERE d.ticket_id = ? ORDER BY d.key`,
    [t.id],
  );
  parts.push('\n## Documents\n');
  if (!documents.length) parts.push('_(none)_\n');
  for (const d of documents) parts.push(`### ${d.key} (revision ${d.revision})\n\n${d.body.trim()}\n`);

  return parts.join('\n');
}

// ---------- parsing ----------

interface ParsedTicket { kind: TicketKind; title: string; description: string; priority: TicketPriority; provenance: string }

export function parseTicketFile(text: string): ParsedTicket | null {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!m) return null;
  let front: Record<string, unknown>;
  try { front = (YAML.parse(m[1]!) ?? {}) as Record<string, unknown>; } catch { return null; }
  const title = typeof front.title === 'string' && front.title.trim() ? front.title.trim() : null;
  if (!title) return null;
  const kind = TICKET_KINDS.includes(front.kind as TicketKind) ? (front.kind as TicketKind) : 'task';
  const priority = TICKET_PRIORITIES.includes(front.priority as TicketPriority) ? (front.priority as TicketPriority) : 'medium';
  const description = section(text.slice(m[0].length), 'Description');
  const identifier = typeof front.identifier === 'string' ? front.identifier : 'unknown';
  const status = typeof front.status === 'string' ? front.status : 'unknown';
  return {
    kind, title, priority,
    description: description === '_(none)_' ? '' : description,
    provenance: `[imported] from ${identifier} (was ${status}${front.project ? `, project ${String(front.project)}` : ''}). Comments, documents and history stayed in the source workspace.`,
  };
}

/** The body of a `## <name>` section, up to the next `## ` heading. */
function section(body: string, name: string): string {
  const re = new RegExp(`^## ${name}\\s*$`, 'm');
  const start = re.exec(body);
  if (!start) return '';
  const rest = body.slice(start.index + start[0].length);
  const next = /^## /m.exec(rest);
  return (next ? rest.slice(0, next.index) : rest).trim();
}

// ---------- file copying ----------

function copyRoles(from: string, to: string): number {
  if (!existsSync(from)) return 0;
  let count = 0;
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const files = ROLE_FILES.filter((f) => existsSync(join(from, entry.name, f)));
    if (!files.length) continue;
    mkdirSync(join(to, entry.name), { recursive: true });
    for (const f of files) copyFileSync(join(from, entry.name, f), join(to, entry.name, f));
    count += 1;
  }
  return count;
}

/** Everything under `knowledge/` except archive directories (they hold removed entries, not current knowledge). */
function copyKnowledge(from: string, to: string): number {
  if (!existsSync(from)) return 0;
  let count = 0;
  const walk = (src: string, dst: string): void => {
    mkdirSync(dst, { recursive: true });
    for (const entry of readdirSync(src, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name === 'archive') continue;
        walk(join(src, entry.name), join(dst, entry.name));
      } else if (entry.isFile()) {
        copyFileSync(join(src, entry.name), join(dst, entry.name));
        count += 1;
      }
    }
  };
  walk(from, to);
  return count;
}
