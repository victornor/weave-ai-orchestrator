import type { WorkspaceRuntime } from '../types.js';
import { ago } from './clock.js';
import { PROJECT_DOCS, PROJECT_HUBS, WORKSPACE_HUB, SHARED_HUB, DECISIONS_HUB } from './content.js';

/**
 * VS-770: knowledge lives in files, so it is written through the running knowledge service (which
 * writes the file, the revision, the search index and the link graph together) rather than by SQL.
 * The service stamps real times; they are rewritten to fixed offsets afterwards so the pages read
 * the same on every start.
 */
export function seedKnowledge(ws: WorkspaceRuntime): void {
  if (ws.id !== 'lumen') return;
  const { knowledge } = ws.services;
  const actor = { kind: 'human' as const, id: 'captain' };
  const projects = ws.ctx.db.all<{ id: string; slug: string }>('SELECT id, slug FROM projects');
  try {
    knowledge.replace(actor, 'workspace', WORKSPACE_HUB, 'human');
    knowledge.replace(actor, 'shared', SHARED_HUB, 'human');
    knowledge.replace(actor, 'decisions', DECISIONS_HUB, 'human');
    for (const p of projects) {
      const hub = PROJECT_HUBS[p.slug];
      if (hub) knowledge.replace(actor, 'project', hub, 'human', p.id);
    }
    for (const d of PROJECT_DOCS) {
      const project = projects.find((p) => p.slug === d.project);
      if (project) knowledge.putDoc(actor, 'project', d.slug, d.body, project.id, 'human', d.folder ?? null);
    }
    knowledge.reindex();
  } catch (e) {
    ws.ctx.log('knowledge').warn({ err: String(e) }, 'demo knowledge could not be written');
    return;
  }
  const files = ws.ctx.db.all<{ id: string }>('SELECT id FROM knowledge_files ORDER BY path');
  files.forEach((f, i) => {
    const at = ago(60 * (6 + i * 9));
    ws.ctx.db.run('UPDATE knowledge_revisions SET created_at = ? WHERE file_id = ?', [at, f.id]);
    ws.ctx.db.run('UPDATE knowledge_files SET updated_at = ?, last_curated_at = ? WHERE id = ?', [at, ago(60 * 24 * 4 + i * 100), f.id]);
  });
}
