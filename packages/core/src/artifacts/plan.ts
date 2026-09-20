/**
 * A planner's plan-scoped artifact store (VS-622) — the plan sibling of `WeaverArtifactsService`,
 * keyed by `(plan_id, key)` and reusing the same validation, CSP and viewer. See
 * `openspec/specs/plan-artifacts/storage`.
 */
import { newId, nowIso, type Db } from '@weave-ai/db';
import type { Actor, PlanArtifactsService } from '../api.js';
import type { WorkspaceContext } from '../context.js';
import { tx } from '../tickets/tx.js';

export function createPlanArtifactsService(ctx: WorkspaceContext): PlanArtifactsService {
  const db: Db = ctx.db;

  return {
    put(actor, planId, key, html, opts) {
      const now = nowIso();
      return tx(db, () => {
        let artifact = db.get<{ id: string; currentRevision: number; cardMessageId: string | null }>(
          'SELECT id, current_revision, card_message_id FROM plan_artifacts WHERE plan_id = ? AND key = ?',
          [planId, key],
        );
        let created = false;
        if (!artifact) {
          const id = newId();
          db.insert('plan_artifacts', {
            id, planId, key, currentRevision: 0, title: opts?.title ?? null, kind: opts?.kind ?? null, cardMessageId: null, createdAt: now, updatedAt: now,
          });
          artifact = { id, currentRevision: 0, cardMessageId: null };
          created = true;
        }
        const revision = artifact.currentRevision + 1;
        db.insert('plan_artifact_revisions', {
          id: newId(), artifactId: artifact.id, revision, body: html, authorKind: actor.kind, authorId: actor.id, runId: actor.runId ?? null, createdAt: now,
        });
        db.run(
          'UPDATE plan_artifacts SET current_revision = ?, title = ?, kind = ?, updated_at = ? WHERE id = ?',
          [revision, opts?.title ?? null, opts?.kind ?? null, now, artifact.id],
        );
        ctx.events.emit('plan.artifact_published', 'plan', planId, { planId, key, revision });
        return { revision, cardMessageId: artifact.cardMessageId, created };
      });
    },

    setCardMessage(planId, key, messageId) {
      db.run('UPDATE plan_artifacts SET card_message_id = ? WHERE plan_id = ? AND key = ?', [messageId, planId, key]);
    },

    getRevision(planId, key, revision) {
      const artifact = db.get<{ id: string; currentRevision: number }>(
        'SELECT id, current_revision FROM plan_artifacts WHERE plan_id = ? AND key = ?',
        [planId, key],
      );
      if (!artifact) return null;
      const rev = revision ?? artifact.currentRevision;
      const r = db.get<{ body: string }>('SELECT body FROM plan_artifact_revisions WHERE artifact_id = ? AND revision = ?', [artifact.id, rev]);
      if (!r) return null;
      return { body: r.body, revision: rev };
    },

    list(planId) {
      return db.all<{ key: string; title: string | null; kind: string | null; revision: number; updatedAt: string }>(
        `SELECT key, title, kind, current_revision AS revision, updated_at
           FROM plan_artifacts
          WHERE plan_id = ?
          ORDER BY updated_at DESC, id DESC`,
        [planId],
      );
    },

    revisions(planId, key) {
      const artifact = db.get<{ id: string }>('SELECT id FROM plan_artifacts WHERE plan_id = ? AND key = ?', [planId, key]);
      if (!artifact) return [];
      return db.all<{ revision: number; authorKind: string; createdAt: string }>(
        'SELECT revision, author_kind, created_at FROM plan_artifact_revisions WHERE artifact_id = ? ORDER BY revision',
        [artifact.id],
      );
    },
  };
}
