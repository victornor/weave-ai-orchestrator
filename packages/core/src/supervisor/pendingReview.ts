import { formatAge } from '@weave-ai/render';
import type { Wakeup } from '@weave-ai/shared';
import type { WorkspaceContext } from '../context.js';

export interface PendingReviewEntry { decisionId: string; kind: string; ticketIdentifier: string | null; title: string; ageMs: number }

/** Marker that opens the "not reviewed" note in a digest wake's reason. */
const NOTE_MARKER = ' — ';

/** The reason suffix naming up to three unreviewed approval cards ('' when none). */
export function reviewNote(entries: PendingReviewEntry[]): string {
  if (!entries.length) return '';
  return `${NOTE_MARKER}${entries.length} approval card${entries.length === 1 ? '' : 's'} still not reviewed: `
    + entries.slice(0, 3).map((p) => `${p.ticketIdentifier ?? 'workspace'} ${p.kind.replace('_approval', '')} ${formatAge(new Date(Date.now() - p.ageMs).toISOString())}`).join(', ')
    + (entries.length > 3 ? `, +${entries.length - 3} more` : '');
}

/**
 * VS-956: a digest names its unreviewed cards when it is queued, but a weaver mid-turn lets it sit
 * until that turn ends — and the weaver's own review mark lands in between. Re-check the named cards
 * against the database as the wake is claimed: keep only those still open, human-owned and `unseen`,
 * with their age taken from now. Returns the rewritten reason and payload, or null when nothing changed.
 */
export function refreshDigestWake(ctx: WorkspaceContext, w: { reason: string; payload: Record<string, unknown> }): { reason: string; payload: Record<string, unknown> } | null {
  const named = w.payload['pendingReview'];
  if (!Array.isArray(named) || !named.length) return null;
  const entries = named as PendingReviewEntry[];
  const stillUnseen = new Map(ctx.db.all<{ id: string; createdAt: string }>(
    `SELECT id, created_at AS createdAt FROM decisions
      WHERE id IN (${entries.map(() => '?').join(',')}) AND status = 'open' AND owner = 'human' AND weaver_review_status = 'unseen'`,
    entries.map((e) => e.decisionId),
  ).map((d) => [d.id, d.createdAt]));
  if (stillUnseen.size === entries.length) return null;
  const kept = entries.filter((e) => stillUnseen.has(e.decisionId)).map((e) => ({ ...e, ageMs: Date.now() - Date.parse(stillUnseen.get(e.decisionId)!) }));
  const at = w.reason.indexOf(`${NOTE_MARKER}${entries.length} approval card`);
  const head = at >= 0 ? w.reason.slice(0, at) : w.reason;
  const { pendingReview: _drop, ...rest } = w.payload;
  return { reason: `${head}${reviewNote(kept)}`, payload: kept.length ? { ...rest, pendingReview: kept } : rest };
}

/** Rewrite, in place, every queued digest wake (a coalesced bundle entry included) whose named cards were reviewed since. */
export function refreshQueuedDigests(ctx: WorkspaceContext, queued: Wakeup[]): void {
  for (const w of queued) {
    // No source filter (VS-976): a digest is enqueued as 'system' but coalesces into whatever wake is
    // already queued, so it can ride in a worker report, a decision answer or a human message.
    const patch: Record<string, unknown> = {};
    const top = refreshDigestWake(ctx, { reason: w.reason, payload: (w.payload ?? {}) as Record<string, unknown> });
    let payload = (w.payload ?? {}) as Record<string, unknown>;
    if (top) { patch['reason'] = top.reason; payload = top.payload; }
    const bundle = Array.isArray(payload['bundle']) ? (payload['bundle'] as Array<Record<string, unknown>>) : null;
    if (bundle) {
      let changed = false;
      const next = bundle.map((b) => {
        const r = b['source'] === 'system' ? refreshDigestWake(ctx, { reason: String(b['reason'] ?? ''), payload: (b['payload'] ?? {}) as Record<string, unknown> }) : null;
        if (!r) return b;
        changed = true;
        return { ...b, reason: r.reason, payload: r.payload };
      });
      if (changed) payload = { ...payload, bundle: next };
    }
    if (top || payload !== (w.payload ?? {})) patch['payloadJson'] = payload;
    if (Object.keys(patch).length) {
      ctx.db.update('wakeups', w.id, patch);
      Object.assign(w, { reason: patch['reason'] ?? w.reason, payload });
    }
  }
}
