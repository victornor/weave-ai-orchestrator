/**
 * A weaver's workspace-scoped artifact store (VS-297) — the ticket-less sibling of
 * `TicketsService.putDocument`/`putArtifactWorkProduct`. See `openspec/specs/weaver-artifacts/storage`.
 */
import { newId, nowIso, type Db } from '@weave-ai/db';
import type { Actor, WeaverArtifactsService } from '../api.js';
import type { WorkspaceContext } from '../context.js';
import { tx } from '../tickets/tx.js';

export function createWeaverArtifactsService(ctx: WorkspaceContext): WeaverArtifactsService {
  const db: Db = ctx.db;

  return {
    put(actor, workspaceId, key, html, opts) {
      const now = nowIso();
      return tx(db, () => {
        let artifact = db.get<{ id: string; currentRevision: number }>(
          'SELECT id, current_revision FROM weaver_artifacts WHERE workspace_id = ? AND key = ?',
          [workspaceId, key],
        );
        if (!artifact) {
          const id = newId();
          db.insert('weaver_artifacts', {
            id, workspaceId, key, currentRevision: 0, title: opts?.title ?? null, kind: opts?.kind ?? null, createdAt: now, updatedAt: now,
          });
          artifact = { id, currentRevision: 0 };
        }
        const revision = artifact.currentRevision + 1;
        db.insert('weaver_artifact_revisions', {
          id: newId(), artifactId: artifact.id, revision, body: html, authorKind: actor.kind, authorId: actor.id, runId: actor.runId ?? null, createdAt: now,
        });
        db.run(
          'UPDATE weaver_artifacts SET current_revision = ?, title = ?, kind = ?, updated_at = ? WHERE id = ?',
          [revision, opts?.title ?? null, opts?.kind ?? null, now, artifact.id],
        );
        ctx.events.emit('weaver_artifact.published', 'workspace', workspaceId, { workspaceId, key, revision });
        return { revision };
      });
    },

    getRevision(workspaceId, key, revision) {
      const artifact = db.get<{ id: string; currentRevision: number }>(
        'SELECT id, current_revision FROM weaver_artifacts WHERE workspace_id = ? AND key = ?',
        [workspaceId, key],
      );
      if (!artifact) return null;
      const rev = revision ?? artifact.currentRevision;
      const r = db.get<{ body: string }>('SELECT body FROM weaver_artifact_revisions WHERE artifact_id = ? AND revision = ?', [artifact.id, rev]);
      if (!r) return null;
      return { body: r.body, revision: rev };
    },

    list(workspaceId) {
      return db.all<{ key: string; title: string | null; kind: string | null; revision: number; updatedAt: string }>(
        `SELECT key, title, kind, current_revision AS revision, updated_at
           FROM weaver_artifacts
          WHERE workspace_id = ?
          ORDER BY updated_at DESC, id DESC`,
        [workspaceId],
      );
    },

    revisions(workspaceId, key) {
      const artifact = db.get<{ id: string }>('SELECT id FROM weaver_artifacts WHERE workspace_id = ? AND key = ?', [workspaceId, key]);
      if (!artifact) return [];
      return db.all<{ revision: number; authorKind: string; createdAt: string }>(
        'SELECT revision, author_kind, created_at FROM weaver_artifact_revisions WHERE artifact_id = ? ORDER BY revision',
        [artifact.id],
      );
    },
  };
}
